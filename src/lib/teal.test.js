import { describe, it, expect } from 'vitest';
import {
  TEAL_PLAY_NSIDS,
  TEAL_STATUS_NSIDS,
  dedupePlaysByRkey,
  playArtistLine,
  playArtistNames,
  playOriginUrl,
  playTrackName,
  playedAtOf,
  statusPlay,
} from './teal.js';
import { verbConfig } from './verbRegistry.js';
import { siblingCollections } from './recordRoutes.js';
import {
  dedupeVerbAggregate,
  mergeCollectionSnapshots,
  shouldWriteCombinedVerbFile,
  snapshotNameFor,
} from './feedBuilder.js';

const DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
const uri = (nsid, rkey) => `at://${DID}/${nsid}/${rkey}`;
const PROD = 'fm.teal.feed.play';
const ALPHA = 'fm.teal.alpha.feed.play';

/** A production-shaped play (originUri, artists[]). */
const prodPlay = (rkey, over = {}) => ({
  uri: uri(PROD, rkey),
  value: {
    $type: PROD,
    trackName: 'Love Sensation',
    artists: [{ artistName: 'Madonna & Kylie Minogue' }],
    originUri: 'https://music.apple.com/us/album/love-sensation/6798373683?i=6798373693',
    playedTime: '2026-08-13T00:26:31Z',
    createdAt: '2026-08-13T00:26:31Z',
    ...over,
  },
});

/** The same play as teal's alpha lexicon spelled it (originUrl). */
const alphaPlay = (rkey, over = {}) => ({
  uri: uri(ALPHA, rkey),
  value: {
    $type: ALPHA,
    trackName: 'Lady Lady',
    artists: [{ artistName: 'Olivia Dean' }],
    originUrl: 'https://music.apple.com/us/album/lady-lady/1817609404?i=1817609407',
    musicServiceBaseDomain: 'music.apple.com',
    playedTime: '2026-08-11T01:48:12Z',
    createdAt: '2026-08-11T01:48:12Z',
    ...over,
  },
});

describe('the teal.fm namespace move', () => {
  it('reads production and alpha plays, production first', () => {
    // The order is the priority — every dedupe in this file leans on it.
    expect(TEAL_PLAY_NSIDS).toEqual([PROD, ALPHA]);
    expect(TEAL_STATUS_NSIDS).toEqual(['fm.teal.actor.status', 'fm.teal.alpha.actor.status']);
  });

  it('takes its play lexicons from the listening verb', () => {
    // If these ever drift apart, the feed would ingest a lexicon the accessors
    // and dedupe don't know about (or vice versa).
    expect(verbConfig('listening').collections.map((c) => c.nsid)).toEqual(TEAL_PLAY_NSIDS);
    expect(verbConfig('listening').dedupe).toBe('rkey');
  });
});

describe('play field accessors', () => {
  it('reads the origin URL under either spelling', () => {
    expect(playOriginUrl({ originUri: 'https://a' })).toBe('https://a');
    expect(playOriginUrl({ originUrl: 'https://b' })).toBe('https://b');
    // Production wins if a record somehow carries both.
    expect(playOriginUrl({ originUri: 'https://a', originUrl: 'https://b' })).toBe('https://a');
    expect(playOriginUrl({})).toBeNull();
  });

  it('reads artists from `artists`, deprecated `artistNames`, or a bare string', () => {
    expect(playArtistNames({ artists: [{ artistName: 'Kelela' }, { artistName: 'Asmara' }] }))
      .toEqual(['Kelela', 'Asmara']);
    expect(playArtistNames({ artistNames: ['Kelela', 'Asmara'] })).toEqual(['Kelela', 'Asmara']);
    expect(playArtistNames({ artist: 'Kelela' })).toEqual(['Kelela']);
    expect(playArtistNames({})).toEqual([]);
    expect(playArtistLine({ artistNames: ['Kelela', 'Asmara'] })).toBe('Kelela, Asmara');
  });

  it('reads the track name and played time', () => {
    expect(playTrackName({ trackName: '  Washed Away  ' })).toBe('Washed Away');
    expect(playTrackName({ track: 'Washed Away' })).toBe('Washed Away');
    expect(playTrackName({})).toBe('');
    expect(playedAtOf({ playedTime: '2026-08-13T00:26:31Z' })).toBe('2026-08-13T00:26:31Z');
    expect(playedAtOf({})).toBeNull();
  });
});

describe('dedupePlaysByRkey', () => {
  it('keeps the production copy of a play written under both namespaces', () => {
    // The migration preserves rkeys, so the same rkey in both collections is
    // one play — not two.
    const out = dedupePlaysByRkey([alphaPlay('3msrio'), prodPlay('3msrio')]);
    expect(out).toHaveLength(1);
    expect(out[0].uri).toBe(uri(PROD, '3msrio'));
  });

  it('wins regardless of which namespace came first in the list', () => {
    const out = dedupePlaysByRkey([prodPlay('3msrio'), alphaPlay('3msrio')]);
    expect(out.map((r) => r.uri)).toEqual([uri(PROD, '3msrio')]);
  });

  it('leaves distinct rkeys alone and preserves their order', () => {
    const out = dedupePlaysByRkey([prodPlay('c'), alphaPlay('b'), prodPlay('a')]);
    expect(out.map((r) => r.uri)).toEqual([uri(PROD, 'c'), uri(ALPHA, 'b'), uri(PROD, 'a')]);
  });

  it('reads unified-feed items by atUri too', () => {
    const items = [
      { atUri: uri(ALPHA, '3msrio'), verb: 'listening' },
      { atUri: uri(PROD, '3msrio'), verb: 'listening' },
    ];
    expect(dedupePlaysByRkey(items, (i) => i.atUri)).toEqual([items[1]]);
  });

  it('passes through entries with no resolvable rkey rather than dropping them', () => {
    const orphan = { uri: null, value: {} };
    expect(dedupePlaysByRkey([orphan, prodPlay('a')])).toHaveLength(2);
  });
});

