// Day of life, counted on Dame's calendar (America/New_York), the one the
// ledger groups by and the share cards stamp their folio with. og/time.js
// re-exports dayOfLife from here, so the chrome's "on day N", a ledger day
// header, a record's colophon and a card's folio are one count.
//
// It used to follow the reader's calendar. Then a reader in Los Angeles at
// 10 pm her time — 1 am in New York — saw yesterday's number beside today's
// card, and one in Tokyo saw tomorrow's. Before that it was UTC midnight
// rolled back to local midnight, which ran a day high west of Greenwich.
//
// The birthdate is a calendar date, not an instant: May 7 wherever anyone
// is. Parsed as UTC midnight it was the evening of May 6 in New York, and
// every count ran a day ahead with the birthday a day early.
//
// Both ends are reduced to calendar days and counted with Date.UTC, which has
// no DST and no zone history. Counting between midnights instead needed
// rounding for the 23- and 25-hour days, and came out a day short in a zone
// that has skipped a date (Kiribati, Samoa) — moot now that only one zone is
// read, but there's no reason to go back to it.

import { BIRTHDATE } from '../config.js';
import { calendarDay, calendarDaysBetween } from './time.js';

/**
 * The birthdate as `{ y, m, d }`. A string's leading 'YYYY-MM-DD' is the
 * calendar day it names, whatever follows it; a Date is read on Dame's clock.
 */
function birthDay(birthdate) {
  const m =
    typeof birthdate === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate);
  if (m) return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
  return calendarDay(birthdate);
}

/**
 * Days lived (1-indexed: birthdate is Day 1), on the day `at` falls on in New
 * York. Flips at midnight there, whatever the reader's zone. A bare
 * 'YYYY-MM-DD' is the day it names (a mothing night's date, for one). NaN
 * for a date that won't parse.
 */
export function dayOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const day = calendarDay(at);
  if (!day) return NaN;
  return Math.max(1, calendarDaysBetween(birthDay(birthdate), day) + 1);
}

/**
 * Year of life (age in completed years, but expressed as "Year N" — so the
 * year you turn 31 is Year 32). Matches the old site's wording.
 */
export function yearOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const birth = birthDay(birthdate);
  const now = calendarDay(at);
  let years = now.y - birth.y;
  if (now.m < birth.m || (now.m === birth.m && now.d < birth.d)) years--;
  return years + 1; // "Year N" = currently in your Nth year of life.
}

/** The most recent birthday on or before `at`, as a calendar day. */
function lastBirthday(at, birthdate) {
  const birth = birthDay(birthdate);
  const now = calendarDay(at);
  const thisYear = { y: now.y, m: birth.m, d: birth.d };
  return calendarDaysBetween(thisYear, now) >= 0
    ? thisYear
    : { ...thisYear, y: now.y - 1 };
}

/**
 * Day-of-year-of-life (1..365, or 366 in a year of life that spans a Feb 29).
 * Counts days since the most recent birthday.
 */
export function dayOfYearOfLife(at = new Date(), birthdate = BIRTHDATE) {
  return calendarDaysBetween(lastBirthday(at, birthdate), calendarDay(at)) + 1;
}

/**
 * How many days the current year of life has: 365, or 366 when a Feb 29 falls
 * between the last birthday and the next one.
 */
export function daysInYearOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const last = lastBirthday(at, birthdate);
  return calendarDaysBetween(last, { ...last, y: last.y + 1 });
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
