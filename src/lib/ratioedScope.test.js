import { describe, it, expect } from 'vitest';
import {
  scopeColumns,
  scopeStep,
  stepLabel,
  scopeAxis,
  columnSays,
  liveTexture,
  fmtPace,
  seriesRank,
  ordinal,
  seriesSentence,
} from './ratioedScope.js';

const MIN = 60_000;
// The page grid at 16px: a 92px column and a 24px gutter.
const COL = 92;
const GUTTER = 24;
const PITCH = COL + GUTTER;
const span = (n) => n * PITCH - GUTTER;

describe('scopeColumns', () => {
  it('counts the whole columns a run of the grid holds', () => {
    expect(scopeColumns(span(10), PITCH, GUTTER)).toBe(10);
    expect(scopeColumns(span(6), PITCH, GUTTER)).toBe(6);
    expect(scopeColumns(span(1), PITCH, GUTTER)).toBe(1);
  });

  it('survives the half pixel a rem width rounds to', () => {
    expect(scopeColumns(span(10) - 0.4, PITCH, GUTTER)).toBe(10);
  });

  it('gives a phone the columns its width would hold, never none', () => {
    expect(scopeColumns(358, PITCH, GUTTER)).toBe(3);
    expect(scopeColumns(40, PITCH, GUTTER)).toBe(1);
  });

  it('is nothing until there is something to measure', () => {
    expect(scopeColumns(0, PITCH, GUTTER)).toBe(0);
    expect(scopeColumns(800, 0, GUTTER)).toBe(0);
  });
});

describe('scopeStep', () => {
  const RECORD = 3_241_147; // take 27, 54m01s

  it('puts the record on ten columns at six minutes a column', () => {
    expect(scopeStep(10, RECORD)).toBe(6);
  });

  it('takes a longer step when there are fewer columns', () => {
    expect(scopeStep(8, RECORD)).toBe(10);
    expect(scopeStep(6, RECORD)).toBe(10);
    expect(scopeStep(3, RECORD)).toBe(20);
  });

  it('leaves room past the furthest mark', () => {
    // Exactly 60 minutes would fit ten six-minute columns edge to edge; the
    // record's label needs the step after it.
    expect(scopeStep(10, 60 * MIN)).toBe(10);
  });

  it('draws at least a minute', () => {
    expect(scopeStep(10, 0)).toBe(1);
    expect(scopeStep(10, 5000)).toBe(1);
  });

  it('counts in hours past the last step', () => {
    expect(scopeStep(1, 10 * 60 * MIN)).toBe(660);
    expect(scopeStep(0, 30 * MIN)).toBe(60);
  });
});

describe('the axis', () => {
  it('labels minutes, and hours once there are some', () => {
    expect(stepLabel(6)).toBe('6m');
    expect(stepLabel(60)).toBe('1h');
    expect(stepLabel(90)).toBe('1h30m');
    expect(stepLabel(125)).toBe('2h05m');
  });

  it('puts a label at the start of every column', () => {
    expect(scopeAxis(4, 6)).toEqual([
      { i: 0, label: '0' },
      { i: 1, label: '+6m' },
      { i: 2, label: '+12m' },
      { i: 3, label: '+18m' },
    ]);
    expect(scopeAxis(0, 6)).toEqual([]);
  });

  it('says what a column is in words', () => {
    expect(columnSays(6)).toBe('six minutes');
    expect(columnSays(1)).toBe('a minute');
    expect(columnSays(60)).toBe('an hour');
    expect(columnSays(120)).toBe('two hours');
    expect(columnSays(45)).toBe('45 minutes');
  });
});

