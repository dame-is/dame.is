import { describe, it, expect } from 'vitest';
import { pieceGaps, worthRepairing, healPiece } from './ratioedRepair.js';

const POSTED = '2026-08-17T00:00:00.000Z';
const postedMs = Date.parse(POSTED);
const SEALED = new Date(postedMs + 900_000).toISOString(); // +15m

/**
 * A record key whose decoded time is `ms`. Every event in this project is timed
 * by its key rather than by any envelope, so a fixture that wants a record to
 * land after the seal has to say so in the key.
 */
const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';
function tidAt(ms) {
  let n = (BigInt(ms) * 1000n << 10n) | 42n;
  let out = '';
  for (let i = 0; i < 13; i += 1) {
    out = TID_ALPHABET[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

/** Take 16's shape: sealed, breaker lost, log names nobody, no afterlife. */
const piece = (over = {}) => ({
  $type: 'is.dame.creating.ratioed.piece',
  take: 16,
  subject: 'at://did:plc:me/app.bsky.feed.post/take16',
  postedAt: POSTED,
  sealedAt: SEALED,
  lifespanMs: 900_000,
  measuredAt: SEALED,
  breaker: { handle: 'unknown', likeSurvives: false },
  preSeal: { likes: 0, quotes: 2, reposts: 1, threadPosts: 16, participants: 13 },
  postSeal: { likes: 0, quotes: 0, reposts: 0, threadPosts: 0, participants: 0 },
  events: [{ k: 'reply', offMs: 65_202, did: 'did:plc:a1', h: '(unresolvable)', pre: 1 }],
  witnessed: [
    { k: 'like', offMs: 895_404, rkey: 'L1', did: 'did:plc:breaker', h: 'ponder.ooo', goneMs: 895_733 },
  ],
  ...over,
});

describe('pieceGaps', () => {
  it('reads what take 16 is missing off the record alone', () => {
    const g = pieceGaps(piece());
    expect(g).toMatchObject({
      breakerUnnamed: true,
      reactionLost: true,
      unnamedRows: 1,
      audienceMissing: true,
      afterlife: true,
      needsAName: false, // the log can name them, so no human is needed
    });
  });

  it('asks for a person only when nothing else can answer', () => {
    const g = pieceGaps(piece({ witnessed: undefined }));
    expect(g.needsAName).toBe(true);
    expect(g.reactionLost).toBe(false);
  });

  it('wants a DID for a breaker recorded by name alone', () => {
    const g = pieceGaps(piece({ breaker: { handle: 'ponder.ooo', likeSurvives: false } }));
    expect(g.breakerNoDid).toBe(true);
    expect(g.breakerUnnamed).toBe(false);
  });

  it('leaves a live piece alone', () => {
    const g = pieceGaps(piece({ sealedAt: undefined }));
    expect(g.sealed).toBe(false);
    expect(worthRepairing(piece({ sealedAt: undefined }))).toBe(false);
  });

  it('finds nothing to do on a record that is already whole', () => {
    const whole = piece({
      breaker: { handle: 'ponder.ooo', did: 'did:plc:breaker', likeSurvives: false, reactionMs: 4596 },
      events: [{ k: 'reply', offMs: 65_202, did: 'did:plc:a1', h: 'a1.test', pre: 1, fr: 100 }],
    });
    expect(worthRepairing(whole)).toBe(false);
  });
});

describe('healPiece', () => {
  const profiles = {
    'did:plc:a1': { handle: 'musicologyduck.test', followers: 35_049, follows: 1728 },
    'did:plc:breaker': { handle: 'ponder.ooo', followers: 500 },
    'did:plc:after1': { handle: 'latecomer.test', followers: 40 },
  };

  it('names the breaker, times them, and keys them by DID', () => {
    const { value, changes } = healPiece(piece(), { profiles });
    expect(value.breaker).toMatchObject({
      handle: 'ponder.ooo',
      did: 'did:plc:breaker',
      likeSurvives: false,
      reactionMs: 4596,
      reactionRecovered: true,
    });
    expect(changes.join(' ')).toMatch(/named @ponder.ooo/);
  });

  it('fills a row that could not be named, and its audience', () => {
    const { value } = healPiece(piece(), { profiles });
    expect(value.events[0]).toMatchObject({ h: 'musicologyduck.test', fr: 35_049, fo: 1728 });
  });

  it('never replaces a handle or an audience the record already carries', () => {
    const measured = piece({
      events: [{ k: 'reply', offMs: 65_202, did: 'did:plc:a1', h: 'as.measured', pre: 1, fr: 11 }],
    });
    const { value } = healPiece(measured, { profiles });
    // The handle was read while the piece ran and the count with it. Today's
    // reading of both is a different measurement, not a better one.
    expect(value.events[0].h).toBe('as.measured');
    expect(value.events[0].fr).toBe(11);
  });

  it('replaces the afterlife and keeps the alive window exactly', () => {
    const records = [
      // One reply, ten minutes after the gate. The recorded row from while the
      // piece was alive is not in this read at all — deleted since, or an index
      // that has forgotten it — and it stays on the record regardless.
      { kind: 'reply', did: 'did:plc:after1', rkey: tidAt(postedMs + 900_000 + 600_000) },
    ];
    const { value, changes } = healPiece(piece(), { profiles, records, selfDid: 'did:plc:me' });
    const alive = value.events.filter((e) => e.pre);
    expect(alive).toHaveLength(1);
    expect(alive[0].offMs).toBe(65_202);
    expect(value.preSeal).toEqual(piece().preSeal);
    expect(changes.some((c) => /since the seal/.test(c))).toBe(true);
  });

  it('does nothing to a record with nothing missing', () => {
    const whole = piece({
      breaker: { handle: 'ponder.ooo', did: 'did:plc:breaker', likeSurvives: false, reactionMs: 4596 },
      events: [{ k: 'reply', offMs: 65_202, did: 'did:plc:a1', h: 'a1.test', pre: 1, fr: 100 }],
    });
    const { changes } = healPiece(whole, { profiles });
    expect(changes).toEqual([]);
  });

  it('takes the reaction time from a replay when nothing was watching', () => {
    const unwatched = piece({
      witnessed: undefined,
      breaker: { handle: 'ponder.ooo', likeSurvives: false },
    });
    const { value, changes } = healPiece(unwatched, {
      profiles,
      breakerDid: 'did:plc:breaker',
      replayLike: { at: postedMs + 880_000, rkey: 'L9' },
    });
    expect(value.breaker).toMatchObject({
      did: 'did:plc:breaker',
      reactionMs: 20_000,
      likeSurvives: false,
      reactionRecovered: true,
    });
    expect(changes.some((c) => /replay/.test(c))).toBe(true);
  });

  it('ignores a replayed like that landed after the gate', () => {
    const unwatched = piece({ witnessed: undefined, breaker: { handle: 'ponder.ooo', likeSurvives: false } });
    const { value } = healPiece(unwatched, {
      profiles,
      replayLike: { at: postedMs + 950_000, rkey: 'L9' },
    });
    expect(value.breaker.reactionMs).toBeUndefined();
  });
});

describe('healPiece — what they said', () => {
  it('writes the text of a post that landed after the seal', () => {
    // The index says a reply exists; only the AppView says what it says. This
    // is the whole of the essay's "reactions no one can see", and a repair that
    // dropped it turned four harvested replies into "(image, no text)".
    const rkey = tidAt(postedMs + 900_000 + 300_000);
    const { value } = healPiece(piece(), {
      profiles: { 'did:plc:late': { handle: 'late.test', followers: 5 } },
      records: [{ kind: 'reply', did: 'did:plc:late', rkey }],
      texts: { [`did:plc:late/${rkey}`]: 'nobody will ever read this' },
      selfDid: 'did:plc:me',
    });
    const after = value.events.find((e) => !e.pre);
    expect(after).toMatchObject({ k: 'reply', h: 'late.test', t: 'nobody will ever read this' });
  });

  it('leaves a row alone when no text came back for it', () => {
    const rkey = tidAt(postedMs + 900_000 + 300_000);
    const { value } = healPiece(piece(), {
      profiles: {},
      records: [{ kind: 'reply', did: 'did:plc:late', rkey }],
      texts: {},
      selfDid: 'did:plc:me',
    });
    expect(value.events.find((e) => !e.pre).t).toBeUndefined();
  });
});
