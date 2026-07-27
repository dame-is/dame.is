import { describe, it, expect } from 'vitest';
import {
  SEED_PIECES,
  normalizePiece,
  aggregate,
  fmtDuration,
  fmtSeconds,
  fmtElapsed,
} from './ratioed.js';

describe('SEED_PIECES', () => {
  it('carries all eleven pieces in take order', () => {
    expect(SEED_PIECES).toHaveLength(11);
    expect(SEED_PIECES.map((p) => p.take)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('keys each record by its subject post rkey', () => {
    for (const p of SEED_PIECES) {
      expect(p.subject.endsWith(`/${p.rkey}`)).toBe(true);
    }
  });

  it('seals every piece after it was posted', () => {
    for (const p of SEED_PIECES) {
      const span = Date.parse(p.sealedAt) - Date.parse(p.postedAt);
      expect(span).toBeGreaterThan(0);
      // lifespanMs is derived from those two timestamps, so it must agree with
      // them to the millisecond.
      expect(Math.abs(span - p.lifespanMs)).toBeLessThanOrEqual(1);
    }
  });

  it('records a reaction time exactly when the breaking like survives', () => {
    for (const p of SEED_PIECES) {
      const hasReaction = typeof p.breaker.reactionMs === 'number';
      expect(hasReaction).toBe(p.breaker.likeSurvives);
    }
  });

  it('keeps every measured reaction inside the window the ghost markers draw', () => {
    const measured = SEED_PIECES.map((p) => p.breaker.reactionMs).filter(
      (ms) => typeof ms === 'number',
    );
    expect(measured).toHaveLength(5);
    for (const ms of measured) {
      expect(ms).toBeGreaterThan(9_000);
      expect(ms).toBeLessThan(18_000);
    }
  });

  it('leaves the six deleted likes unmeasurable', () => {
    const deleted = SEED_PIECES.filter((p) => !p.breaker.likeSurvives);
    expect(deleted).toHaveLength(6);
    for (const p of deleted) {
      expect(p.breaker.reactionMs).toBeUndefined();
    }
  });

  it('never claims a like arrived while a piece was alive except from its breaker', () => {
    // Any surviving pre-seal like IS the breaking like, so a piece with a
    // pre-seal like must be one whose breaker's like survived.
    for (const p of SEED_PIECES) {
      if (p.preSeal.likes > 0) expect(p.breaker.likeSurvives).toBe(true);
    }
  });
});

describe('normalizePiece', () => {
  it('fills in missing engagement blocks rather than throwing', () => {
    const p = normalizePiece('abc', { take: 3, subject: 'at://x', lifespanMs: 100 });
    expect(p.preSeal).toEqual({
      likes: 0,
      reposts: 0,
      quotes: 0,
      threadPosts: 0,
      participants: 0,
    });
    expect(p.postSeal.likes).toBe(0);
    expect(p.breaker.handle).toBe('unknown');
  });

  it('returns null for an absent value', () => {
    expect(normalizePiece('abc', null)).toBeNull();
  });

  it('preserves a full record', () => {
    const src = SEED_PIECES[3];
    const p = normalizePiece(src.rkey, src);
    expect(p.take).toBe(4);
    expect(p.preSeal.threadPosts).toBe(src.preSeal.threadPosts);
    expect(p.breaker.likeSurvives).toBe(false);
  });
});

describe('aggregate', () => {
  const stats = aggregate(SEED_PIECES);

  it('measures five reaction times and misses six', () => {
    expect(stats.measured).toBe(5);
    expect(stats.deleted).toBe(6);
  });

  it('puts the mean reaction in the 13-second band', () => {
    expect(stats.meanReactionMs / 1000).toBeCloseTo(13.0, 1);
    expect(stats.minReactionMs / 1000).toBeCloseTo(10.0, 1);
    expect(stats.maxReactionMs / 1000).toBeCloseTo(17.0, 1);
  });

  it('finds take 4 as the longest-lived piece', () => {
    const longest = SEED_PIECES.find((p) => p.lifespanMs === stats.maxLifespanMs);
    expect(longest.take).toBe(4);
    expect(Math.round(stats.maxLifespanMs / 1000)).toBe(1764);
  });

  it('totals about 74 minutes of life across the whole project', () => {
    expect(Math.round(stats.aliveMs / 60000)).toBe(74);
  });

  it('counts far more non-like engagement than likes while alive', () => {
    // The name of the project, as a number: pieces are ratioed by design.
    expect(stats.likes).toBe(5);
    expect(stats.nonLike).toBe(123);
  });

  it('handles an empty list without dividing by zero', () => {
    const empty = aggregate([]);
    expect(empty.count).toBe(0);
    expect(empty.meanReactionMs).toBeNull();
    expect(empty.maxLifespanMs).toBe(0);
  });
});

describe('formatters', () => {
  it('formats durations under a minute as bare seconds', () => {
    expect(fmtDuration(48_832)).toBe('49s');
    expect(fmtDuration(0)).toBe('0s');
  });

  it('pads the seconds in minute-scale durations', () => {
    expect(fmtDuration(1_763_889)).toBe('29m24s');
    expect(fmtDuration(68_197)).toBe('1m08s');
  });

  it('keeps one decimal on reaction times and marks unknowns', () => {
    expect(fmtSeconds(11_304)).toBe('11.3s');
    expect(fmtSeconds(undefined)).toBe('—');
  });

  it('floats the unit across the afterlife range', () => {
    expect(fmtElapsed(31)).toBe('31s');
    expect(fmtElapsed(600)).toBe('10m');
    expect(fmtElapsed(7200)).toBe('2.0h');
    expect(fmtElapsed(86_400 * 405)).toBe('405d');
  });
});
