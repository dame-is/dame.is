import { describe, it, expect } from 'vitest';
import { pieceGaps, worthRepairing, gapSummary, healPiece } from './ratioedRepair.js';

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

describe('healPiece — what a rebuild must not lose', () => {
  // The afterlife is rebuilt from the index on every repair, which is right:
  // it is the one window that stays readable. But a rebuilt row is only as good
  // as what the network answers today, and two things on the old row are better
  // than that.
  const late = tidAt(postedMs + 900_000 + 300_000);
  const recorded = piece({
    events: [
      { k: 'reply', offMs: 65_202, did: 'did:plc:a1', h: 'a.test', pre: 1, fr: 100 },
      {
        k: 'reply',
        offMs: 1_200_000,
        did: 'did:plc:late',
        h: 'late.test',
        t: 'what they said at the seal',
        fr: 4988,
        fo: 685,
      },
    ],
    postSeal: { likes: 0, quotes: 0, reposts: 0, threadPosts: 1, participants: 1 },
    audienceAt: SEALED,
  });

  it('keeps text the AppView will no longer serve', () => {
    const { value } = healPiece(recorded, {
      profiles: { 'did:plc:late': { handle: 'late.test', followers: 9 } },
      records: [{ kind: 'reply', did: 'did:plc:late', rkey: late }],
      texts: {}, // the author deactivated; nothing comes back
      selfDid: 'did:plc:me',
    });
    expect(value.events.find((e) => !e.pre).t).toBe('what they said at the seal');
  });

  it('keeps the follower count read at the seal, not the one read today', () => {
    const { value } = healPiece(recorded, {
      profiles: { 'did:plc:late': { handle: 'late.test', followers: 9, follows: 3 } },
      records: [{ kind: 'reply', did: 'did:plc:late', rkey: late }],
      texts: {},
      selfDid: 'did:plc:me',
    });
    const after = value.events.find((e) => !e.pre);
    expect(after.fr).toBe(4988);
    expect(after.fo).toBe(685);
  });

  it('takes a fresher text when there is one', () => {
    const { value } = healPiece(recorded, {
      profiles: {},
      records: [{ kind: 'reply', did: 'did:plc:late', rkey: late }],
      texts: { [`did:plc:late/${late}`]: 'read again today' },
      selfDid: 'did:plc:me',
    });
    expect(value.events.find((e) => !e.pre).t).toBe('read again today');
  });
});

describe('healPiece — the like the index still holds', () => {
  // A piece sealed while Constellation lagged is measured with no reaction time
  // and `likeSurvives: false`. The repair fetches the backlinks anyway; it used
  // to use only the afterlife half of that read and hand the breaker question
  // to the replay, which hard-codes "deleted".
  const lagged = piece({
    breaker: { handle: 'ponder.ooo', likeSurvives: false },
    witnessed: [],
    events: [],
  });

  it('recovers the reaction from the index and says the like still stands', () => {
    const likeRkey = tidAt(postedMs + 895_000);
    const { value, changes } = healPiece(lagged, {
      profiles: {},
      records: [{ kind: 'like', did: 'did:plc:breaker', rkey: likeRkey }],
      selfDid: 'did:plc:me',
    });
    expect(value.breaker.likeSurvives).toBe(true);
    expect(value.breaker.reactionRecovered).toBeUndefined();
    expect(value.breaker.reactionMs).toBe(900_000 - 895_000);
    expect(changes.join(' ')).toMatch(/reaction/);
  });

  it('still falls back to the replay when no like survives', () => {
    const { value } = healPiece(lagged, {
      profiles: {},
      records: [{ kind: 'reply', did: 'did:plc:x', rkey: tidAt(postedMs + 100_000) }],
      replayLike: { at: postedMs + 880_000, rkey: 'R1' },
      selfDid: 'did:plc:me',
    });
    expect(value.breaker.likeSurvives).toBe(false);
    expect(value.breaker.reactionRecovered).toBe(true);
  });
});

describe('gapSummary counts what a repair would actually write', () => {
  it('counts a piece whose only gap is an unnamed row', () => {
    // These four rows read as permanently stuck while one of them resolves
    // today: unnamed means nothing could name it AT MEASURE TIME.
    const stuck = piece({
      breaker: { handle: 'ponder.ooo', did: 'did:plc:breaker', likeSurvives: true, reactionMs: 4596 },
      events: [{ k: 'reply', offMs: 65_202, did: 'did:plc:a1', h: '(unresolvable)', pre: 1, fr: 10 }],
    });
    expect(worthRepairing(stuck)).toBe(true);
    expect(gapSummary([stuck]).fixable).toBe(1);
  });
});

describe('healPiece — audienceAt', () => {
  it('stamps when the afterlife rebuild is what put follower counts on the record', () => {
    const rkey = tidAt(postedMs + 900_000 + 300_000);
    const { value } = healPiece(piece({ events: [] }), {
      profiles: { 'did:plc:late': { handle: 'late.test', followers: 5, follows: 2 } },
      records: [{ kind: 'reply', did: 'did:plc:late', rkey }],
      texts: {},
      selfDid: 'did:plc:me',
      at: '2026-08-18T00:00:00.000Z',
    });
    expect(value.events.some((e) => typeof e.fr === 'number')).toBe(true);
    expect(value.audienceAt).toBe('2026-08-18T00:00:00.000Z');
  });

  it('does not restamp a record that already carries one', () => {
    const { value } = healPiece(piece({ audienceAt: SEALED, events: [] }), {
      profiles: { 'did:plc:late': { handle: 'late.test', followers: 5 } },
      records: [{ kind: 'reply', did: 'did:plc:late', rkey: tidAt(postedMs + 1_200_000) }],
      selfDid: 'did:plc:me',
      at: '2026-08-18T00:00:00.000Z',
    });
    expect(value.audienceAt).toBe(SEALED);
  });
});
