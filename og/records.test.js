// /curating/:slug resolution — the one record route whose human copy does not
// live on the record. The channel record carries `arenaSlug` plus OPTIONAL
// title/description overrides; the name a person reads is on are.na, baked into
// the build's `curating` snapshot. So a gallery published (or renamed) since the
// last deploy has to be resolved live, and the card used to fall through to a
// humanized rkey there — the slug with its apostrophes filed off.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  recordMeta,
  postCardCopy,
  postImages,
  bskyImageUrl,
  avatarThumbUrl,
  photosLabel,
  subjectPost,
  subjectCardCopy,
} from './records.js';
import {
  ME_DID,
  COLLECTIONS,
  BLOG_PUBLICATION,
  PORTFOLIO_PUBLICATION,
} from '../src/config.js';

const ORIGIN = 'https://dame.is';
const PDS = 'https://pds.example';
const RKEY = 'there-are-we-didn-t-start-the-fires';
const ARENA_SLUG = 'there-are-we-didn-t-start-the-fires-by-billy-joel-everywhere-for-those-with-eyes-to-see';
const ARENA_TITLE = 'there are ‘we didn’t start the fires’ by billy joel everywhere for those with eyes to see';

const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const notFound = () => ({ ok: false, status: 400, json: async () => ({}), text: async () => 'RecordNotFound' });

/**
 * A world made of the four things this path fetches: the build's snapshot, the
 * PLC directory, the PDS, and are.na through our own proxy. `galleries` seeds
 * the snapshot, `record` the PDS answer, `channel` what are.na says.
 */
function stubFetch({ galleries = [], record = null, channel = null, arenaOk = true } = {}) {
  const calls = [];
  const fetchMock = vi.fn(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith(`${ORIGIN}/data/curating.json`)) {
      return json({ builtAt: '2026-08-21T18:03:09.678Z', galleries });
    }
    if (url.startsWith('https://plc.directory/')) {
      return json({ service: [{ id: '#atproto_pds', serviceEndpoint: PDS }] });
    }
    if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.getRecord`)) {
      return record ? json(record) : notFound();
    }
    if (url.startsWith(`${ORIGIN}/api/arena`)) {
      return arenaOk && channel ? json(channel) : { ok: false, status: 429, json: async () => ({}), text: async () => '' };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

const channelRecord = (value) => ({
  uri: `at://${ME_DID}/${COLLECTIONS.arenaChannel}/${RKEY}`,
  cid: 'bafyreicfclctxnpxbomibkzyoa52h2z5uzs3dhgaoks7dgiethvr3y5jbe',
  value: { $type: COLLECTIONS.arenaChannel, arenaSlug: ARENA_SLUG, createdAt: '2025-03-11T21:51:00.000Z', ...value },
});

// are.na returns rich text as `{ markdown, html, plain }` on v3.
const ARENA_CHANNEL = {
  slug: ARENA_SLUG,
  title: ARENA_TITLE,
  description: { markdown: 'harry truman, doris day\nred china', html: '<p>…</p>', plain: 'harry truman, doris day\nred china' },
};

const arenaCalls = (calls) => calls.filter((u) => u.startsWith(`${ORIGIN}/api/arena`));

