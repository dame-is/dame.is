// The album surfaces, seen from the edge.
//
// Two things here are load-bearing and neither is obvious from the code.
//
// First, `/listening/albums` is a page under a section whose leaves are
// records, so the middleware has to be told not to look it up as one — a
// lookup that can only ever miss, and a miss on a record route is a real 404.
//
// Second, an album is derived rather than stored, so the edge resolves one
// from the build's index and only falls back to the PDS for an album first
// played since that build. Getting that fallback wrong means a page the site
// renders and the crawler 404s.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ALBUMS_SEGMENT,
  albumBySlug,
  albumMeta,
  albumsIndex,
  isAlbumPath,
  isRecordRoute,
  playRecord,
  recordMeta,
} from './records.js';
import { ME_DID } from '../src/config.js';

const ORIGIN = 'https://dame.is';
const PDS = 'https://pds.example';
const PROD = 'fm.teal.feed.play';
const ALPHA = 'fm.teal.alpha.feed.play';

const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const notFound = () => ({ ok: false, status: 400, json: async () => ({}), text: async () => 'RecordNotFound' });

const play = (rkey, over = {}, nsid = PROD) => ({
  uri: `at://${ME_DID}/${nsid}/${rkey}`,
  cid: `bafy${rkey}`,
  value: {
    $type: nsid,
    trackName: 'Enough for Love',
    artists: [{ artistName: 'Kelela' }],
    releaseName: 'Raven',
    duration: 300,
    playedTime: '2026-03-04T10:00:00Z',
    ...over,
  },
});

/**
 * A world made of the four things these paths fetch: the build's two
 * snapshots, the PLC directory, and the PDS. `albums` and `listening` seed the
 * snapshots; `live` is what listRecords returns for the production lexicon
 * (the alpha one always comes back empty, as it does in practice); `record` is
 * the single-record answer.
 */
function stubFetch({ albums = null, listening = null, live = [], record = null } = {}) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith(`${ORIGIN}/data/albums.json`)) return albums ? json(albums) : notFound();
      if (url.startsWith(`${ORIGIN}/data/listening.json`)) return listening ? json(listening) : notFound();
      if (url.startsWith('https://plc.directory/')) {
        return json({ service: [{ id: '#atproto_pds', serviceEndpoint: PDS }] });
      }
      if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.listRecords`)) {
        return json({ records: url.includes(encodeURIComponent(ALPHA)) ? [] : live });
      }
      if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.getRecord`)) {
        return record && url.includes(`rkey=${record.uri.split('/').pop()}`) ? json(record) : notFound();
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return calls;
}

const snapshot = (albums) => ({ builtAt: '2026-09-14T00:00:00Z', plays: 99, albums });

const RAVEN = {
  key: 'raven|kelela',
  slug: 'raven-by-kelela',
  title: 'Raven',
  artist: 'Kelela',
  artists: ['Kelela'],
  plays: 3,
  seconds: 900,
  tracks: 2,
  firstPlayed: '2026-03-04T10:00:00Z',
  lastPlayed: '2026-03-06T10:00:00Z',
  lastUri: `at://${ME_DID}/${PROD}/3`,
  sample: play('1').value,
  trackList: [{ name: 'Contact', plays: 2, seconds: 480, lastPlayed: '2026-03-06T10:00:00Z', lastUri: `at://${ME_DID}/${PROD}/3` }],
};

afterEach(() => vi.unstubAllGlobals());

describe('the one segment under /listening that is not a record key', () => {
  it('claims the index and one album, and nothing else', () => {
    expect(ALBUMS_SEGMENT).toBe('albums');
    expect(isAlbumPath('/listening/albums')).toBe(true);
    expect(isAlbumPath('/listening/albums/raven-by-kelela')).toBe(true);
    expect(isAlbumPath('/listening/3msrio2ctbc2x')).toBe(false);
    expect(isAlbumPath('/listening')).toBe(false);
    expect(isAlbumPath('/listening/albums/a/b')).toBe(false);
    expect(isAlbumPath('/mothing/albums')).toBe(false);
  });

  it('keeps the index out of the record lookup that would 404 it', () => {
    expect(isRecordRoute('/listening/3msrio2ctbc2x')).toBe(true);
    expect(isRecordRoute('/listening/albums')).toBe(false);
  });

  it('resolves no record for the index, however it is asked', async () => {
    stubFetch({ listening: [] });
    expect(await recordMeta('/listening/albums', ORIGIN)).toBeNull();
  });
});

