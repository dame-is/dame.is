// /curating/:slug resolution — the one record route whose human copy does not
// live on the record. The channel record carries `arenaSlug` plus OPTIONAL
// title/description overrides; the name a person reads is on are.na, baked into
// the build's `curating` snapshot. So a gallery published (or renamed) since the
// last deploy has to be resolved live, and the card used to fall through to a
// humanized rkey there — the slug with its apostrophes filed off.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordMeta } from './records.js';
import { ME_DID, COLLECTIONS } from '../src/config.js';

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
