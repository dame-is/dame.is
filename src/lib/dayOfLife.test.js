import { describe, it, expect } from 'vitest';
import {
  dayOfLife,
  yearOfLife,
  dayOfYearOfLife,
  dayOfLifeSnapshot,
} from './dayOfLife.js';

// Everything here is anchored to LOCAL midnight (see the module header), so the
// tests build dates with the local `new Date(y, m, d, ...)` constructor rather
// than ISO 'Z' strings — that keeps the expected day numbers identical in any
// timezone the test runner happens to sit in.

describe('dayOfLife', () => {
  const birth = new Date(1993, 4, 7); // May 7, 1993, local midnight

  it('counts the birthday itself as Day 1 (1-indexed)', () => {
    expect(dayOfLife(birth, birth)).toBe(1);
  });

  it('advances one day per local calendar day', () => {
    expect(dayOfLife(new Date(1993, 4, 8), birth)).toBe(2);
    expect(dayOfLife(new Date(1993, 4, 9), birth)).toBe(3);
  });

  it('ignores the time of day — the count flips only at local midnight', () => {
    // A post at 00:01 and one at 23:59 on the same local date are the same day.
    expect(dayOfLife(new Date(1993, 4, 7, 0, 1), birth)).toBe(1);
    expect(dayOfLife(new Date(1993, 4, 7, 23, 59), birth)).toBe(1);
    // First minute of the next local day is already Day 2.
    expect(dayOfLife(new Date(1993, 4, 8, 0, 1), birth)).toBe(2);
  });

  it('clamps to Day 1 for dates on or before the birthdate', () => {
    expect(dayOfLife(new Date(1993, 4, 6), birth)).toBe(1);
    expect(dayOfLife(new Date(1990, 0, 1), birth)).toBe(1);
  });

  it('stays exact across a spring-forward DST day (23h) — Math.round, not floor', () => {
    // US spring-forward is 2023-03-12 (a 23-hour local day in DST zones). The
    // day number must still increment by exactly one per calendar day; a floor
    // of 47h/24h would wrongly report Day 2 for 3/13. Correct in UTC too.
    const b = new Date(2023, 2, 11); // Mar 11
    expect(dayOfLife(new Date(2023, 2, 11), b)).toBe(1);
    expect(dayOfLife(new Date(2023, 2, 12), b)).toBe(2);
    expect(dayOfLife(new Date(2023, 2, 13), b)).toBe(3);
  });

  it('stays exact across a fall-back DST day (25h)', () => {
    // US fall-back is 2023-11-05 (a 25-hour local day in DST zones).
    const b = new Date(2023, 10, 4); // Nov 4
    expect(dayOfLife(new Date(2023, 10, 5), b)).toBe(2);
    expect(dayOfLife(new Date(2023, 10, 6), b)).toBe(3);
  });
});

describe('yearOfLife', () => {
  const birth = new Date(1993, 4, 7); // May 7, 1993

  it('is Year 1 on the birthdate (currently in your 1st year of life)', () => {
    expect(yearOfLife(birth, birth)).toBe(1);
  });

  it('turns over on the birthday, not on Jan 1', () => {
    // The day before the 1st birthday is still Year 1; the 1st birthday is Year 2.
    expect(yearOfLife(new Date(1994, 4, 6), birth)).toBe(1);
    expect(yearOfLife(new Date(1994, 4, 7), birth)).toBe(2);
  });

  it('expresses age as "Year N" = one past completed years', () => {
    // Day before the 33rd birthday: 32 completed years -> Year 33.
    expect(yearOfLife(new Date(2026, 4, 6), birth)).toBe(33);
    // On the 33rd birthday: 33 completed years -> Year 34.
    expect(yearOfLife(new Date(2026, 4, 7), birth)).toBe(34);
  });
});

describe('dayOfYearOfLife', () => {
  const birth = new Date(1990, 0, 1); // Jan 1 for clean arithmetic

  it('is Day 1 on the birthday', () => {
    expect(dayOfYearOfLife(new Date(2020, 0, 1), birth)).toBe(1);
    expect(dayOfYearOfLife(new Date(2020, 0, 2), birth)).toBe(2);
  });

  it('counts up to the full year on the day before the next birthday', () => {
    // Dec 31, 2019 is 364 days after Jan 1, 2019 -> day 365 of that year of life.
    expect(dayOfYearOfLife(new Date(2019, 11, 31), birth)).toBe(365);
  });

  it('resets after the most recent birthday, not the calendar new year', () => {
    // Feb 1 is the 32nd day since the Jan 1 birthday.
    expect(dayOfYearOfLife(new Date(2021, 1, 1), birth)).toBe(32);
  });
});

describe('dayOfLifeSnapshot', () => {
  it('bundles the three values consistently with the individual functions', () => {
    const birth = new Date(1993, 4, 7);
    const at = new Date(2026, 6, 17);
    expect(dayOfLifeSnapshot(at, birth)).toEqual({
      day: dayOfLife(at, birth),
      year: yearOfLife(at, birth),
      dayOfYear: dayOfYearOfLife(at, birth),
    });
  });

  it('returns positive integers for the live default (real BIRTHDATE, now)', () => {
    const snap = dayOfLifeSnapshot();
    expect(Number.isInteger(snap.day) && snap.day >= 1).toBe(true);
    expect(Number.isInteger(snap.year) && snap.year >= 1).toBe(true);
    expect(Number.isInteger(snap.dayOfYear) && snap.dayOfYear >= 1).toBe(true);
  });
});