describe('recordMeta — /curating/:slug', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it('names a channel too fresh for the snapshot by asking are.na, not the rkey', async () => {
    const { calls } = stubFetch({ record: channelRecord(), channel: ARENA_CHANNEL });
    const meta = await recordMeta(`/curating/${RKEY}`, ORIGIN);
    expect(meta.title).toBe(ARENA_TITLE);
    expect(meta.description).toBe('harry truman, doris day\nred china');
    expect(meta.nsid).toBe(COLLECTIONS.arenaChannel);
    expect(meta.date).toBe('2025-03-11T21:51:00.000Z');
    // Through our own same-origin proxy, so the account token stays server-side
    // and the edge never talks to api.are.na directly.
    expect(arenaCalls(calls)).toHaveLength(1);
    expect(arenaCalls(calls)[0]).toBe(`${ORIGIN}/api/arena?path=${encodeURIComponent(`/channels/${ARENA_SLUG}`)}`);
  });

  it('prefers the record’s own overrides and leaves are.na alone', async () => {
    const { calls } = stubFetch({
      record: channelRecord({ title: 'an override', description: 'mine, not are.na’s' }),
      channel: ARENA_CHANNEL,
    });
    const meta = await recordMeta(`/curating/${RKEY}`, ORIGIN);
    expect(meta.title).toBe('an override');
    expect(meta.description).toBe('mine, not are.na’s');
    expect(arenaCalls(calls)).toHaveLength(0);
  });

  it('falls back to the humanized rkey when are.na cannot be reached', async () => {
    stubFetch({ record: channelRecord(), channel: ARENA_CHANNEL, arenaOk: false });
    const meta = await recordMeta(`/curating/${RKEY}`, ORIGIN);
    expect(meta.title).toBe('There are we didn t start the fires');
    expect(meta.description).toBe('');
  });

  it('resolves nothing for a gallery the record hides, as the page does', async () => {
    const { calls } = stubFetch({ record: channelRecord({ enabled: false }), channel: ARENA_CHANNEL });
    expect(await recordMeta(`/curating/${RKEY}`, ORIGIN)).toBeNull();
    expect(arenaCalls(calls)).toHaveLength(0);
  });

  it('reads a snapshotted gallery from the snapshot alone', async () => {
    const { calls } = stubFetch({
      galleries: [{ slug: RKEY, arenaSlug: ARENA_SLUG, title: ARENA_TITLE, description: 'from the build' }],
      channel: ARENA_CHANNEL,
    });
    const meta = await recordMeta(`/curating/${RKEY}`, ORIGIN);
    expect(meta.title).toBe(ARENA_TITLE);
    expect(meta.description).toBe('from the build');
    expect(arenaCalls(calls)).toHaveLength(0);
    expect(calls.some((u) => u.includes('com.atproto.repo.getRecord'))).toBe(false);
  });

  it('resolves nothing when there is no such channel anywhere', async () => {
    stubFetch({ record: null });
    expect(await recordMeta('/curating/nope-not-a-channel', ORIGIN)).toBeNull();
  });
});

/**
 * A PDS holding `records` (keyed `collection/rkey`), an origin serving
 * `snapshots` (keyed by name), and an AppView that knows the post views in
 * `posts` (keyed by at:// URI). Anything else is a 404 — never a throw, since
 * these resolvers ask several places before they give up.
 */
function worldFetch({ records = {}, snapshots = {}, posts = {} } = {}) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://plc.directory/')) {
        return json({
          service: [{ id: '#atproto_pds', serviceEndpoint: PDS }],
        });
      }
      if (url.startsWith('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts')) {
        const uris = new URL(url).searchParams.getAll('uris');
        return json({ posts: uris.map((u) => posts[u]).filter(Boolean) });
      }
      if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.getRecord`)) {
        const q = new URL(url).searchParams;
        const key = `${q.get('collection')}/${q.get('rkey')}`;
        return records[key]
          ? json({
              uri: `at://${ME_DID}/${key}`,
              cid: 'bafyreiexamplecid',
              value: records[key],
            })
          : notFound();
      }
      const snap = url.match(/\/data\/([^/?]+)\.json$/);
      if (snap && snap[1] in snapshots) return json(snapshots[snap[1]]);
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      };
    }),
  );
  return calls;
}

const doc = (rkey, value) => ({
  uri: `at://${ME_DID}/site.standard.document/${rkey}`,
  cid: 'bafyreiexamplecid',
  value: { $type: 'site.standard.document', ...value },
});

describe('recordMeta — /blogging/:id read live', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves nothing for a draft, as the snapshot does', async () => {
    worldFetch({
      records: {
        'site.standard.document/3draft': {
          title: 'Not yet',
          draft: true,
          site: BLOG_PUBLICATION,
        },
      },
    });
    expect(await recordMeta('/blogging/3draft', ORIGIN)).toBeNull();
  });

  it('resolves nothing for a portfolio work that is not on the blog', async () => {
    worldFetch({
      records: {
        'site.standard.document/3work': {
          title: 'A work',
          site: PORTFOLIO_PUBLICATION,
          tags: [],
        },
      },
    });
    expect(await recordMeta('/blogging/3work', ORIGIN)).toBeNull();
  });

  it('still resolves a blog post too fresh for the snapshot', async () => {
    worldFetch({
      records: {
        'site.standard.document/3fresh': {
          title: 'Fresh',
          site: BLOG_PUBLICATION,
        },
      },
    });
    const meta = await recordMeta('/blogging/3fresh', ORIGIN);
    expect(meta.title).toBe('Fresh');
    expect(meta.canonicalPath).toBe('/blogging/3fresh');
  });

  it('never asks for a leaflet snapshot, which no build writes', async () => {
    const calls = worldFetch();
    await recordMeta('/blogging/3nothing', ORIGIN);
    expect(calls.some((u) => u.includes('/data/leaflets.json'))).toBe(false);
  });
});

