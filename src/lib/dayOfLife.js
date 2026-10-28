// Local-calendar-anchored day-of-life calc. Originally UTC-noon
// (ported from .eleventy.js) but the feed groups posts by *local*
// calendar date, so the day number needs to follow the same anchor —
// otherwise a post made at 11pm EST would show "Day N" while its
// group header says May 5 ("today"), giving a one-off mismatch.
//
// The birthdate is the other half of that anchor, and it is a calendar date,
// not an instant: May 7 wherever the reader is. It used to be parsed as UTC
// midnight, which west of Greenwich is the evening of May 6 — so every count
// in the Americas ran a day ahead, and the birthday arrived a day early.
//
// Both ends are reduced to calendar days and counted with Date.UTC, which has
// no DST and no zone history. Counting between local midnights instead needed
// rounding for the 23- and 25-hour days, and still came out a day short in a
// zone that has skipped a date since 1993 (Kiribati, Samoa).

import { BIRTHDATE } from '../config.js';

const MS_PER_DAY = 86_400_000;

/** A Date's local calendar day as `{ y, m, d }` (m 0-based). */
function localDay(date) {
  const t = new Date(date);
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}

/**
 * The birthdate as `{ y, m, d }`. A string's leading 'YYYY-MM-DD' is the
 * calendar day it names, whatever follows it; a Date is taken at its local
 * calendar day.
 */
function birthDay(birthdate) {
  const m =
    typeof birthdate === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate);
  if (m) return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
  return localDay(birthdate);
}

/** Whole days from one calendar day to another. */
function daysBetween(a, b) {
  return Math.round(
    (Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / MS_PER_DAY,
  );
}

/**
 * Days lived (1-indexed: birthdate is Day 1). Flips at the reader's local
 * midnight, not UTC's.
 */
export function dayOfLife(at = new Date(), birthdate = BIRTHDATE) {
  return Math.max(1, daysBetween(birthDay(birthdate), localDay(at)) + 1);
}

/**
 * Year of life (age in completed years, but expressed as "Year N" — so the
 * year you turn 31 is Year 32). Matches the old site's wording.
 */
export function yearOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const birth = birthDay(birthdate);
  const now = localDay(at);
  let years = now.y - birth.y;
  if (now.m < birth.m || (now.m === birth.m && now.d < birth.d)) years--;
  return years + 1; // "Year N" = currently in your Nth year of life.
}

/** The most recent birthday on or before `at`, as a calendar day. */
function lastBirthday(at, birthdate) {
  const birth = birthDay(birthdate);
  const now = localDay(at);
  const thisYear = { y: now.y, m: birth.m, d: birth.d };
  return daysBetween(thisYear, now) >= 0
    ? thisYear
    : { ...thisYear, y: now.y - 1 };
}

/**
 * Day-of-year-of-life (1..365, or 366 in a year of life that spans a Feb 29).
 * Counts days since the most recent birthday, in the local calendar.
 */
export function dayOfYearOfLife(at = new Date(), birthdate = BIRTHDATE) {
  return daysBetween(lastBirthday(at, birthdate), localDay(at)) + 1;
}

/**
 * How many days the current year of life has: 365, or 366 when a Feb 29 falls
 * between the last birthday and the next one.
 */
export function daysInYearOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const last = lastBirthday(at, birthdate);
  return daysBetween(last, { ...last, y: last.y + 1 });
}

/**
 * Bundle for chrome-bar display.
 */
export function dayOfLifeSnapshot(at = new Date(), birthdate = BIRTHDATE) {
  return {
    day: dayOfLife(at, birthdate),
    year: yearOfLife(at, birthdate),
    dayOfYear: dayOfYearOfLife(at, birthdate),
    yearLength: daysInYearOfLife(at, birthdate),
  };
}
