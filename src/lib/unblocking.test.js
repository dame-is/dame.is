import { describe, expect, it } from 'vitest';
import {
  QUICK_SECONDS,
  cleanActor,
  countPeople,
  fetchBoard,
  fetchLookup,
  heldWords,
  isDid,
  isStale,
  placedShare,
  readBoard,
  readEvent,
  readLookup,
  readStatus,
  shareWords,
  usableHandle,
} from './unblocking.js';
import { isDid as storeIsDid } from '../../services/unblock-consumer/src/dids.js';

const A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';

describe('what was typed into the lookup', () => {
  it('reads a handle however it was written', () => {
    expect(cleanActor('dame.is')).toBe('dame.is');
    expect(cleanActor('  @Dame.IS  ')).toBe('dame.is');
    expect(cleanActor('@@dame.is')).toBe('dame.is');
    expect(cleanActor('dame.is.')).toBe('dame.is');
    expect(cleanActor('https://bsky.app/profile/dame.is')).toBe('dame.is');
    expect(cleanActor('https://bsky.app/profile/dame.is/post/3abc?x=1')).toBe('dame.is');
  });

  it('takes a bare name to be on bsky.social', () => {
    expect(cleanActor('dame')).toBe('dame.bsky.social');
    expect(cleanActor('@dame')).toBe('dame.bsky.social');
  });

  it('passes a DID through as it is, case and all', () => {
    expect(cleanActor(A)).toBe(A);
    expect(cleanActor(`https://bsky.app/profile/${A}`)).toBe(A);
    expect(cleanActor('did:web:Example.com')).toBe('did:web:Example.com');
  });

  it('gives nothing back for what can’t be an account', () => {
    for (const input of ['', '   ', '@', null, undefined, 'two words', 'did:', 'did:plc:', 'na/me', 'emoji😀.test']) {
      expect(cleanActor(input)).toBe('');
    }
  });

  it('reads a link with a broken escape in it as nobody, without throwing', () => {
    // This is called while the page renders, from whatever is in the address.
    expect(cleanActor('https://bsky.app/profile/%zz')).toBe('');
    expect(cleanActor('https://bsky.app/profile/%E0%A4%A')).toBe('');
  });
});

describe('a handle worth showing', () => {
  it('is the profile’s, unless it is the placeholder for one that no longer verifies', () => {
    expect(usableHandle({ handle: 'dame.is' })).toBe('dame.is');
    expect(usableHandle({ handle: 'handle.invalid' })).toBeNull();
    expect(usableHandle({ handle: '' })).toBeNull();
    expect(usableHandle({})).toBeNull();
    expect(usableHandle(undefined)).toBeNull();
  });
});

describe('what counts as a DID', () => {
  it('agrees with the consumer, which decides what goes into the index', () => {
    const cases = [
      A,
      'did:web:example.com',
      'did:web:localhost%3A8080',
      'did:plc:',
      'did:',
      'dame.is',
      `did:web:${'a'.repeat(600)}`,
      'did:plc:abc def',
      '',
      null,
      42,
    ];
    for (const value of cases) expect(isDid(value)).toBe(storeIsDid(value));
  });
});

describe('reading an unblock', () => {
  it('works out how long the block stood and whether that was quick', () => {
    expect(
      readEvent({ did: A, blockedAt: '2026-11-06T21:20:00+00:00', unblockedAt: '2026-11-09T21:20:00+00:00' }),
    ).toEqual({
      did: A,
      blockedAt: '2026-11-06T21:20:00.000Z',
      unblockedAt: '2026-11-09T21:20:00.000Z',
      heldSeconds: 3 * 86_400,
      quick: false,
    });
    const quick = readEvent({
      did: A,
      blockedAt: '2026-11-06T21:20:00+00:00',
      unblockedAt: '2026-11-06T21:20:10+00:00',
    });
    expect(quick).toMatchObject({ heldSeconds: 10, quick: true });
  });

  it('draws the line at QUICK_SECONDS, which the block has to reach', () => {
    const held = (seconds) =>
      readEvent({
        did: A,
        blockedAt: new Date(0).toISOString(),
        unblockedAt: new Date(seconds * 1000).toISOString(),
      }).quick;
    expect(held(QUICK_SECONDS - 1)).toBe(true);
    expect(held(QUICK_SECONDS)).toBe(false);
  });

  it('drops one it can’t make sense of', () => {
    expect(readEvent(null)).toBeNull();
    expect(readEvent({ did: 'nope', blockedAt: '2026-01-01', unblockedAt: '2026-01-02' })).toBeNull();
    expect(readEvent({ did: A, blockedAt: 'never', unblockedAt: '2026-01-02' })).toBeNull();
    expect(readEvent({ did: A, blockedAt: '2026-01-01' })).toBeNull();
  });

  it('never says a block stood for less than no time', () => {
    const backwards = readEvent({ did: A, blockedAt: '2026-01-02T00:00:00Z', unblockedAt: '2026-01-01T00:00:00Z' });
    expect(backwards.heldSeconds).toBe(0);
  });
});

