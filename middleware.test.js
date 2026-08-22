import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import middleware, { config } from './middleware.js';

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
    for (const p of ['api/', 'assets/', 'data/', 'sitemap\\.xml', 'llms\\.txt']) {
      expect(config.matcher[0]).toContain(p);
    }
  });
});

describe('paths middleware must not judge', () => {
  it('falls through for its own shell subrequest', async () => {
    expect(await get('/', { 'x-og-shell': '1' })).toBeUndefined();
  });

  it('falls through for generated and static files', async () => {
    for (const p of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/data/blogging.json']) {
      expect(await get(p)).toBeUndefined();
    }
  });

  it('falls through for the legacy paths vercel.json redirects', async () => {
    // These are absent from the route table on purpose. If Vercel ever ran
    // middleware before its redirects, 404ing them would break every old link.
    for (const p of ['/about', '/blog', '/blog/an-old-post', '/resume', '/flushing']) {
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
      '/participants',
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

  it('keeps the shell’s boot-recovery and entry module intact', async () => {
    const body = await (await get('/', { accept: HTML_ACCEPT })).text();
    expect(body).toContain("u.searchParams.has('_r')");
    expect(body).toContain('<script type="module" src="/src/main.jsx"></script>');
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
