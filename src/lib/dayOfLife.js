// UTC-noon-normalized day-of-life calc. Direct port of .eleventy.js:206-335.

import { BIRTHDATE } from '../config.js';

const MS_PER_DAY = 86_400_000;

/**
 * Round a Date to UTC noon — the same anchor the Eleventy site used so the
 * day count never flips at midnight in any time zone.
 */
function toUtcNoon(date) {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0);
}

/**
 * Days lived (1-indexed: birthdate is Day 1).
 */
export function dayOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const birth = toUtcNoon(birthdate);
  const now = toUtcNoon(at);
  return Math.max(1, Math.floor((now - birth) / MS_PER_DAY) + 1);
}

/**
 * Year of life (age in completed years, but expressed as "Year N" — so the
 * year you turn 31 is Year 32). Matches the old site's wording.
 */
export function yearOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const birth = new Date(birthdate);
  const now = new Date(at);
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) years--;
  return years + 1; // "Year N" = currently in your Nth year of life.
}

/**
 * Day-of-year-of-life (1..365 ish). Counts days since the most recent
 * birthday (UTC-noon-normalized).
 */
export function dayOfYearOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const now = new Date(at);
  const birth = new Date(birthdate);
  let lastBirthday = new Date(Date.UTC(now.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate()));
  if (toUtcNoon(now) < toUtcNoon(lastBirthday)) {
    lastBirthday = new Date(Date.UTC(now.getUTCFullYear() - 1, birth.getUTCMonth(), birth.getUTCDate()));
  }
  return Math.floor((toUtcNoon(now) - toUtcNoon(lastBirthday)) / MS_PER_DAY) + 1;
}

/**
 * Bundle for chrome-bar display.
 */
export function dayOfLifeSnapshot(at = new Date(), birthdate = BIRTHDATE) {
  return {
    day: dayOfLife(at, birthdate),
    year: yearOfLife(at, birthdate),
    dayOfYear: dayOfYearOfLife(at, birthdate),
  };
}
