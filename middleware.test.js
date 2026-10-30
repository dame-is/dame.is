import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import middleware, { config } from './middleware.js';
import { ME_DID, BLOG_PUBLICATION } from './src/config.js';

const SHELL = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'index.html'),
  'utf-8',
);

/**
 * Serve the real built shell for the middleware's own subrequest and 404
 * everything else, so a page's PDS lookups miss and it falls back to the static
 * copy in og/pages.js. That is the shape of a cold edge, which is the case
 * worth pinning: whatever the network does, these responses must still be
 * correct.
 */
function stubFetch() {
  return vi.fn(async (input) => {
    const url = String(input?.url || input);
    if (url.endsWith('/index.html')) {
      return new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('not found', { status: 404 });
  });
}

const get = (path, headers = {}) =>
  middleware(new Request(`https://dame.is${path}`, { headers }));

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

beforeEach(() => {
  vi.stubGlobal('fetch', stubFetch());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the matcher', () => {
  it('excludes the shell subrequest, so fetching index.html cannot loop', () => {
    expect(config.matcher[0]).toContain('index\\.html');
  });

  it('excludes the paths served by a function or off the filesystem', () => {
    for (const p of ['api/', 'assets/', 'data/', 'sitemap\\.xml', 'llms\\.txt', 'receive_auth_callback']) {
      expect(config.matcher[0]).toContain(p);
    }
  });
});

describe('paths middleware must not judge', () => {
  it('falls through for its own shell subrequest', async () => {
    expect(await get('/', { 'x-og-shell': '1' })).toBeUndefined();
  });

  it('falls through for generated and static files', async () => {
    for (const p of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/data/blogging.json', '/receive_auth_callback']) {
      expect(await get(p)).toBeUndefined();
    }
  });

  it('falls through for the legacy paths vercel.json redirects', async () => {
    // These are absent from the route table on purpose. If Vercel ever ran
    // middleware before its redirects, 404ing them would break every old link.
    for (const p of [
      '/about',
      '/blog',
      '/blog/an-old-post',
      '/resume',
      '/flushing',
      '/participants',
    ]) {
      expect(await get(p)).toBeUndefined();
    }
  });
});

describe('404s', () => {
  it('returns a real 404 for a path no route answers to', async () => {
    const res = await get('/some-path-that-does-not-exist', { accept: HTML_ACCEPT });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('still serves the app on a 404, so a person gets the real page', async () => {
    const res = await get('/nope', { accept: HTML_ACCEPT });
    const body = await res.text();
    expect(body).toContain('<div id="root">');
    expect(body).toContain('src="/src/main.jsx"');
    expect(body).toContain('<title>Not found — dame.is</title>');
  });

  it('tells crawlers not to index it, and caches nothing', async () => {
    const res = await get('/nope', { accept: HTML_ACCEPT });
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('<meta name="robots" content="noindex" />');
  });

  it('points an agent at what does exist', async () => {
    const body = await (await get('/nope', { accept: HTML_ACCEPT })).text();
    expect(body).toContain('href="/llms.txt"');
    expect(body).toContain('href="/sitemap.xml"');
  });

  it('answers a markdown request with a markdown 404', async () => {
    const res = await get('/nope', { accept: 'text/markdown' });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const body = await res.text();
    expect(body.startsWith('# 404 — Not found')).toBe(true);
    expect(body).toContain('/nope');
  });

  it('404s a record route whose record does not resolve', async () => {
    // Every lookup misses under the stub, so this is the unresolvable case.
    const res = await get('/blogging/no-such-post', { accept: HTML_ACCEPT });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('<meta name="robots" content="noindex" />');
  });

  it('404s an unresolvable leaf only in sections that actually hold records', async () => {
    for (const p of [
      '/posting/3nosuchrkey',
      '/logging/3nosuchrkey',
      '/listening/3nosuchrkey',
      '/mothing/999999',
      '/curating/no-such-channel',
      '/creating/no-such-work',
      '/creating/ratioed/99',
      // The verbs whose record pages used to card as the home page and never
      // 404 — every `/{verb}/:rkey` the registry generates now resolves.
      '/photographing/3nosuchrkey',
      '/liking/3nosuchrkey',
      '/flushing/3nosuchrkey',
      '/crafting/3nosuchrkey',
    ]) {
      expect((await get(p, { accept: HTML_ACCEPT })).status).toBe(404);
    }
  });

  it('never 404s a page whose section holds no records at all', async () => {
    // These resolve no record because there is no record to resolve — they are
    // ordinary pages. Judging them against a record lookup would 404 the whole
    // atproto explorer, every résumé version, and the OAuth callback.
    for (const p of [
      '/available/v2',
      '/exploring',
      '/exploring/did:plc:gq4fo3u6tqzzdkjlwzpb23tj',
      '/exploring/did:plc:gq4fo3u6tqzzdkjlwzpb23tj/is.dame.now',
      '/exploring/did:plc:gq4fo3u6tqzzdkjlwzpb23tj/is.dame.now/3abc',
      '/oauth/callback',
      '/admin',
      '/is.dame.now/3abc',
      '/app.bsky.feed.post/3xyz',
    ]) {
      const res = await get(p, { accept: HTML_ACCEPT });
      expect(res.status, `${p} should not 404`).toBe(200);
    }
  });

  it('gives a sub-path its section’s card rather than the site-wide default', async () => {
    const body = await (await get('/available/v2', { accept: HTML_ACCEPT })).text();
    expect(body).toContain('<title>dame.is available</title>');
    expect(body).toContain('content="https://dame.is/api/og?page=%2Favailable');
    // The canonical is still the version's own address, not the section's.
    expect(body).toContain('<link rel="canonical" href="https://dame.is/available/v2" />');
  });
});

describe('content negotiation', () => {
  it('406s a request that accepts neither HTML nor markdown', async () => {
    const res = await get('/', { accept: 'application/pdf' });
    expect(res.status).toBe(406);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = JSON.parse(await res.text());
    expect(body.error).toBe('not_acceptable');
    expect(body.available).toEqual(['text/markdown', 'text/html']);
    expect(body.resolution).toContain('Accept: text/markdown');
  });

  it('varies on Accept, so a cache cannot cross the two variants', async () => {
    for (const accept of [HTML_ACCEPT, 'text/markdown', 'application/pdf']) {
      const res = await get('/', { accept });
      expect(res.headers.get('vary')).toBe('Accept, Accept-Encoding');
    }
  });

  it('serves markdown when it is asked for', async () => {
    const res = await get('/', { accept: 'text/markdown' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const body = await res.text();
    expect(body.startsWith('# dame.is')).toBe(true);
    expect(body).toContain('Canonical URL: https://dame.is/');
    expect(body).not.toContain('<div id="root">');
  });

  it('serves HTML to a browser', async () => {
    const res = await get('/', { accept: HTML_ACCEPT });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('serves HTML when no Accept header was sent', async () => {
    const res = await get('/');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });
});

describe('the HTML a crawler receives', () => {
  it('carries a heading and real prose where there used to be seven characters', async () => {
    const body = await (await get('/', { accept: HTML_ACCEPT })).text();
    const text = body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    expect(body).toContain('<h1>dame.is</h1>');
    expect(text.length).toBeGreaterThan(500);
  });

  it('hides that content wherever JavaScript runs, so the site looks unchanged', async () => {
    const body = await (await get('/', { accept: HTML_ACCEPT })).text();
    expect(body).toContain("getElementById('ssr-fallback')");
  });

  it('declares a canonical URL', async () => {
    const body = await (await get('/', { accept: HTML_ACCEPT })).text();
    expect(body).toContain('<link rel="canonical" href="https://dame.is/" />');
  });

  it('declares canonical per path, not one address for the whole site', async () => {
    const body = await (await get('/themself', { accept: HTML_ACCEPT })).text();
    expect(body).toContain('<link rel="canonical" href="https://dame.is/themself" />');
  });

  it('carries a parseable JSON-LD identity graph', async () => {
    const body = await (await get('/', { accept: HTML_ACCEPT })).text();
    const m = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const graph = JSON.parse(m[1]);
    expect(graph['@context']).toBe('https://schema.org');
    expect(graph['@graph'][0]['@type']).toBe('Person');
  });

  it('still rewrites the Open Graph card per page', async () => {
    const body = await (await get('/themself', { accept: HTML_ACCEPT })).text();
    expect(body).toContain('<title>dame.is themself</title>');
    expect(body).toContain('content="https://dame.is/api/og?page=%2Fthemself"');
    expect(body).toContain('<meta property="og:url" content="https://dame.is/themself" />');
  });

  it('still advertises the at:// record behind a surface', async () => {
    const body = await (await get('/blogging', { accept: HTML_ACCEPT })).text();
    expect(body).toContain('name="atproto:uri"');
    expect(body).toContain('rel="site.standard.publication"');
  });

  it('starts the home feed snapshot downloading with the HTML, on / only', async () => {
    const preload =
      '<link rel="preload" as="fetch" href="/data/unifiedFeed.json" crossorigin />';
    const home = await (await get('/', { accept: HTML_ACCEPT })).text();
    expect(home).toContain(preload);
    expect(home.indexOf(preload)).toBeLessThan(home.indexOf('</head>'));
    const other = await (await get('/themself', { accept: HTML_ACCEPT })).text();
    expect(other).not.toContain('unifiedFeed.json');
  });

  it('keeps the shell’s boot-recovery and entry module intact', async () => {
    const body = await (await get('/', { accept: HTML_ACCEPT })).text();
    expect(body).toContain("u.searchParams.has('_r')");
    expect(body).toContain('<script type="module" src="/src/main.jsx"></script>');
  });
});

describe('HEAD', () => {
  const head = (path, accept) =>
    middleware(new Request(`https://dame.is${path}`, { method: 'HEAD', headers: { accept } }));

  it('answers with the headers a GET would, and no body', async () => {
    // RFC 9110 §9.3.2: a HEAD response mirrors what a GET would send. This is
    // what middleware returns; note that Vercel then strips `content-type`
    // from it in production and nothing here can prevent that (see respond()
    // in middleware.js), so this pins our own output, not the wire.
    for (const [path, accept] of [
      ['/', HTML_ACCEPT],
      ['/', 'text/markdown'],
      ['/blogging', 'text/markdown'],
      ['/nope', HTML_ACCEPT],
      ['/nope', 'text/markdown'],
      ['/', 'application/pdf'],
    ]) {
      const [h, g] = [await head(path, accept), await get(path, { accept })];
      expect(h.status, `${path} (${accept})`).toBe(g.status);
      for (const key of ['content-type', 'vary', 'cache-control', 'x-robots-tag']) {
        expect(h.headers.get(key), `${key} on HEAD ${path} (${accept})`).toBe(g.headers.get(key));
      }
      expect(await h.text()).toBe('');
    }
  });

  it('still falls through for the paths a GET falls through on', async () => {
    for (const p of ['/robots.txt', '/about']) expect(await head(p, HTML_ACCEPT)).toBeUndefined();
  });
});

describe('failure handling', () => {
  it('falls through rather than erroring when the shell cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    expect(await get('/', { accept: HTML_ACCEPT })).toBeUndefined();
    expect(await get('/nope', { accept: HTML_ACCEPT })).toBeUndefined();
  });

  it('still answers a markdown request when the shell is unreadable', async () => {
    // The markdown variant never needs the shell, so a broken static origin
    // must not take it down with it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const res = await get('/', { accept: 'text/markdown' });
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* With records to find                                                */
/* ------------------------------------------------------------------ */

const PDS = 'https://pds.example';
const PHOTO_CID = 'bafkreifkgmd2iisfr7fv3ucbcoqsgaexbp2itcnrwjxl2iqvbrjyehrn7m';

/**
 * A world with a PDS in it: the shell, the PLC directory, `records` keyed
 * `collection/rkey` on the PDS, `snapshots` keyed by name under /data, and an
 * AppView that knows the post views in `posts` (keyed by at:// URI). Anything
 * else 404s, as in the cold-edge stub above.
 */
function worldFetch({ records = {}, snapshots = {}, posts = {} } = {}) {
  const calls = [];
  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const fn = vi.fn(async (input) => {
    const url = String(input?.url || input);
    calls.push(url);
    if (url.endsWith('/index.html')) {
      return new Response(SHELL, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.startsWith('https://plc.directory/')) {
      return json({
        id: ME_DID,
        service: [{ id: '#atproto_pds', serviceEndpoint: PDS }],
      });
    }
    if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.getRecord`)) {
      const q = new URL(url).searchParams;
      const key = `${q.get('collection')}/${q.get('rkey')}`;
      if (records[key]) {
        return json({
          uri: `at://${ME_DID}/${key}`,
          cid: 'bafyreiexamplecid',
          value: records[key],
        });
      }
      return new Response(JSON.stringify({ error: 'RecordNotFound' }), {
        status: 400,
      });
    }
    if (url.startsWith('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts')) {
      const uris = new URL(url).searchParams.getAll('uris');
      return json({ posts: uris.map((u) => posts[u]).filter(Boolean) });
    }
    const snap = url.match(/\/data\/([^/?]+)\.json$/);
    if (snap && snap[1] in snapshots) return json(snapshots[snap[1]]);
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const html = async (path) => {
  const res = await get(path, { accept: HTML_ACCEPT });
  return { res, body: await res.text() };
};
const metaContent = (body, attr, key) =>
  body.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1] ??
  null;

describe('record pages', () => {
  it('answers 200 for a post with no text, and names what kind of post it is', async () => {
    // A quote post's text is "" — which used to resolve to nothing, and so to a
    // 404 with noindex for a record that was right there.
    worldFetch({
      records: {
        'app.bsky.feed.post/3quote': {
          text: '',
          embed: {
            $type: 'app.bsky.embed.record',
            record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' },
          },
          createdAt: '2026-05-01T12:00:00.000Z',
        },
      },
    });
    const { res, body } = await html('/posting/3quote');
    expect(res.status).toBe(200);
    expect(body).not.toContain('content="noindex"');
    expect(metaContent(body, 'name', 'description')).toBe('A quote post');
    expect(body).toContain(`at://${ME_DID}/app.bsky.feed.post/3quote`);
  });

  it('describes a post card by its text, for a reader who cannot see it', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.post/3words': {
          text: 'moths at the porch light',
          createdAt: '2026-05-01T12:00:00.000Z',
        },
      },
    });
    const { body } = await html('/posting/3words');
    expect(metaContent(body, 'property', 'og:image:alt')).toBe(
      'moths at the porch light',
    );
    expect(metaContent(body, 'name', 'twitter:image:alt')).toBe(
      'moths at the porch light',
    );
  });

  it('gives a photo its own title and card rather than the home page’s', async () => {
    worldFetch({
      records: {
        'social.grain.gallery/3photo': {
          title: 'Night walk',
          description: 'Six frames',
          createdAt: '2026-05-01T12:00:00.000Z',
        },
      },
    });
    const { res, body } = await html('/photographing/3photo');
    expect(res.status).toBe(200);
    expect(body).toContain('<title>Night walk — dame.is</title>');
    expect(metaContent(body, 'property', 'og:image')).toContain(
      'section=photographing',
    );
  });

  it('names a record with nothing to say by its verb', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.like/3like': {
          subject: {
            uri: 'at://did:plc:someone/app.bsky.feed.post/3x',
            cid: 'c',
          },
          createdAt: '2026-05-01T12:00:00.000Z',
        },
      },
    });
    const { res, body } = await html('/liking/3like');
    expect(res.status).toBe(200);
    expect(body).toContain('<title>dame.is liking</title>');
    expect(metaContent(body, 'name', 'description')).toBe('A like');
  });

  it('marks a blog post an article to Open Graph, with its date', async () => {
    worldFetch({
      snapshots: {
        blogs: [
          {
            uri: `at://${ME_DID}/site.standard.document/3blogpost`,
            cid: 'bafyreiexamplecid',
            value: {
              title: 'On moths',
              description: 'Why the light.',
              publishedAt: '2026-05-01T12:00:00.000Z',
              site: BLOG_PUBLICATION,
            },
          },
        ],
      },
    });
    const { body } = await html('/blogging/3blogpost');
    expect(metaContent(body, 'property', 'og:type')).toBe('article');
    expect(metaContent(body, 'property', 'article:published_time')).toBe(
      '2026-05-01T12:00:00.000Z',
    );
  });

  it('gives a post with a photo the photo card, described by both halves', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.post/3cooper': {
          text: 'gm from cooper',
          embed: {
            $type: 'app.bsky.embed.images',
            images: [
              {
                alt: 'A small tan chihuahua',
                image: { ref: { $link: PHOTO_CID }, mimeType: 'image/jpeg' },
                aspectRatio: { width: 4, height: 3 },
              },
            ],
          },
          createdAt: '2026-10-27T12:00:00.000Z',
        },
      },
    });
    const { res, body } = await html('/posting/3cooper');
    expect(res.status).toBe(200);
    expect(metaContent(body, 'property', 'og:image')).toBe('https://dame.is/api/og?post=3cooper');
    expect(metaContent(body, 'name', 'twitter:image')).toBe('https://dame.is/api/og?post=3cooper');
    expect(metaContent(body, 'name', 'description')).toBe('gm from cooper');
    expect(metaContent(body, 'property', 'og:image:alt')).toBe(
      'gm from cooper (a photo: A small tan chihuahua)',
    );
    // Still a large 1200×630 card, so nothing about how it unfurls changes.
    expect(metaContent(body, 'name', 'twitter:card')).toBe('summary_large_image');
    expect(metaContent(body, 'property', 'og:image:width')).toBe('1200');
    expect(metaContent(body, 'property', 'og:image:height')).toBe('630');
  });

  it('answers 200 for a photo with no words, described by its alt text', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.post/3dril': {
          text: '',
          embed: {
            $type: 'app.bsky.embed.recordWithMedia',
            media: {
              $type: 'app.bsky.embed.images',
              images: [{ alt: 'dril tweet about candles', image: { ref: { $link: PHOTO_CID } } }],
            },
            record: { $type: 'app.bsky.embed.record', record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' } },
          },
        },
      },
    });
    const { res, body } = await html('/posting/3dril');
    expect(res.status).toBe(200);
    expect(body).not.toContain('content="noindex"');
    expect(metaContent(body, 'name', 'description')).toBe('dril tweet about candles');
    expect(metaContent(body, 'property', 'og:image')).toBe('https://dame.is/api/og?post=3dril');
  });

  it('credits a repost to the original author rather than to Dame', async () => {
    const poe = 'did:plc:poepoepoepoepoepoepoepoe';
    const subject = `at://${poe}/app.bsky.feed.post/3dispatch`;
    worldFetch({
      records: {
        'app.bsky.feed.repost/3rp': {
          subject: { uri: subject, cid: 'c' },
          createdAt: '2026-10-27T15:00:00.000Z',
        },
      },
      posts: {
        [subject]: {
          uri: subject,
          cid: 'c',
          author: { did: poe, handle: 'poe.atpota.to', displayName: 'Poe' },
          record: { text: 'new dispatch!', createdAt: '2026-10-26T10:00:00.000Z' },
          labels: [],
        },
      },
    });
    const { res, body } = await html('/reposting/3rp');
    expect(res.status).toBe(200);
    expect(body).toContain('<title>Dame reposted a post by Poe (@poe.atpota.to) — dame.is</title>');
    expect(metaContent(body, 'property', 'og:title')).toBe(
      'Dame reposted a post by Poe (@poe.atpota.to) — dame.is',
    );
    expect(metaContent(body, 'name', 'description')).toBe('“new dispatch!”');
    expect(metaContent(body, 'property', 'og:image')).toBe('https://dame.is/api/og?repost=3rp');
    expect(metaContent(body, 'property', 'og:image:alt')).toBe(
      'A post by Poe (@poe.atpota.to): “new dispatch!”',
    );
    // The record behind the page is still Dame's repost.
    expect(body).toContain(`at://${ME_DID}/app.bsky.feed.repost/3rp`);
  });

  it('borrows the owning verb’s copy on a lexicon-form record address', async () => {
    const { res, body } = await html('/is.dame.now/3abc');
    expect(res.status).toBe(200);
    expect(body).toContain('<title>dame.is logging</title>');
  });
});