describe('recordMeta — one address for a cross-posted document', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('points a blog post shown on /creating back at the blog', async () => {
    worldFetch({
      snapshots: {
        blogs: [
          doc('how-i-made-it', {
            title: 'How I made it',
            path: '/how-i-made-it',
            site: BLOG_PUBLICATION,
            tags: ['creating'],
          }),
        ],
      },
    });
    const meta = await recordMeta('/creating/how-i-made-it', ORIGIN);
    expect(meta.canonicalPath).toBe('/blogging/how-i-made-it');
  });

  it('points a portfolio work shown on /blogging back at /creating', async () => {
    worldFetch({
      snapshots: {
        blogs: [
          doc('3mwork', {
            title: 'Aturi',
            path: '/aturi',
            site: PORTFOLIO_PUBLICATION,
            tags: ['software', 'blog'],
          }),
        ],
      },
    });
    const meta = await recordMeta('/blogging/3mwork', ORIGIN);
    expect(meta.canonicalPath).toBe('/creating/aturi');
  });

  it('leaves a legacy work, which has no publication, under /creating', async () => {
    worldFetch({
      snapshots: {
        creations: [
          {
            uri: `at://${ME_DID}/${COLLECTIONS.creating}/3legacy`,
            cid: 'bafyreiexamplecid',
            value: { title: 'Old thing', slug: 'old-thing' },
          },
        ],
      },
    });
    const meta = await recordMeta('/creating/old-thing', ORIGIN);
    expect(meta.canonicalPath).toBe('/creating/old-thing');
  });
});

