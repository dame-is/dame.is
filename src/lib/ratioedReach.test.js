import { describe, it, expect } from 'vitest';
import {
  REACH_WEIGHTS,
  audienceRatio,
  qualityFactor,
  foldAudience,
  windowReach,
  pieceReach,
  projectReach,
  audienceIsFresh,
  fmtReach,
  fmtRatio,
} from './ratioedReach.js';

/** An event log entry, in the shape `normalizePiece` hands to the charts. */
function ev(k, opts = {}) {
  return { k, h: opts.h || 'someone.bsky.social', off: opts.off ?? 1, pre: opts.pre ?? 1, ...opts };
}

describe('audienceRatio', () => {
  it('divides followers by follows', () => {
    expect(audienceRatio(1000, 250)).toBe(4);
    expect(audienceRatio(200, 5000)).toBeCloseTo(0.04, 5);
  });

  it('returns null when there is nothing measured to divide', () => {
    expect(audienceRatio(null, 100)).toBeNull();
    expect(audienceRatio(1000, null)).toBeNull();
    expect(audienceRatio(undefined, undefined)).toBeNull();
  });

  it('treats a zero-follows account as its own follower count, not infinity', () => {
    expect(audienceRatio(400, 0)).toBe(400);
    expect(audienceRatio(0, 0)).toBeNull();
  });
});

describe('qualityFactor', () => {
  it('never inflates an audience, however good the ratio', () => {
    for (const ratio of [1, 4, 90, 5000]) expect(qualityFactor(ratio)).toBe(1);
  });

  it('discounts a follow-back audience by the root of its ratio', () => {
    expect(qualityFactor(0.25)).toBeCloseTo(0.5, 5);
    expect(qualityFactor(0.04)).toBeCloseTo(0.2, 5);
  });

  it('makes no adjustment when the ratio is unknown', () => {
    expect(qualityFactor(null)).toBe(1);
    expect(qualityFactor(0)).toBe(1);
    expect(qualityFactor(Number.NaN)).toBe(1);
  });
});

describe('foldAudience', () => {
  it('counts an audience once however many times its owner acted', () => {
    const [p] = foldAudience([
      ev('repost', { did: 'did:plc:a', fr: 1000, fo: 1000 }),
      ev('reply', { did: 'did:plc:a', fr: 1000, fo: 1000, off: 2 }),
      ev('reply', { did: 'did:plc:a', fr: 1000, fo: 1000, off: 3 }),
    ]);
    // The repost, not repost + reply + reply: the same followers saw it once.
    expect(p.kind).toBe('repost');
    expect(p.raw).toBe(1000);
  });

  it('credits the strongest act regardless of the order it arrived in', () => {
    const [p] = foldAudience([
      ev('like', { did: 'did:plc:a', fr: 500, fo: 100 }),
      ev('quote', { did: 'did:plc:a', fr: 500, fo: 100, off: 9 }),
    ]);
    expect(p.kind).toBe('quote');
    expect(p.raw).toBe(500);
  });

  it('keeps the two sides of the seal apart', () => {
    const events = [
      ev('repost', { did: 'did:plc:a', fr: 100, fo: 100, pre: 1 }),
      ev('repost', { did: 'did:plc:b', fr: 900, fo: 900, pre: 0 }),
    ];
    expect(foldAudience(events, { pre: true }).map((p) => p.did)).toEqual(['did:plc:a']);
    expect(foldAudience(events, { pre: false }).map((p) => p.did)).toEqual(['did:plc:b']);
  });

  it("leaves out the artist's own records, as every other count does", () => {
    expect(foldAudience([ev('reply', { did: 'did:plc:me', fr: 4000, fo: 400, self: 1 })])).toEqual(
      [],
    );
  });

  it('picks up an audience figure carried by any of a person’s events', () => {
    const [p] = foldAudience([
      ev('reply', { did: 'did:plc:a' }),
      ev('reply', { did: 'did:plc:a', fr: 300, fo: 300, off: 2 }),
    ]);
    expect(p.known).toBe(true);
    expect(p.followers).toBe(300);
  });

  it('marks an unmeasured audience unknown rather than empty', () => {
    const [p] = foldAudience([ev('repost', { did: 'did:plc:gone' })]);
    expect(p.known).toBe(false);
    expect(p.followers).toBeNull();
    expect(p.raw).toBe(0);
  });

  it('falls back to the handle when a log predates recorded DIDs', () => {
    const folded = foldAudience([
      ev('repost', { h: 'a.example', fr: 10, fo: 10 }),
      ev('reply', { h: 'a.example', fr: 10, fo: 10, off: 4 }),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0].key).toBe('handle:a.example');
  });
});