describe('statusPlay', () => {
  const status = (over) => ({
    uri: uri('fm.teal.actor.status', 'self'),
    value: {
      time: '2026-08-13T00:26:31Z',
      item: { trackName: 'Love Sensation', artists: [{ artistName: 'Madonna' }] },
      ...over,
    },
  });

  it('returns the track while the status is still current', () => {
    const now = Date.parse('2026-08-13T00:30:00Z');
    expect(statusPlay(status({ expiry: '2026-08-13T00:36:31Z' }), now)?.trackName)
      .toBe('Love Sensation');
  });

  it('goes quiet once the status has expired', () => {
    const now = Date.parse('2026-08-13T01:00:00Z');
    expect(statusPlay(status({ expiry: '2026-08-13T00:36:31Z' }), now)).toBeNull();
  });

  it('falls back to the lexicon-documented ten minutes when there is no expiry', () => {
    expect(statusPlay(status({}), Date.parse('2026-08-13T00:35:00Z'))).not.toBeNull();
    expect(statusPlay(status({}), Date.parse('2026-08-13T00:37:00Z'))).toBeNull();
  });

  it('is null for a missing or itemless record', () => {
    expect(statusPlay(null)).toBeNull();
    expect(statusPlay({ value: { time: '2026-08-13T00:26:31Z' } })).toBeNull();
  });
});

describe('the listening snapshot', () => {
  it('routes both lexicons into the one listening.json', () => {
    expect(snapshotNameFor('listening', 'teal', PROD)).toBe('listening');
    expect(snapshotNameFor('listening', 'teal', ALPHA)).toBe('listening');
  });

  it('merges the second lexicon in newest-first instead of overwriting', () => {
    const merged = mergeCollectionSnapshots(
      [prodPlay('new', { createdAt: '2026-08-13T00:26:31Z' })],
      [
        alphaPlay('old', { createdAt: '2026-08-11T01:48:12Z' }),
        alphaPlay('newest', { createdAt: '2026-08-13T09:00:00Z' }),
      ],
    );
    expect(merged.map((r) => r.uri)).toEqual([
      uri(ALPHA, 'newest'),
      uri(PROD, 'new'),
      uri(ALPHA, 'old'),
    ]);
  });

  it('does not double-count a play present in both lexicons', () => {
    const merged = mergeCollectionSnapshots([prodPlay('3msrio')], [alphaPlay('3msrio')]);
    expect(merged.map((r) => r.uri)).toEqual([uri(PROD, '3msrio')]);
  });

  it('never writes a combined listening.json over the merged one', () => {
    // Both lexicons land in the same file, so there is nothing to combine —
    // and a combined write would replace raw PDS records (what useNowPlaying
    // and /listening read) with feed items.
    expect(shouldWriteCombinedVerbFile(verbConfig('listening'))).toBe(false);
    // Verbs that really do span several files still get theirs.
    expect(shouldWriteCombinedVerbFile(verbConfig('blogging'))).toBe(true);
  });
});

describe('addressing a play by rkey alone', () => {
  it('offers both lexicons for a /listening/{rkey} lookup, production first', () => {
    // Which lexicon holds a given play depends only on when it was scrobbled,
    // so the record page (and the x-ray overlay) has to try both.
    expect(siblingCollections(PROD)).toEqual([PROD, ALPHA]);
  });

  it('starts from whichever lexicon the URL named', () => {
    expect(siblingCollections(ALPHA)).toEqual([ALPHA, PROD]);
  });

  it('is just the one collection for a single-lexicon verb', () => {
    expect(siblingCollections('is.dame.now')).toEqual(['is.dame.now']);
    expect(siblingCollections(null)).toEqual([]);
  });
});

describe('dedupeVerbAggregate', () => {
  it('collapses cross-namespace plays in the unified feed', () => {
    const items = [
      { verb: 'listening', atUri: uri(PROD, '3msrio'), payload: {} },
      { verb: 'listening', atUri: uri(ALPHA, '3msrio'), payload: {} },
      { verb: 'listening', atUri: uri(ALPHA, '3mswf2'), payload: {} },
    ];
    expect(dedupeVerbAggregate('listening', items).map((i) => i.atUri)).toEqual([
      uri(PROD, '3msrio'),
      uri(ALPHA, '3mswf2'),
    ]);
  });

  it('leaves verbs without an rkey collision rule alone', () => {
    const items = [{ verb: 'logging', atUri: uri('is.dame.now', 'a'), payload: {} }];
    expect(dedupeVerbAggregate('logging', items)).toBe(items);
  });
});
