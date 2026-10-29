import { describe, it, expect } from 'vitest';
import {
  dayOfLife,
  yearOfLife,
  dayOfYearOfLife,
  daysInYearOfLife,
  dayOfLifeSnapshot,
} from './dayOfLife.js';
import { dayOfLife as ogDayOfLife, folio } from '../../og/time.js';

// Everything here is counted on the New York calendar (see the module
// header), so instants are written with New York offsets and birthdates as
// calendar-date strings; the expected day numbers then hold in any zone the
// runner sits in. dayOfLife.tz.test.js runs them from other zones.

/** Noon in New York on a calendar day (m 1-based), whatever the season. */
const noon = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 16));

describe('dayOfLife', () => {
  const birth = '1993-05-07';

  it('counts the birthday itself as Day 1 (1-indexed)', () => {
    expect(dayOfLife(noon(1993, 5, 7), birth)).toBe(1);
    expect(dayOfLife('1993-05-07', birth)).toBe(1);
  });

  it('advances one day per calendar day', () => {
    expect(dayOfLife(noon(1993, 5, 8), birth)).toBe(2);
    expect(dayOfLife(noon(1993, 5, 9), birth)).toBe(3);
  });

  it('flips at midnight in New York, not at midnight UTC or the reader’s', () => {
    expect(dayOfLife('1993-05-07T00:01:00-04:00', birth)).toBe(1);
    expect(dayOfLife('1993-05-07T23:59:00-04:00', birth)).toBe(1);
    // 03:59 UTC on the 8th is 11:59 pm on the 7th in New York.
    expect(dayOfLife('1993-05-08T03:59:00Z', birth)).toBe(1);
    expect(dayOfLife('1993-05-08T00:01:00-04:00', birth)).toBe(2);
  });

  it('clamps to Day 1 for dates on or before the birthdate', () => {
    expect(dayOfLife(noon(1993, 5, 6), birth)).toBe(1);
    expect(dayOfLife(noon(1990, 1, 1), birth)).toBe(1);
  });

  it('stays exact across the 23-hour spring-forward day', () => {
    // Mar 8 2026 has 23 hours in New York. 11:59 pm on the 7th to 12:01 am
    // on the 9th is 47 hours and two calendar days.
    const b = '2026-03-07';
    expect(dayOfLife('2026-03-07T23:59:00-05:00', b)).toBe(1);
    expect(dayOfLife('2026-03-08T12:00:00-04:00', b)).toBe(2);
    expect(dayOfLife('2026-03-09T00:01:00-04:00', b)).toBe(3);
  });

  it('stays exact across the 25-hour fall-back day', () => {
    // Nov 1 2026 has 25 hours in New York; 12:10 am to 11:50 pm is one day.
    const b = '2026-10-31';
    expect(dayOfLife('2026-11-01T00:10:00-04:00', b)).toBe(2);
    expect(dayOfLife('2026-11-01T23:50:00-05:00', b)).toBe(2);
    expect(dayOfLife('2026-11-02T00:10:00-05:00', b)).toBe(3);
  });

  it('is NaN for a date that won’t parse', () => {
    expect(dayOfLife('nope', birth)).toBeNaN();
  });
});

describe('yearOfLife', () => {
  const birth = '1993-05-07';

  it('is Year 1 on the birthdate (currently in your 1st year of life)', () => {
    expect(yearOfLife(noon(1993, 5, 7), birth)).toBe(1);
  });

  it('turns over on the birthday, not on Jan 1', () => {
    expect(yearOfLife(noon(1994, 5, 6), birth)).toBe(1);
    expect(yearOfLife(noon(1994, 5, 7), birth)).toBe(2);
  });

  it('expresses age as "Year N" = one past completed years', () => {
    expect(yearOfLife(noon(2026, 5, 6), birth)).toBe(33);
    expect(yearOfLife(noon(2026, 5, 7), birth)).toBe(34);
  });
});