describe('windowReach', () => {
  const events = [
    // A broadcast account: the whole audience, undiscounted.
    ev('repost', { did: 'did:plc:big', h: 'big.example', fr: 40000, fo: 400, pre: 1 }),
    // A follow-back account replying: weighted down twice over.
    ev('reply', { did: 'did:plc:small', h: 'small.example', fr: 200, fo: 5000, pre: 1, off: 5 }),
    // Nobody's audience is known here.
    ev('like', { did: 'did:plc:gone', h: '(unresolvable)', pre: 1, off: 7 }),
    // After the seal, so it belongs to the other window entirely.
    ev('quote', { did: 'did:plc:later', h: 'later.example', fr: 900, fo: 900, pre: 0, off: 900 }),
  ];

  it('weights each audience by the strongest act that exposed it', () => {
    const w = windowReach(events, true);
    // 40000×1 (repost) + 200×0.1 (reply) + 0 (unknown audience)
    expect(w.raw).toBe(40020);
  });

  it('applies the ratio discount only to the accounts that earn one', () => {
    const w = windowReach(events, true);
    // The big account keeps all 40000; the reply's 20 keeps sqrt(0.04) = 20%.
    expect(w.weighted).toBe(Math.round(40000 + 20 * 0.2));
    expect(w.weighted).toBeLessThan(w.raw);
  });

  it('separates people it could not measure from people who reached nobody', () => {
    const w = windowReach(events, true);
    expect(w.people).toBe(3);
    expect(w.known).toBe(2);
    expect(w.unknown).toBe(1);
  });

  it('names the account the total mostly came from', () => {
    const w = windowReach(events, true);
    expect(w.top.handle).toBe('big.example');
    expect(w.topShare).toBeGreaterThan(0.99);
  });

  it('reports the unweighted ceiling beside the weighted total', () => {
    expect(windowReach(events, true).audience).toBe(40200);
  });

  it('has a shape even when the window is empty', () => {
    const w = windowReach([], true);
    expect(w.raw).toBe(0);
    expect(w.top).toBeNull();
    expect(w.contributors).toEqual([]);
  });
});

describe('pieceReach', () => {
  it('splits a piece either side of its seal', () => {
    const r = pieceReach([
      ev('repost', { did: 'did:plc:a', fr: 1000, fo: 100, pre: 1 }),
      ev('repost', { did: 'did:plc:b', fr: 5000, fo: 500, pre: 0 }),
    ]);
    expect(r.measurable).toBe(true);
    expect(r.alive.raw).toBe(1000);
    expect(r.after.raw).toBe(5000);
  });

  it('says it cannot measure rather than reporting a confident zero', () => {
    const r = pieceReach([ev('like', { did: 'did:plc:a' })]);
    expect(r.measurable).toBe(false);
    expect(r.alive.raw).toBe(0);
  });

  it("does not count the artist's own log as a measurable audience", () => {
    expect(pieceReach([ev('reply', { did: 'did:plc:me', fr: 4000, fo: 40, self: 1 })]).measurable)
      .toBe(false);
  });

  it('tolerates a piece with no log at all', () => {
    expect(pieceReach(null).measurable).toBe(false);
  });
});

