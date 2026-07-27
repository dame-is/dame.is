import { describe, it, expect } from 'vitest';
import {
  SEED_PIECES,
  SEED_PEOPLE,
  splitParticipants,
  hiddenReplies,
  WEEKDAYS,
  normalizePiece,
  localSlot,
  whenMarks,
  areaRadius,
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

describe('SEED_PEOPLE', () => {
  it('counts everyone by DID, not by handle', () => {
    expect(SEED_PEOPLE).toHaveLength(135);
    expect(new Set(SEED_PEOPLE.map((p) => p.did)).size).toBe(135);
    // Two deactivated accounts share one placeholder handle; counting by
    // handle would silently lose one of them.
    expect(new Set(SEED_PEOPLE.map((p) => p.h)).size).toBe(134);
  });

  it('splits into living and after-the-fact participation', () => {
    const { total, living, afterOnly } = splitParticipants();
    expect(total).toBe(135);
    expect(living).toBe(77);
    expect(living + afterOnly).toBe(total);
  });

  it('gives everyone at least one event and one piece', () => {
    for (const p of SEED_PEOPLE) {
      expect(p.ev).toBeGreaterThan(0);
      expect(p.pre.length + p.post.length).toBeGreaterThan(0);
    }
  });

  it('tags only breakers who left a record behind', () => {
    const tagged = SEED_PEOPLE.filter((p) => p.broke);
    // Four of the eleven deleted their like and did nothing else, so they
    // never appear in a backlink index at all.
    expect(tagged).toHaveLength(7);
    for (const p of tagged) {
      expect(p.broke).toBeGreaterThanOrEqual(1);
      expect(p.broke).toBeLessThanOrEqual(11);
    }
  });
});

describe('hiddenReplies', () => {
  const events = {
    [SEED_PIECES[0].rkey]: [
      { k: 'reply', h: 'a.test', off: 10, pre: 1 },
      { k: 'reply', h: 'b.test', off: 80, pre: 0 },
      { k: 'like', h: 'c.test', off: 90, pre: 0 },
      { k: 'reply', h: 'dame.is', off: 70, pre: 0, self: 1 },
    ],
  };

  it('returns only non-self replies from after the seal', () => {
    const out = hiddenReplies(events, [SEED_PIECES[0]]);
    expect(out).toHaveLength(1);
    expect(out[0].h).toBe('b.test');
  });

  it('measures the offset from the seal, not from the post', () => {
    const [row] = hiddenReplies(events, [SEED_PIECES[0]]);
    // take #1 sealed at 48.832s; a reply at +80s landed ~31s after.
    expect(Math.round(row.afterSec)).toBe(31);
  });

  it('is empty until the event log has loaded', () => {
    expect(hiddenReplies(null, SEED_PIECES)).toEqual([]);
  });
});

describe('localSlot', () => {
  it('resolves into the artist’s zone, not UTC', () => {
    // 01:08 UTC on a Saturday is Friday evening in New York. Reading this in
    // UTC would put the piece on the wrong day AND the wrong half of the clock.
    const slot = localSlot('2026-02-21T01:08:01.648Z');
    expect(WEEKDAYS[slot.day]).toBe('Fri');
    expect(slot.hour).toBe(20);
    expect(slot.minute).toBe(8);
  });

  it('follows daylight saving rather than a fixed offset', () => {
    // June is EDT (UTC-4); February is EST (UTC-5). Same UTC hour, different
    // local hour.
    expect(localSlot('2025-06-16T18:13:22.654Z').hour).toBe(14);
    expect(localSlot('2026-02-21T18:13:22.000Z').hour).toBe(13);
  });

  it('gives a fractional hour for positioning', () => {
    expect(localSlot('2025-06-16T14:23:12.764Z').atHour).toBeCloseTo(10 + 23 / 60, 5);
  });

  it('returns null for an unparseable timestamp', () => {
    expect(localSlot('not a date')).toBeNull();
    expect(localSlot('')).toBeNull();
  });
});

describe('whenMarks', () => {
  const marks = whenMarks(SEED_PIECES);

  it('places every piece', () => {
    expect(marks).toHaveLength(11);
    for (const m of marks) {
      expect(m.day).toBeGreaterThanOrEqual(0);
      expect(m.day).toBeLessThanOrEqual(6);
      expect(m.atHour).toBeGreaterThanOrEqual(0);
      expect(m.atHour).toBeLessThan(24);
    }
  });

  it('sums engagement across every kind that arrived while alive', () => {
    const four = marks.find((m) => m.take === 4);
    // 45 thread + 8 RT + 3 QT + 0 likes.
    expect(four.engagement).toBe(56);
    expect(four.participants).toBe(32);
  });

  it('lands the first three takes together on a Monday morning', () => {
    const early = marks.filter((m) => m.take <= 3);
    expect(early.every((m) => WEEKDAYS[m.day] === 'Mon')).toBe(true);
    expect(early.every((m) => m.hour === 10)).toBe(true);
  });

  it('drops a piece whose timestamp will not parse', () => {
    expect(whenMarks([{ ...SEED_PIECES[0], postedAt: 'nope' }])).toEqual([]);
  });
});

describe('areaRadius', () => {
  it('scales by area, so four times the value is twice the radius', () => {
    // Radius above the floor is what carries the value; check that span.
    const quarter = areaRadius(25, 100, 0, 10);
    const full = areaRadius(100, 100, 0, 10);
    expect(quarter).toBeCloseTo(5, 5);
    expect(full).toBeCloseTo(10, 5);
  });

  it('gives zero and empty maxima the floor rather than NaN', () => {
    expect(areaRadius(0, 100, 2, 10)).toBe(2);
    expect(areaRadius(5, 0, 2, 10)).toBe(2);
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