describe('dayOfYearOfLife', () => {
  const birth = '1990-01-01'; // Jan 1 for clean arithmetic

  it('is Day 1 on the birthday', () => {
    expect(dayOfYearOfLife(noon(2020, 1, 1), birth)).toBe(1);
    expect(dayOfYearOfLife(noon(2020, 1, 2), birth)).toBe(2);
  });

  it('counts up to the full year on the day before the next birthday', () => {
    expect(dayOfYearOfLife(noon(2019, 12, 31), birth)).toBe(365);
  });

  it('resets after the most recent birthday, not the calendar new year', () => {
    expect(dayOfYearOfLife(noon(2021, 2, 1), birth)).toBe(32);
  });
});

describe('daysInYearOfLife', () => {
  const birth = '1993-05-07';

  it('is 365 in a year of life with no Feb 29 in it', () => {
    expect(daysInYearOfLife(noon(2026, 10, 27), birth)).toBe(365);
  });

  it('is 366 when a Feb 29 falls between the two birthdays', () => {
    // May 7 2027 → May 7 2028 spans Feb 29 2028, and its last day is day 366.
    expect(daysInYearOfLife(noon(2028, 3, 1), birth)).toBe(366);
    expect(dayOfYearOfLife(noon(2028, 5, 6), birth)).toBe(366);
  });
});

describe('the real birthdate', () => {
  it('is a calendar date: Oct 27 2026 is Day 12,227', () => {
    // (date(2026, 10, 27) - date(1993, 5, 7)).days + 1
    expect(dayOfLife(noon(2026, 10, 27))).toBe(12227);
  });

  it('turns the year over on May 7, not the evening before', () => {
    expect(yearOfLife(noon(2026, 5, 6))).toBe(33);
    expect(dayOfYearOfLife(noon(2026, 5, 6))).toBe(365);
    expect(yearOfLife(noon(2026, 5, 7))).toBe(34);
    expect(dayOfYearOfLife(noon(2026, 5, 7))).toBe(1);
  });

  it('reads an ISO birthdate as the day it names, not the moment', () => {
    const at = noon(2026, 10, 27);
    expect(dayOfLife(at, '1993-05-07T00:00:00Z')).toBe(dayOfLife(at, '1993-05-07'));
  });
});

describe('one count for the chrome and the cards', () => {
  // og/time.js re-exports this module's dayOfLife; the share card's folio and
  // the chrome's "on day N" used to be two implementations a day apart.
  it('is the same function og/time.js stamps the folio with', () => {
    expect(ogDayOfLife).toBe(dayOfLife);
  });

  it('agrees with the folio through the evening and over midnight', () => {
    // 8:30 pm is already the 28th in UTC, where the folio used to turn over.
    expect(folio(new Date('2026-10-27T20:30:00-04:00'))).toBe('12,227');
    expect(dayOfLife('2026-10-27T20:30:00-04:00')).toBe(12227);
    expect(folio(new Date('2026-10-27T23:59:00-04:00'))).toBe('12,227');
    expect(dayOfLife('2026-10-28T00:01:00-04:00')).toBe(12228);
    expect(folio('2026-10-28')).toBe('12,228');
  });
});

describe('dayOfLifeSnapshot', () => {
  it('bundles the values consistently with the individual functions', () => {
    const birth = '1993-05-07';
    const at = noon(2026, 7, 17);
    expect(dayOfLifeSnapshot(at, birth)).toEqual({
      day: dayOfLife(at, birth),
      year: yearOfLife(at, birth),
      dayOfYear: dayOfYearOfLife(at, birth),
      yearLength: daysInYearOfLife(at, birth),
    });
  });

  it('returns positive integers for the live default (real BIRTHDATE, now)', () => {
    const snap = dayOfLifeSnapshot();
    expect(Number.isInteger(snap.day) && snap.day >= 1).toBe(true);
    expect(Number.isInteger(snap.year) && snap.year >= 1).toBe(true);
    expect(Number.isInteger(snap.dayOfYear) && snap.dayOfYear >= 1).toBe(true);
  });
});