describe('recordMeta — records with no text of their own', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves a quote post, keeping its record ref', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.post/3quote': {
          text: '',
          embed: { $type: 'app.bsky.embed.record', record: {} },
        },
      },
    });
    const meta = await recordMeta('/posting/3quote', ORIGIN);
    expect(meta.title).toBe('A quote post');
    expect(meta.textOnly).toBe(true);
    expect(meta.atUri).toBe(`at://${ME_DID}/app.bsky.feed.post/3quote`);
    expect(meta.cid).toBe('bafyreiexamplecid');
  });

  it('names a link post by what it links to', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.post/3link': {
          text: '',
          embed: {
            $type: 'app.bsky.embed.external',
            external: { uri: 'https://x.example', title: 'A page' },
          },
        },
      },
    });
    expect((await recordMeta('/posting/3link', ORIGIN)).title).toBe(
      'A link to “A page”',
    );
  });

  it('falls back to the verb for a record that is only a pointer', async () => {
    worldFetch({
      records: {
        'app.bsky.graph.follow/3follow': {
          subject: 'did:plc:someone',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });
    const meta = await recordMeta('/following/3follow', ORIGIN);
    expect(meta.title).toBe('A follow');
    expect(meta.date).toBe('2026-01-01T00:00:00.000Z');
  });

  it('still resolves nothing when there is no record at all', async () => {
    worldFetch();
    expect(await recordMeta('/posting/3nothing', ORIGIN)).toBeNull();
    expect(await recordMeta('/photographing/3nothing', ORIGIN)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Photos, and the posts Dame passes on                                */
/* ------------------------------------------------------------------ */

// Real shapes, trimmed: CIDs are long base32 strings and the CDN is addressed
// by them, so the fixtures use ones that look like the real thing.
const CID_A = 'bafkreifkgmd2iisfr7fv3ucbcoqsgaexbp2itcnrwjxl2iqvbrjyehrn7m';
const CID_B = 'bafkreihzx5t5rrb2ryykt2itp3uaa7tvc2jc3teev67ywi7l22gmbpr3da';
const blob = (cid) => ({ $type: 'blob', ref: { $link: cid }, mimeType: 'image/jpeg', size: 1000 });
const image = (cid, alt = '', aspectRatio = { width: 4, height: 3 }) => ({ alt, image: blob(cid), aspectRatio });
const imagesEmbed = (...images) => ({ $type: 'app.bsky.embed.images', images });

describe('postImages / postCardCopy', () => {
  it('reads a plain image embed and the media half of a quote-with-media', () => {
    expect(postImages({ embed: imagesEmbed(image(CID_A, 'a dog')) })).toEqual([
      { cid: CID_A, alt: 'a dog', aspect: 4 / 3 },
    ]);
    const withQuote = {
      embed: {
        $type: 'app.bsky.embed.recordWithMedia',
        media: imagesEmbed(image(CID_B, 'dril tweet')),
        record: { $type: 'app.bsky.embed.record', record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' } },
      },
    };
    expect(postImages(withQuote).map((p) => p.alt)).toEqual(['dril tweet']);
  });

  it('builds CDN thumbnails as JPEG, and drops an image whose address looks wrong', () => {
    const copy = postCardCopy({
      text: 'two',
      embed: imagesEmbed(image(CID_A), { alt: 'broken', image: { ref: { $link: '../../etc' } } }),
    });
    expect(copy.photos).toEqual([
      {
        url: `https://cdn.bsky.app/img/feed_thumbnail/plain/${ME_DID}/${CID_A}@jpeg`,
        alt: '',
        aspect: 4 / 3,
      },
    ]);
  });

  it('captions a post with no words by its alt text, and counts photos with none', () => {
    const alt = postCardCopy({ text: '', embed: imagesEmbed(image(CID_A, 'a sunset')) });
    expect(alt).toMatchObject({ text: '', caption: 'a sunset', standIn: '' });
    const bare = postCardCopy({ text: '', embed: imagesEmbed(image(CID_A), image(CID_B)) });
    expect(bare).toMatchObject({ caption: '', standIn: 'Two photos', total: 2 });
  });

  it('keeps photos off a card when a label asks for it, and keeps the words', () => {
    const value = {
      text: 'not for everyone',
      labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }] },
      embed: imagesEmbed(image(CID_A)),
    };
    expect(postCardCopy(value)).toMatchObject({ text: 'not for everyone', photos: [], total: 1 });
    // And an AppView label on somebody else's post does the same.
    const labelled = postCardCopy(
      { text: 'x', embed: imagesEmbed(image(CID_A)) },
      { labels: [{ val: 'graphic-media' }] },
    );
    expect(labelled.photos).toEqual([]);
  });

  it('counts in words, as far as Bluesky allows', () => {
    expect(photosLabel(1)).toBe('A photo');
    expect(photosLabel(4)).toBe('Four photos');
  });
});

describe('bskyImageUrl / avatarThumbUrl', () => {
  it('refuses an address it would not want to fetch', () => {
    expect(bskyImageUrl('did:plc:abc', CID_A)).toContain('/feed_thumbnail/plain/did:plc:abc/');
    expect(bskyImageUrl('https://evil.example', CID_A)).toBeNull();
    expect(bskyImageUrl('did:plc:abc', 'x/../y')).toBeNull();
  });

  it('takes only a CDN avatar, rebuilt as the thumbnail', () => {
    expect(avatarThumbUrl(`https://cdn.bsky.app/img/avatar/plain/did:plc:abc/${CID_A}`)).toBe(
      `https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:abc/${CID_A}@jpeg`,
    );
    expect(avatarThumbUrl('https://example.com/avatar.svg')).toBeNull();
    expect(avatarThumbUrl(undefined)).toBeNull();
  });
});

describe('recordMeta — a post with photos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gives a post with a photo the photo card, read back by its record key', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.post/3cooper': {
          text: 'gm from cooper',
          embed: imagesEmbed(image(CID_A, 'A small tan chihuahua')),
          createdAt: '2026-10-27T12:00:00.000Z',
        },
      },
    });
    const meta = await recordMeta('/posting/3cooper', ORIGIN);
    expect(meta.title).toBe('gm from cooper');
    expect(meta.textOnly).toBe(true);
    // Only the record key rides on the query: no text, no image URL.
    expect(meta.ogQuery).toBe('post=3cooper');
    expect(meta.imageAlt).toBe('gm from cooper (a photo: A small tan chihuahua)');
  });

  it('names a photo-only post by its alt text rather than its embed kind', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.post/3dril': {
          text: '',
          embed: {
            $type: 'app.bsky.embed.recordWithMedia',
            media: imagesEmbed(image(CID_A, 'dril tweet about spending 3,600 on candles')),
            record: { $type: 'app.bsky.embed.record', record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' } },
          },
        },
      },
    });
    const meta = await recordMeta('/posting/3dril', ORIGIN);
    expect(meta.title).toBe('dril tweet about spending 3,600 on candles');
    expect(meta.ogQuery).toBe('post=3dril');
    expect(meta.imageAlt).toBe('A photo by Dame: dril tweet about spending 3,600 on candles');
  });

  it('says which photo an alt text belongs to when there are several', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.post/3web': {
          text: 'good morning',
          embed: imagesEmbed(image(CID_A, 'a spider web'), image(CID_B, 'another'), image(CID_A)),
        },
      },
    });
    expect((await recordMeta('/posting/3web', ORIGIN)).imageAlt).toBe(
      'good morning (three photos, the first: a spider web)',
    );
  });

  it('calls a photo-only post with no alt text what it is', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.post/3bare': { text: '', embed: imagesEmbed(image(CID_A), image(CID_B)) },
      },
    });
    const meta = await recordMeta('/posting/3bare', ORIGIN);
    expect(meta.title).toBe('Two photos by Dame');
    expect(meta.imageAlt).toBe('Two photos by Dame');
  });

  it('cuts a transcript-length alt text short in the head', async () => {
    const long = `Screenshot. ${'word '.repeat(200)}`;
    worldFetch({
      records: { 'app.bsky.feed.post/3long': { text: '', embed: imagesEmbed(image(CID_A, long)) } },
    });
    const meta = await recordMeta('/posting/3long', ORIGIN);
    expect(meta.title.length).toBeLessThanOrEqual(280);
    expect(meta.title.endsWith('…')).toBe(true);
  });

  it('keeps the words-only card for a post whose photos a label keeps off', async () => {
    worldFetch({
      records: {
        'app.bsky.feed.post/3label': {
          text: 'careful',
          labels: { values: [{ val: 'porn' }] },
          embed: imagesEmbed(image(CID_A)),
        },
      },
    });
    const meta = await recordMeta('/posting/3label', ORIGIN);
    expect(meta.title).toBe('careful');
    expect(meta.ogQuery).toBeUndefined();
  });

  it('leaves a text post exactly as it was', async () => {
    worldFetch({ records: { 'app.bsky.feed.post/3text': { text: 'moats' } } });
    const meta = await recordMeta('/posting/3text', ORIGIN);
    expect(meta.title).toBe('moats');
    expect(meta.ogQuery).toBeUndefined();
    expect(meta.imageAlt).toBeUndefined();
  });
});