describe('reading an answer', () => {
  it('reads the ranking and the status', () => {
    const board = readBoard({
      status: {
        startedAt: '2026-11-09T00:00:00.000Z',
        horizonAt: '2026-11-09T00:00:00.000Z',
        lastEventAt: '2026-11-10T18:00:00.000Z',
        publishedAt: '2026-11-10T18:19:44.85+00:00',
        blocksHeld: 480000,
        deletesSeen: 12000,
        deletesPlaced: 300,
      },
      unblocks: 280,
      leaderboard: [
        { did: A, count: 12, latest: '2026-11-10T17:00:00+00:00' },
        { did: 'not a did', count: 9 },
        { did: B, count: 0 },
        { did: B, count: '3', latest: null },
      ],
    });
    expect(board.unblocks).toBe(280);
    expect(board.status).toMatchObject({ blocksHeld: 480000, deletesSeen: 12000, deletesPlaced: 300 });
    expect(board.leaderboard).toEqual([
      { did: A, count: 12, latest: '2026-11-10T17:00:00.000Z' },
      { did: B, count: 3, latest: null },
    ]);
  });

  it('reads an empty or broken answer as nothing, not as an error', () => {
    for (const raw of [null, undefined, {}, { leaderboard: 'no' }, { status: 'no' }]) {
      expect(readBoard(raw)).toEqual({ status: null, unblocks: 0, leaderboard: [] });
    }
    expect(readLookup(null)).toEqual({ did: null, total: 0, quick: 0, events: [] });
  });

  it('has no status until the tracker has said when it started', () => {
    expect(readStatus({ blocksHeld: 5 })).toBeNull();
    expect(readStatus({ startedAt: '2026-11-09T00:00:00Z' })).toMatchObject({
      startedAt: '2026-11-09T00:00:00.000Z',
      // With no horizon of its own, the index reaches back to its start.
      horizonAt: '2026-11-09T00:00:00.000Z',
      lastEventAt: null,
      deletesSeen: 0,
    });
  });

  it('reads one account’s unblocks, and keeps its counts believable', () => {
    const lookup = readLookup({
      did: B,
      total: 3,
      quick: 1,
      events: [
        { did: A, blockedAt: '2026-11-06T21:20:00+00:00', unblockedAt: '2026-11-09T21:20:00+00:00' },
        { did: 'junk' },
      ],
    });
    expect(lookup).toMatchObject({ did: B, total: 3, quick: 1 });
    expect(lookup.events).toHaveLength(1);

    // A total smaller than the list it came with is raised to the list; a
    // quick count larger than the total is held to it.
    const odd = readLookup({
      did: B,
      total: 0,
      quick: 7,
      events: [{ did: A, blockedAt: '2026-11-06T21:20:00Z', unblockedAt: '2026-11-09T21:20:00Z' }],
    });
    expect(odd).toMatchObject({ total: 1, quick: 1 });
  });
});

describe('saying it', () => {
  it('counts people', () => {
    expect(countPeople(1)).toBe('1 person');
    expect(countPeople(12)).toBe('12 people');
    expect(countPeople(1234)).toBe('1,234 people');
    expect(countPeople(0)).toBe('0 people');
  });

  it('says how long a block stood in the largest unit that fits, rounded down', () => {
    const D = 86_400;
    expect(heldWords(0)).toBe('0 seconds');
    expect(heldWords(1)).toBe('1 second');
    expect(heldWords(59)).toBe('59 seconds');
    expect(heldWords(60)).toBe('1 minute');
    expect(heldWords(300)).toBe('5 minutes');
    expect(heldWords(3599)).toBe('59 minutes');
    expect(heldWords(3600)).toBe('1 hour');
    expect(heldWords(D - 1)).toBe('23 hours');
    expect(heldWords(D)).toBe('1 day');
    expect(heldWords(13 * D)).toBe('13 days');
    expect(heldWords(14 * D)).toBe('2 weeks');
    expect(heldWords(60 * D)).toBe('8 weeks');
    expect(heldWords(61 * D)).toBe('2 months');
    expect(heldWords(364 * D)).toBe('11 months');
    expect(heldWords(365 * D)).toBe('1 year');
    expect(heldWords(800 * D)).toBe('2 years');
    expect(heldWords(-5)).toBe('0 seconds');
    expect(heldWords('nope')).toBe('0 seconds');
  });

  it('says what share of deleted blocks could be named, never rounding to all or nothing', () => {
    expect(placedShare(null)).toBeNull();
    expect(placedShare({ deletesSeen: 0, deletesPlaced: 0 })).toBeNull();
    expect(placedShare({ deletesSeen: 200, deletesPlaced: 50 })).toBe(0.25);
    expect(shareWords(0.25)).toBe('25%');
    expect(shareWords(0)).toBe('0%');
    expect(shareWords(0.004)).toBe('under 1%');
    expect(shareWords(0.996)).toBe('over 99%');
    expect(shareWords(1)).toBe('100%');
    expect(shareWords(null)).toBe('');
  });

  it('takes the tracker to have stopped once its newest event is old', () => {
    const now = Date.parse('2026-11-10T18:00:00Z');
    expect(isStale({ lastEventAt: '2026-11-10T17:59:00Z' }, now)).toBe(false);
    expect(isStale({ lastEventAt: '2026-11-10T17:30:00Z' }, now)).toBe(true);
    expect(isStale({ lastEventAt: null }, now)).toBe(false);
    expect(isStale(null, now)).toBe(false);
  });
});

describe('asking the site', () => {
  const answer = (body, ok = true, status = 200) => async (url) => ({ ok, status, json: async () => body, url });

  it('asks for the ranking, and for one account by DID', async () => {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({ did: B, total: 0, quick: 0, events: [] }) };
    };
    await fetchBoard({ fetchImpl });
    await fetchLookup(B, { fetchImpl });
    expect(seen).toEqual(['/api/unblocked', `/api/unblocked?did=${encodeURIComponent(B)}`]);
  });

  it('won’t ask about something that isn’t a DID', async () => {
    await expect(fetchLookup('dame.is', { fetchImpl: answer({}) })).rejects.toThrow();
  });

  it('throws when the tracker can’t be reached, with the status', async () => {
    await expect(fetchBoard({ fetchImpl: answer({ error: 'x' }, false, 503) })).rejects.toMatchObject({
      status: 503,
    });
  });
});