describe('liveTexture', () => {
  const ME = 'did:plc:artist';
  const row = (k, offS, extra = {}) => ({ k, did: `did:plc:${k}${offS}`, offMs: offS * 1000, ...extra });

  it('reads the first touch, the longest silence and the pace', () => {
    const rows = [row('reply', 41), row('repost', 72), row('reply', 125), row('quote', 288)];
    const t = liveTexture(rows, { endMs: 300_000 });
    expect(t.firstMs).toBe(41_000);
    expect(t.silence).toEqual({ ms: 163_000, fromMs: 125_000 });
    expect(t.records).toBe(4);
    expect(t.pace).toBeCloseTo(0.8, 5);
  });

  it('counts the silence going on now', () => {
    const t = liveTexture([row('reply', 10)], { endMs: 600_000 });
    expect(t.silence).toEqual({ ms: 590_000, fromMs: 10_000 });
  });

  it('counts a quiet start as a silence', () => {
    const t = liveTexture([row('reply', 200), row('reply', 210)], { endMs: 220_000 });
    expect(t.silence).toEqual({ ms: 200_000, fromMs: 0 });
  });

  it('leaves the artist out of all three', () => {
    const rows = [row('reply', 5, { did: ME }), row('reply', 50)];
    const t = liveTexture(rows, { selfDid: ME, endMs: 60_000 });
    expect(t.firstMs).toBe(50_000);
    expect(t.records).toBe(1);
  });

  it('lets a record taken back break a silence but not add to the pace', () => {
    const rows = [row('like', 100, { goneMs: 107_000 }), row('reply', 200)];
    const t = liveTexture(rows, { endMs: 200_000 });
    expect(t.firstMs).toBe(100_000);
    expect(t.silence.ms).toBe(100_000);
    expect(t.records).toBe(1);
  });

  it('stops at the end it is given, which is the like once there is one', () => {
    const rows = [row('reply', 10), row('like', 20), row('reply', 30)];
    const t = liveTexture(rows, { endMs: 20_000 });
    expect(t.records).toBe(2);
    expect(t.silence).toEqual({ ms: 10_000, fromMs: 0 });
  });

  it('has nothing to say about a piece nothing has touched', () => {
    const t = liveTexture([], { endMs: 90_000 });
    expect(t.firstMs).toBeNull();
    expect(t.silence).toEqual({ ms: 90_000, fromMs: 0 });
    expect(t.pace).toBe(0);
    expect(liveTexture([], { endMs: 0 }).pace).toBeNull();
  });
});

describe('fmtPace', () => {
  it('keeps a decimal below ten and drops it above', () => {
    expect(fmtPace(0.56)).toBe('0.6/min');
    expect(fmtPace(12.4)).toBe('12/min');
    expect(fmtPace(null)).toBe('—');
  });
});

describe('seriesRank', () => {
  const piece = (take, s) => ({ rkey: `r${take}`, take, lifespanMs: s * 1000 });
  const pieces = [piece(1, 48), piece(4, 1763), piece(14, 2529), piece(27, 3241), piece(13, 16)];

  it('ranks every take by length with the live one among them', () => {
    const { bars, rank, total } = seriesRank(pieces, { take: 42, standingMs: 1_394_000 });
    expect(total).toBe(6);
    expect(rank).toBe(4);
    expect(bars.map((b) => b.take)).toEqual([27, 14, 4, 42, 1, 13]);
    expect(bars[0].at).toBe(1);
    expect(bars[3]).toMatchObject({ live: true, passed: false });
    expect(bars[4].passed).toBe(true);
    expect(bars[1].passed).toBe(false);
  });

  it('scales against the live piece once it holds the record', () => {
    const { bars, rank } = seriesRank(pieces, { take: 42, standingMs: 6_482_000 });
    expect(rank).toBe(1);
    expect(bars[0]).toMatchObject({ live: true, at: 1 });
    expect(bars[1].at).toBeCloseTo(0.5, 2);
  });

  it('keeps a tied finished piece ahead of the live one', () => {
    const { rank } = seriesRank(pieces, { take: 42, standingMs: 1_763_000 });
    expect(rank).toBe(4);
  });

  it('leaves out anything without a length, and still has the live piece', () => {
    const { bars, rank, total } = seriesRank([{ rkey: 'x', take: 9, lifespanMs: 0 }], { take: 42, standingMs: 0 });
    expect(total).toBe(1);
    expect(rank).toBe(1);
    expect(bars[0].at).toBe(0);
  });
});

describe('the series sentence', () => {
  it('says where the take stands', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(22)).toBe('22nd');
    expect(seriesSentence({ rank: 8, total: 42 })).toBe(
      'The 8th longest of 42 so far. It climbs this list while it stands.',
    );
    expect(seriesSentence({ rank: 1, total: 42 })).toBe('The longest of 42 so far: every take is behind it.');
    expect(seriesSentence({ rank: 8, total: 42, ended: true })).toBe('Over, as the 8th longest of 42.');
    expect(seriesSentence({ rank: 0, total: 0 })).toBe('');
  });
});