const POE_DID = 'did:plc:poepoepoepoepoepoepoepoe';
const POE_POST = `at://${POE_DID}/app.bsky.feed.post/3dispatch`;
const poeView = (record, extra = {}) => ({
  uri: POE_POST,
  cid: 'bafyreipoe',
  author: {
    did: POE_DID,
    handle: 'poe.atpota.to',
    displayName: 'Poe',
    avatar: `https://cdn.bsky.app/img/avatar/plain/${POE_DID}/${CID_B}`,
    labels: [],
    ...(extra.author || {}),
  },
  record: { $type: 'app.bsky.feed.post', createdAt: '2026-10-26T10:00:00.000Z', ...record },
  labels: extra.labels || [],
});
const repostOf = (uri) => ({
  $type: 'app.bsky.feed.repost',
  subject: { uri, cid: 'bafyreipoe' },
  createdAt: '2026-10-27T15:00:00.000Z',
});

describe('recordMeta — reposts and likes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('credits a repost to whoever wrote the post, and quotes it', async () => {
    worldFetch({
      records: { 'app.bsky.feed.repost/3rp': repostOf(POE_POST) },
      posts: { [POE_POST]: poeView({ text: 'new dispatch! bluesky put profile links in your own repo' }) },
    });
    const meta = await recordMeta('/reposting/3rp', ORIGIN);
    expect(meta.title).toBe('Dame reposted a post by Poe (@poe.atpota.to)');
    expect(meta.description).toBe('“new dispatch! bluesky put profile links in your own repo”');
    expect(meta.textOnly).toBe(false);
    expect(meta.ogQuery).toBe('repost=3rp');
    expect(meta.imageAlt).toBe(
      'A post by Poe (@poe.atpota.to): “new dispatch! bluesky put profile links in your own repo”',
    );
    // The page is still the repost record's own.
    expect(meta.atUri).toBe(`at://${ME_DID}/app.bsky.feed.repost/3rp`);
    expect(meta.nsid).toBe('app.bsky.feed.repost');
    expect(meta.date).toBe('2026-10-27T15:00:00.000Z');
  });

  it('describes a reposted photo by its alt text', async () => {
    worldFetch({
      records: { 'app.bsky.feed.repost/3rp': repostOf(POE_POST) },
      posts: { [POE_POST]: poeView({ text: '', embed: imagesEmbed(image(CID_A, 'a weevil')) }) },
    });
    const meta = await recordMeta('/reposting/3rp', ORIGIN);
    expect(meta.description).toBe('a weevil');
    expect(meta.imageAlt).toBe('A photo by Poe (@poe.atpota.to): a weevil');
  });

  it('says liked for a like, and the handle alone when there is no display name', async () => {
    worldFetch({
      records: { 'app.bsky.feed.like/3lk': { ...repostOf(POE_POST), $type: 'app.bsky.feed.like' } },
      posts: { [POE_POST]: poeView({ text: 'hi' }, { author: { displayName: '' } }) },
    });
    const meta = await recordMeta('/liking/3lk', ORIGIN);
    expect(meta.title).toBe('Dame liked a post by @poe.atpota.to');
    expect(meta.ogQuery).toBe('like=3lk');
  });

  it('says so when Dame reposts their own post', async () => {
    const own = `at://${ME_DID}/app.bsky.feed.post/3own`;
    worldFetch({
      records: { 'app.bsky.feed.repost/3rp': repostOf(own) },
      posts: {
        [own]: {
          ...poeView({ text: 'mine' }),
          uri: own,
          author: { did: ME_DID, handle: 'dame.is', displayName: 'dame' },
        },
      },
    });
    expect((await recordMeta('/reposting/3rp', ORIGIN)).title).toBe('Dame reposted their own post');
  });

  it('keeps the plain verb card when the AppView cannot name the post', async () => {
    worldFetch({ records: { 'app.bsky.feed.repost/3rp': repostOf(POE_POST) } });
    const meta = await recordMeta('/reposting/3rp', ORIGIN);
    expect(meta.title).toBe('A repost');
    expect(meta.textOnly).toBe(true);
    expect(meta.ogQuery).toBeUndefined();
  });

  it('leaves out an author who asked not to be shown to signed-out readers', async () => {
    worldFetch({
      records: { 'app.bsky.feed.repost/3rp': repostOf(POE_POST) },
      posts: { [POE_POST]: poeView({ text: 'hi' }, { author: { labels: [{ val: '!no-unauthenticated' }] } }) },
    });
    const meta = await recordMeta('/reposting/3rp', ORIGIN);
    expect(meta.title).toBe('A repost');
    expect(meta.ogQuery).toBeUndefined();
  });

  it('never asks the AppView about a subject that is not a Bluesky post', async () => {
    const calls = worldFetch({
      records: {
        'social.grain.favorite/3fav': {
          subject: 'at://did:plc:x/social.grain.gallery/3g',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });
    const meta = await recordMeta('/liking/3fav', ORIGIN);
    expect(meta.title).toBe('A like');
    expect(calls.some((u) => u.includes('getPosts'))).toBe(false);
  });

  it('hands the card renderer the same post, author and photos', async () => {
    worldFetch({
      records: { 'app.bsky.feed.repost/3rp': repostOf(POE_POST) },
      posts: { [POE_POST]: poeView({ text: 'look', embed: imagesEmbed(image(CID_A, 'a weevil')) }) },
    });
    const copy = subjectCardCopy(await subjectPost('reposting', '3rp'));
    expect(copy.text).toBe('look');
    expect(copy.author).toEqual({
      name: 'Poe',
      handle: 'poe.atpota.to',
      avatar: `https://cdn.bsky.app/img/avatar_thumbnail/plain/${POE_DID}/${CID_B}@jpeg`,
    });
    // The photo lives in the AUTHOR's repo, so the CDN is asked under their DID.
    expect(copy.photos[0].url).toBe(
      `https://cdn.bsky.app/img/feed_thumbnail/plain/${POE_DID}/${CID_A}@jpeg`,
    );
  });
});
