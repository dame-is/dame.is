import { describe, it, expect } from 'vitest';
import {
  medianOf,
  ratioOf,
  mixOf,
  paceOf,
  firstTouch,
  longestSilence,
  followerStats,
  newcomers,
  pieceStats,
  projectStats,
} from './ratioedStats.js';

// Take 17's shape, cut down: 41m45s, one like at the end, a 4m22s hush in the
// middle, and a breaker who had never been in a take before.
const LIFE = 2_504_693;
const EVENTS = [
  { h: 'a', did: 'did:a', k: 'reply', off: 46, pre: 1, fr: 836 },
  { h: 'b', did: 'did:b', k: 'repost', off: 95, pre: 1, fr: 852 },
  { h: 'a', did: 'did:a', k: 'reply', off: 200, pre: 1, fr: 836 },
  { h: 'me', did: 'did:me', k: 'quote', off: 231, pre: 1, self: 1, fr: 221 },
  { h: 'c', did: 'did:c', k: 'repost', off: 699, pre: 1, fr: 4988 },
  // The hush: 699 → 1003 is 5m04s, the longest stretch here.
  { h: 'd', did: 'did:d', k: 'reply', off: 1003, pre: 1, fr: 59 },
  { h: 'e', did: 'did:e', k: 'like', off: 2503, pre: 1, fr: 3160 },
  { h: 'f', did: 'did:f', k: 'repost', off: 2518, pre: 0, fr: 6229 },
];
const PIECE = {
  take: 17,
  rkey: 'p17',
  lifespanMs: LIFE,
  preSeal: { likes: 1, quotes: 5, reposts: 33, threadPosts: 42, participants: 68 },
};

describe('medianOf', () => {
  it('takes the lower middle of an even list — no piece stood for an average', () => {
    expect(medianOf([10, 20, 30, 40])).toBe(20);
    expect(medianOf([30, 10, 20])).toBe(20);
    expect(medianOf([])).toBe(null);
    expect(medianOf([1, NaN, 3])).toBe(1);
  });
});

describe('ratioOf / mixOf', () => {
  it('counts everything that is not a like against the likes', () => {
    expect(ratioOf(PIECE.preSeal)).toEqual({ nonLike: 80, likes: 1 });
    expect(mixOf(PIECE.preSeal)).toEqual({ replies: 42, reposts: 33, quotes: 5 });
  });

  it('survives a piece whose like was deleted before it was counted', () => {
    expect(ratioOf({ threadPosts: 3 })).toEqual({ nonLike: 3, likes: 0 });
  });
});

describe('paceOf', () => {
  it('is records per minute, and null without a window', () => {
    expect(paceOf(81, 2_504_693)).toBeCloseTo(1.94, 2);
    expect(paceOf(5, 0)).toBe(null);
  });
});

describe('firstTouch', () => {
  it('is the earliest thing somebody else did', () => {
    expect(firstTouch(EVENTS)).toMatchObject({ h: 'a', off: 46 });
  });

  it('ignores the artist and the afterlife', () => {
    expect(firstTouch([{ h: 'me', k: 'quote', off: 1, pre: 1, self: 1 }])).toBe(null);
    expect(firstTouch([{ h: 'x', k: 'reply', off: 1, pre: 0 }])).toBe(null);
  });

  it('is null with no log at all, rather than zero', () => {
    expect(firstTouch(null)).toBe(null);
  });
});

describe('longestSilence', () => {
  it('finds the longest stretch when nothing arrived', () => {
    const s = longestSilence(EVENTS, LIFE);
    expect(Math.round(s.ms / 1000)).toBe(1500); // 1003 → 2503
    expect(Math.round(s.fromMs / 1000)).toBe(1003);
  });

  it('counts the wait before the first thing', () => {
    const s = longestSilence([{ h: 'x', k: 'reply', off: 300, pre: 1 }], 310_000);
    expect(s.fromMs).toBe(0);
    expect(s.ms).toBe(300_000);
  });

  it('counts the hush between the last arrival and the seal', () => {
    const s = longestSilence([{ h: 'x', k: 'reply', off: 5, pre: 1 }], 600_000);
    expect(Math.round(s.fromMs / 1000)).toBe(5);
    expect(Math.round(s.ms / 1000)).toBe(595);
  });

  it('is null for a piece with no length or no log', () => {
    expect(longestSilence(EVENTS, 0)).toBe(null);
    expect(longestSilence([], LIFE)).toBe(null);
  });
});