describe('a link to one passage of an essay', () => {
  const essay = () =>
    worldFetch({
      snapshots: {
        blogs: [
          {
            uri: `at://${ME_DID}/site.standard.document/3blogpost`,
            cid: 'bafyreiexamplecid',
            value: {
              title: 'On moths',
              description: 'Why the light.',
              publishedAt: '2026-05-01T12:00:00.000Z',
              site: BLOG_PUBLICATION,
              content: {
                $type: 'pub.leaflet.content',
                pages: [
                  {
                    blocks: [
                      { block: { $type: 'pub.leaflet.blocks.text', plaintext: "They don't come for the warmth. They come because the light looks like the moon." } },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    });
  const canonicalHref = (body) => body.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null;
  const decode = (s) => s.replace(/&amp;/g, '&');

  it('cards the passage, quotes it in the description, and keeps it in the address', async () => {
    essay();
    const { res, body } = await html('/blogging/3blogpost?quote=the+light+looks+like+the+moon');
    expect(res.status).toBe(200);
    expect(body).toContain('<title>On moths — dame.is</title>');
    expect(decode(metaContent(body, 'property', 'og:image'))).toBe(
      'https://dame.is/api/og?doc=3blogpost&quote=the+light+looks+like+the+moon',
    );
    expect(metaContent(body, 'property', 'og:description')).toBe('“the light looks like the moon”');
    expect(metaContent(body, 'name', 'twitter:description')).toBe('“the light looks like the moon”');
    expect(metaContent(body, 'property', 'og:image:alt')).toBe(
      'A passage from “On moths”: “the light looks like the moon”',
    );
    const here = 'https://dame.is/blogging/3blogpost?quote=the+light+looks+like+the+moon';
    expect(metaContent(body, 'property', 'og:url')).toBe(here);
    expect(canonicalHref(body)).toBe(here);
    // Still the essay's Standard Site embed on Bluesky.
    expect(body).toContain(`<link rel="site.standard.document" href="at://${ME_DID}/site.standard.document/3blogpost" />`);
  });

  it('keeps the passage views out of the index, and the essay in it', async () => {
    essay();
    const { res, body } = await html('/blogging/3blogpost?quote=the+light+looks+like+the+moon');
    expect(metaContent(body, 'name', 'robots')).toBe('noindex');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const plain = await html('/blogging/3blogpost');
    expect(plain.body).not.toContain('content="noindex"');
    expect(canonicalHref(plain.body)).toBe('https://dame.is/blogging/3blogpost');
  });

  it('carries the record’s words, rounded out, not the ones in the link', async () => {
    essay();
    const { body } = await html(`/blogging/3blogpost?quote=${encodeURIComponent('DON’T come for the warm')}`);
    expect(metaContent(body, 'property', 'og:description')).toBe('“don’t come for the warmth”');
    expect(canonicalHref(body)).toBe("https://dame.is/blogging/3blogpost?quote=don't+come+for+the+warmth");
  });

  it('ignores words the essay doesn’t hold, and serves the essay as usual', async () => {
    essay();
    const { res, body } = await html('/blogging/3blogpost?quote=moths+are+overrated');
    expect(res.status).toBe(200);
    expect(metaContent(body, 'property', 'og:image')).toContain('section=blogging');
    expect(metaContent(body, 'property', 'og:description')).toBe('Why the light.');
    expect(canonicalHref(body)).toBe('https://dame.is/blogging/3blogpost');
    expect(body).not.toContain('content="noindex"');
  });

  it('ignores a quote on a page with no essay behind it', async () => {
    worldFetch({
      records: { 'app.bsky.feed.post/3words': { text: 'moths at the porch light', createdAt: '2026-05-01T12:00:00.000Z' } },
    });
    const { body } = await html('/posting/3words?quote=moths+at+the');
    expect(canonicalHref(body)).toBe('https://dame.is/posting/3words');
    expect(body).not.toContain('content="noindex"');
  });
});

describe('pages with no record behind them', () => {
  it('names the profile record only once there is one', async () => {
    worldFetch({ snapshots: { extendedProfile: {} } });
    expect((await html('/themself')).body).not.toContain('name="atproto:uri"');

    worldFetch({
      snapshots: {
        extendedProfile: {
          uri: `at://${ME_DID}/is.dame.profile/self`,
          cid: 'c',
          value: { tagline: 'hi' },
        },
      },
    });
    expect((await html('/themself')).body).toContain(
      `<meta name="atproto:uri" content="at://${ME_DID}/is.dame.profile/self"`,
    );
  });

  it('takes a snapshot that loaded at its word, without asking the PDS', async () => {
    const calls = worldFetch({ snapshots: { pages: {}, extendedProfile: {} } });
    await html('/exploring');
    await html('/themself');
    expect(
      calls.some((u) => u.includes('plc.directory') || u.startsWith(PDS)),
    ).toBe(false);
  });

  it('keeps the explorer’s landing page indexable and its sub-pages out', async () => {
    worldFetch();
    const home = await html('/exploring');
    expect(home.body).toContain('<title>dame.is exploring</title>');
    expect(home.body).not.toContain('content="noindex"');

    const deep = await html(`/exploring/${ME_DID}/is.dame.now`);
    expect(deep.res.status).toBe(200);
    expect(deep.res.headers.get('x-robots-tag')).toBe('noindex');
    expect(deep.body).toContain('<meta name="robots" content="noindex" />');
  });

  it('serves the newsletter’s page under /blogging rather than 404ing it as a post', async () => {
    worldFetch();
    const page = await html('/blogging/subscribe');
    expect(page.res.status).toBe(200);
    expect(page.body).toContain('<title>Subscribe to the dame.is newsletter</title>');
    expect(page.body).not.toContain('content="noindex"');
    // Its own card, drawn as the email, with the page's plain card behind it.
    const image = page.body.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || '';
    const params = new URL(image.replace(/&amp;/g, '&')).searchParams;
    expect(params.get('subscribe')).toBe('1');
    expect(params.get('page')).toBe('/blogging/subscribe');
  });

  it('describes the newsletter’s page with its page record’s intro once there is one', async () => {
    worldFetch({
      snapshots: {
        pages: {
          subscribe: {
            uri: `at://${ME_DID}/is.dame.page/subscribe`,
            cid: 'c',
            value: { title: 'Letters', intro: 'Posts and the odd roundup, by email.' },
          },
        },
      },
    });
    const page = await html('/blogging/subscribe');
    expect(page.body).toContain('content="Posts and the odd roundup, by email."');
    expect(page.body).toContain(`<meta name="atproto:uri" content="at://${ME_DID}/is.dame.page/subscribe"`);
  });
});