describe('albumBySlug', () => {
  it('answers from the build index without touching the network again', async () => {
    const calls = stubFetch({ albums: snapshot([RAVEN]) });
    const album = await albumBySlug('raven-by-kelela', ORIGIN);
    expect(album.title).toBe('Raven');
    expect(calls.every((u) => u.startsWith(`${ORIGIN}/data/albums.json`))).toBe(true);
  });

  it('falls back to the PDS for an album first played since the last build', async () => {
    const calls = stubFetch({
      albums: snapshot([RAVEN]),
      live: [play('9', { releaseName: 'In Rainbows', artists: [{ artistName: 'Radiohead' }], trackName: 'Nude' })],
    });
    const album = await albumBySlug('in-rainbows-by-radiohead', ORIGIN);
    expect(album.title).toBe('In Rainbows');
    expect(album.plays).toBe(1);
    expect(calls.some((u) => u.includes('com.atproto.repo.listRecords'))).toBe(true);
  });

  it('is nothing for a slug nothing has ever played', async () => {
    stubFetch({ albums: snapshot([RAVEN]), live: [] });
    expect(await albumBySlug('never-played-by-nobody', ORIGIN)).toBeNull();
    expect(await albumBySlug('', ORIGIN)).toBeNull();
  });

  it('survives the index being unreadable', async () => {
    stubFetch({ albums: null, live: [play('1')] });
    expect((await albumBySlug('raven-by-kelela', ORIGIN)).title).toBe('Raven');
  });
});

describe('albumMeta', () => {
  it('gives an album its own card query and canonical address', async () => {
    stubFetch({ albums: snapshot([RAVEN]) });
    const meta = await albumMeta('/listening/albums/raven-by-kelela', ORIGIN);
    expect(meta.title).toBe('Raven');
    expect(meta.description).toContain('Raven by Kelela');
    expect(meta.ogQuery).toBe('album=raven-by-kelela');
    expect(meta.canonicalPath).toBe('/listening/albums/raven-by-kelela');
    expect(meta.nsid).toBe(PROD);
    // An album is a grouping, not a record: there is no at:// URI to advertise.
    expect(meta.atUri).toBeNull();
    // The folio dates the card by the last time something off it was played,
    // which is genuinely when the page last changed.
    expect(meta.date).toBe('2026-03-06T10:00:00Z');
  });

  it('answers to an escaped slug the way the address bar sends it', async () => {
    stubFetch({ albums: snapshot([RAVEN]) });
    expect((await albumMeta('/listening/albums/raven-by-kelela', ORIGIN)).title).toBe('Raven');
  });

  it('is nothing for the index, or for a path shaped differently', async () => {
    stubFetch({ albums: snapshot([RAVEN]) });
    expect(await albumMeta('/listening/albums', ORIGIN)).toBeNull();
    expect(await albumMeta('/mothing/albums/raven-by-kelela', ORIGIN)).toBeNull();
  });
});

describe('albumsIndex', () => {
  it('totals the whole shelf, not the slice it returns', async () => {
    const second = { ...RAVEN, key: 'x|y', slug: 'b', title: 'B', artists: ['Radiohead'], plays: 1 };
    stubFetch({ albums: snapshot([RAVEN, second]) });
    const index = await albumsIndex(ORIGIN, { max: 1 });
    expect(index.albums).toHaveLength(1);
    expect(index.total).toBe(2);
    expect(index.plays).toBe(4);
    expect(index.artists).toBe(2);
  });

  it('is nothing when the index cannot be read, so the card draws the page', async () => {
    stubFetch({ albums: null });
    expect(await albumsIndex(ORIGIN)).toBeNull();
  });
});

describe('a play’s own card', () => {
  it('reads a play out of the listening snapshot', async () => {
    const calls = stubFetch({ listening: [play('3msrio')] });
    const found = await playRecord('3msrio', ORIGIN);
    expect(found.value.trackName).toBe('Enough for Love');
    expect(calls.some((u) => u.includes('com.atproto.repo.getRecord'))).toBe(false);
  });

  it('falls back to the PDS for a play scrobbled since the build', async () => {
    stubFetch({ listening: [], record: play('fresh') });
    expect((await playRecord('fresh', ORIGIN)).value.releaseName).toBe('Raven');
  });

  it('gives /listening/:rkey a card of its own, keyed by the record', async () => {
    stubFetch({ listening: [play('3msrio')] });
    const meta = await recordMeta('/listening/3msrio', ORIGIN);
    expect(meta.title).toBe('Enough for Love');
    // The album rides in the description, so a crawler that never draws the
    // card still learns which record the song is off.
    expect(meta.description).toBe('Kelela · Raven');
    expect(meta.ogQuery).toBe('play=3msrio');
  });

  it('cards an alpha-namespace play the same way', async () => {
    stubFetch({ listening: [play('old', {}, ALPHA)] });
    const meta = await recordMeta('/listening/old', ORIGIN);
    expect(meta.nsid).toBe(ALPHA);
    expect(meta.ogQuery).toBe('play=old');
  });

  it('leaves every other record route’s card alone', async () => {
    stubFetch({ listening: [] });
    const meta = await recordMeta('/curating/nope', ORIGIN);
    expect(meta).toBeNull();
  });
});