describe('followerStats', () => {
  it('counts a person once, at their strongest act', () => {
    const s = followerStats(EVENTS);
    // a, b, c, d, e — the artist is out, and `a` appears twice for one figure.
    expect(s.known).toBe(5);
    expect(s.top).toMatchObject({ h: 'c', followers: 4988, kind: 'repost' });
    expect(s.median).toBe(852);
  });

  it('names an amplifier by their furthest-carrying act', () => {
    const s = followerStats([
      { h: 'g', did: 'did:g', k: 'reply', off: 1, pre: 1, fr: 9000 },
      { h: 'g', did: 'did:g', k: 'repost', off: 2, pre: 1, fr: 9000 },
    ]);
    // The repost is why they are the amplifier; the reply came first.
    expect(s.top).toMatchObject({ h: 'g', kind: 'repost' });
    expect(s.known).toBe(1);
  });

  it('reads the other side of the seal on request', () => {
    expect(followerStats(EVENTS, { pre: false }).top.h).toBe('f');
  });

  it('is null when no event carries an audience', () => {
    expect(followerStats([{ h: 'x', k: 'reply', off: 1, pre: 1 }])).toBe(null);
  });

  it('reads followers, not follows', () => {
    // The two fields are one letter apart and reading the wrong one is silent.
    const s = followerStats([{ h: 'x', did: 'did:x', k: 'repost', off: 1, pre: 1, fr: 89334, fo: 685 }]);
    expect(s.top.followers).toBe(89334);
    expect(s.median).toBe(89334);
  });
});

describe('newcomers', () => {
  const pieces = [
    { take: 16, rkey: 'p16' },
    { take: 17, rkey: 'p17' },
  ];
  const earlier = { p16: [{ h: 'a', did: 'did:a', k: 'reply', off: 1, pre: 1 }] };

  it('counts who had never turned up in an earlier take', () => {
    const n = newcomers(EVENTS, pieces, PIECE, (p) => earlier[p.rkey]);
    // a, b, c, d, e were here; only `a` was in take 16.
    expect(n).toEqual({ n: 4, of: 5, blind: 0 });
  });

  it('reports how many earlier logs it could not read', () => {
    const n = newcomers(EVENTS, pieces, PIECE, () => null);
    expect(n).toEqual({ n: 5, of: 5, blind: 1 });
  });

  it('falls back to the handle for a log written before DIDs', () => {
    const n = newcomers(
      [{ h: 'a', k: 'reply', off: 1, pre: 1 }],
      pieces,
      PIECE,
      () => [{ h: 'a', k: 'reply', off: 1, pre: 1 }],
    );
    expect(n).toEqual({ n: 0, of: 1, blind: 0 });
  });
});

describe('pieceStats', () => {
  const series = [
    { take: 15, rkey: 'p15', lifespanMs: 60_000, preSeal: {} },
    { take: 16, rkey: 'p16', lifespanMs: 300_000, preSeal: {} },
    PIECE,
  ];

  it('answers the counts from the record and the timings from the log', () => {
    const s = pieceStats(PIECE, EVENTS, { pieces: series, resolveEvents: () => null });
    // From preSeal, never recounted off the log — the log is missing three
    // dozen of these records and a recount would report a cleaner piece.
    expect(s.ratio).toEqual({ nonLike: 80, likes: 1 });
    expect(s.records).toBe(81);
    expect(s.people).toBe(68);
    // From the log, which is the only place order lives.
    expect(s.first.off).toBe(46);
    expect(Math.round(s.silence.ms / 1000)).toBe(1500);
  });

  it('measures against the middle of the series', () => {
    const s = pieceStats(PIECE, EVENTS, { pieces: series });
    expect(s.medianMs).toBe(300_000);
    expect(s.vsMedian).toBeCloseTo(8.35, 1);
  });

  it('has no median to measure against in a series of one', () => {
    expect(pieceStats(PIECE, EVENTS, { pieces: [PIECE] }).vsMedian).toBe(null);
  });

  it('degrades to the recorded counts when there is no log', () => {
    const s = pieceStats(PIECE, null, { pieces: series });
    expect(s.ratio).toEqual({ nonLike: 80, likes: 1 });
    expect(s.pace).toBeCloseTo(1.94, 2);
    expect(s.first).toBe(null);
    expect(s.silence).toBe(null);
    expect(s.audience).toBe(null);
  });

  it('is null for no piece', () => {
    expect(pieceStats(null, EVENTS, {})).toBe(null);
  });
});

