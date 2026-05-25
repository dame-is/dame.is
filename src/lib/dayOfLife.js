// Local-midnight-anchored day-of-life calc. Originally UTC-noon
// (ported from .eleventy.js) but the feed groups posts by *local*
// calendar date, so the day number needs to follow the same anchor —
// otherwise a post made at 11pm EST would show "Day N" while its
// group header says May 5 ("today"), giving a one-off mismatch.

import { BIRTHDATE } from '../config.js';

const MS_PER_DAY = 86_400_000;

/**
 * Round a Date to local midnight. We compare two dates by their local
 * calendar day so the day count flips at the user's actual midnight,
 * not at UTC's.
 */
function toLocalMidnight(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Days lived (1-indexed: birthdate is Day 1).
 */
export function dayOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const birth = toLocalMidnight(birthdate);
  const now = toLocalMidnight(at);
  return Math.max(1, Math.round((now - birth) / MS_PER_DAY) + 1);
}

/**
 * Year of life (age in completed years, but expressed as "Year N" — so the
 * year you turn 31 is Year 32). Matches the old site's wording.
 */
export function yearOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const birth = new Date(birthdate);
  const now = new Date(at);
  let years = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
  return years + 1; // "Year N" = currently in your Nth year of life.
}

/**
 * Day-of-year-of-life (1..365 ish). Counts days since the most recent
 * birthday (local-midnight-anchored).
 */
export function dayOfYearOfLife(at = new Date(), birthdate = BIRTHDATE) {
  const now = new Date(at);
  const birth = new Date(birthdate);
  let lastBirthday = new Date(now.getFullYear(), birth.getMonth(), birth.getDate());
  if (toLocalMidnight(now) < toLocalMidnight(lastBirthday)) {
    lastBirthday = new Date(now.getFullYear() - 1, birth.getMonth(), birth.getDate());
  }
  return Math.round((toLocalMidnight(now) - toLocalMidnight(lastBirthday)) / MS_PER_DAY) + 1;
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