describe('projectReach', () => {
  const pieces = [
    {
      take: 1,
      events: [
        ev('repost', { did: 'did:plc:a', fr: 1000, fo: 100, pre: 1 }),
        ev('repost', { did: 'did:plc:b', fr: 9000, fo: 900, pre: 0 }),
      ],
    },
    { take: 2, events: [ev('quote', { did: 'did:plc:c', fr: 500, fo: 50, pre: 1 })] },
    // Measured before audiences were recorded: skipped, not counted as zero.
    { take: 3, events: [ev('repost', { did: 'did:plc:d', pre: 1 })] },
  ];

  it('totals both windows across every piece it can measure', () => {
    const r = projectReach(pieces, (p) => p.events);
    expect(r.measured).toBe(2);
    expect(r.unmeasured).toBe(1);
    expect(r.aliveRaw).toBe(1500);
    expect(r.afterRaw).toBe(9000);
    expect(r.totalRaw).toBe(10500);
  });

  it('reports how much of the reach landed after the pieces were dead', () => {
    expect(projectReach(pieces, (p) => p.events).afterlifeShare).toBeCloseTo(9000 / 10500, 5);
  });

  it('ranks pieces by the audience they reached while alive', () => {
    expect(projectReach(pieces, (p) => p.events).perPiece.map((r) => r.piece.take)).toEqual([1, 2]);
  });

  it('reads a piece’s own log when no resolver is given', () => {
    expect(projectReach(pieces).aliveRaw).toBe(1500);
  });
});

describe('audienceIsFresh', () => {
  const sealed = '2026-08-15T14:00:00Z';

  it('counts a reading taken the same day as describing the piece', () => {
    expect(audienceIsFresh('2026-08-15T19:30:00Z', sealed)).toBe(true);
  });

  it('still counts one taken a few days later', () => {
    expect(audienceIsFresh('2026-08-20T09:00:00Z', sealed)).toBe(true);
  });

  it('stops counting past a week', () => {
    expect(audienceIsFresh('2026-08-23T09:00:00Z', sealed)).toBe(false);
  });

  it('calls a backfilled audience stale however recently it was read', () => {
    expect(audienceIsFresh('2026-08-15T19:00:00Z', '2025-06-16T14:09:16Z')).toBe(false);
  });

  it('accepts a reading from just before the seal, where the studio measures', () => {
    expect(audienceIsFresh('2026-08-15T13:59:00Z', sealed)).toBe(true);
  });

  it('treats an unknown date as stale, which is what the caveat is for', () => {
    expect(audienceIsFresh('', sealed)).toBe(false);
    expect(audienceIsFresh('2026-08-15T19:00:00Z', '')).toBe(false);
  });
});

describe('formatting', () => {
  it('prints reach to three significant figures at most', () => {
    expect(fmtReach(940)).toBe('940');
    expect(fmtReach(1240)).toBe('1.2k');
    expect(fmtReach(41200)).toBe('41k');
    expect(fmtReach(1240000)).toBe('1.2M');
    expect(fmtReach(0)).toBe('0');
  });

  it('prints a ratio with the precision it deserves', () => {
    expect(fmtRatio(4.123)).toBe('4.12×');
    expect(fmtRatio(41.2)).toBe('41.2×');
    expect(fmtRatio(412)).toBe('412×');
    expect(fmtRatio(null)).toBe('—');
  });
});

describe('the weights themselves', () => {
  it('rates broadcast acts above conversational ones', () => {
    expect(REACH_WEIGHTS.repost).toBe(1);
    expect(REACH_WEIGHTS.quote).toBe(1);
    expect(REACH_WEIGHTS.reply).toBeLessThan(REACH_WEIGHTS.repost);
    expect(REACH_WEIGHTS.like).toBeLessThan(REACH_WEIGHTS.reply);
  });
});