describe('projectStats', () => {
  const pieces = [
    {
      take: 1,
      rkey: 'p1',
      lifespanMs: 60_000,
      preSeal: { likes: 1, quotes: 0, reposts: 2, threadPosts: 5 },
    },
    {
      take: 2,
      rkey: 'p2',
      lifespanMs: 300_000,
      preSeal: { likes: 1, quotes: 1, reposts: 3, threadPosts: 9 },
    },
    { take: 3, rkey: 'p3', lifespanMs: 0, preSeal: {} }, // still up: no figures yet
  ];
  const logs = {
    p1: [
      { h: 'a', did: 'did:a', k: 'reply', off: 10, pre: 1, fr: 100 },
      { h: 'b', did: 'did:b', k: 'reply', off: 50, pre: 1, fr: 900 },
    ],
    p2: [
      { h: 'a', did: 'did:a', k: 'reply', off: 30, pre: 1, fr: 100 },
      { h: 'c', did: 'did:c', k: 'repost', off: 40, pre: 1, fr: 5000 },
    ],
  };

  it('totals the recorded figures and skips a piece still running', () => {
    const s = projectStats(pieces, (p) => logs[p.rkey]);
    expect(s.ratio).toEqual({ nonLike: 20, likes: 2 });
    expect(s.mix).toEqual({ replies: 14, reposts: 5, quotes: 1 });
    expect(s.medianMs).toBe(60_000);
  });

  it('takes the typical first touch and the single worst silence', () => {
    const s = projectStats(pieces, (p) => logs[p.rkey]);
    expect(s.first.off).toBe(10); // median of 10 and 30, lower middle
    expect(s.silence.take).toBe(2); // 40s → 300s is the longest stretch anywhere
    expect(Math.round(s.silence.ms / 1000)).toBe(260);
  });

  it('works with no logs at all, on the counts alone', () => {
    const s = projectStats(pieces);
    expect(s.ratio).toEqual({ nonLike: 20, likes: 2 });
    expect(s.first).toBe(null);
    expect(s.silence).toBe(null);
    expect(s.audience).toBe(null);
  });

  it('is null before anything has finished', () => {
    expect(projectStats([{ take: 1, lifespanMs: 0 }])).toBe(null);
  });
});

describe('counting people across two kinds of log', () => {
  // The bundled harvest names people by handle; every log written since names
  // them by DID. Anything keying on `did || h:handle` puts one person in both
  // spaces, and no count that spans takes can ever match them up.
  const bundled = [
    { h: 'cam', k: 'reply', off: 10, pre: 1, fr: 500 },
    { h: 'solo', k: 'reply', off: 20, pre: 1, fr: 200 },
  ];
  const recorded = [
    { h: 'cam', did: 'did:plc:cam', k: 'repost', off: 5, pre: 1, fr: 500 },
    { h: 'new', did: 'did:plc:new', k: 'reply', off: 6, pre: 1, fr: 900 },
  ];
  const pieces = [
    { take: 4, rkey: 'p4' },
    { take: 17, rkey: 'p17' },
  ];
  const logs = { p4: bundled, p17: recorded };
  const resolve = (p) => logs[p.rkey];

  it('does not call a returning participant a first-timer', () => {
    const n = newcomers(recorded, pieces, { take: 17 }, resolve);
    // cam was in take 4 under a handle alone; only `new` is new.
    expect(n).toEqual({ n: 1, of: 2, blind: 0 });
  });

  it('counts a person once in the project-wide audience', () => {
    const s = projectStats(
      [
        { take: 4, rkey: 'p4', lifespanMs: 60_000, preSeal: { likes: 1, threadPosts: 2 } },
        { take: 17, rkey: 'p17', lifespanMs: 120_000, preSeal: { likes: 1, threadPosts: 3 } },
      ],
      resolve,
    );
    // cam, solo, new — not four.
    expect(s.audience.known).toBe(3);
    expect(s.audience.median).toBe(500);
  });
});
