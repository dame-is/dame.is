// /curating/:slug resolution — the one record route whose human copy does not
// live on the record. The channel record carries `arenaSlug` plus OPTIONAL
// title/description overrides; the name a person reads is on are.na, baked into
// the build's `curating` snapshot. So a gallery published (or renamed) since the
// last deploy has to be resolved live, and the card used to fall through to a
// humanized rkey there — the slug with its apostrophes filed off.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordMeta } from './records.js';
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
 * A PDS holding `records` (keyed `collection/rkey`) and an origin serving
 * `snapshots` (keyed by name). Anything else is a 404 — never a throw, since
 * these resolvers ask several places before they give up.
 */
function worldFetch({ records = {}, snapshots = {} } = {}) {
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
