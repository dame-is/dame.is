// The island's clock, its sun and its seasons.
//
// Time is a single number: hours since the midnight before the game began.
// Everything else (which day it is, the hour on the clock, where the sun
// stands and how hard it shines) is read off it, so the simulation, the sky
// and the HUD can't disagree about what time it is. The picture's light comes
// from sunDirection() here, which is also what decides whether a panel is in
// shade: the shadow drawn on a panel is the shadow it is charged for.

import { DAYBREAK, HOURS_PER_DAY } from './catalog.js';

/** The hour on the clock, 0 ≤ h < 24. */
export function hourOf(time) {
  const h = time % HOURS_PER_DAY;
  return h < 0 ? h + HOURS_PER_DAY : h;
}

/**
 * Which day it is, counting from 1. A day runs from one daybreak (6 am) to
 * the next rather than midnight to midnight, so one day is one sunlit
 * stretch and the night it has to last through.
 */
export function dayOf(time) {
  return Math.floor((time - DAYBREAK) / HOURS_PER_DAY) + 1;
}

/* ── seasons ──────────────────────────────────────────────────────────────── */

/** A year is this many days: three to a season. */
export const DAYS_PER_YEAR = 12;

/**
 * What each season does to the day. `dawn` and `dusk` are hours on the
 * clock; `peak` is how strong the noon sun is; `lean` is how far south of
 * overhead its path runs, in radians, which is what makes winter shadows
 * long.
 */
export const SEASONS = Object.freeze([
  Object.freeze({
    key: 'spring',
    name: 'Spring',
    dawn: 6,
    dusk: 18,
    peak: 1,
    lean: 0.62,
  }),
  Object.freeze({
    key: 'summer',
    name: 'Summer',
    dawn: 4.5,
    dusk: 19.5,
    peak: 1,
    lean: 0.42,
  }),
  Object.freeze({
    key: 'autumn',
    name: 'Autumn',
    dawn: 6.25,
    dusk: 17.75,
    peak: 0.9,
    lean: 0.72,
  }),
  Object.freeze({
    key: 'winter',
    name: 'Winter',
    dawn: 7.75,
    dusk: 16.25,
    peak: 0.7,
    lean: 0.95,
  }),
]);

/**
 * The season on a given day. An island without seasons (`spec.seasons`
 * falsy) is in an endless spring; one with them starts in `spec.season`
 * (an index into SEASONS, spring by default) and turns every three days.
 */
export function seasonOf(spec, day) {
  if (!spec?.seasons) return SEASONS[0];
  const start = (spec.season || 0) * (DAYS_PER_YEAR / SEASONS.length);
  const d =
    (((Math.max(1, day) - 1 + start) % DAYS_PER_YEAR) + DAYS_PER_YEAR) %
    DAYS_PER_YEAR;
  return SEASONS[Math.floor(d / (DAYS_PER_YEAR / SEASONS.length))];
}

/** The season at a moment. (Dawn can come before the books close at 6.) */
export function seasonAt(spec, time) {
  return seasonOf(spec, dayOf(time));
}

/* ── the sun ──────────────────────────────────────────────────────────────── */

export function isDaylight(time, season = SEASONS[0]) {
  const h = hourOf(time);
  return h >= season.dawn && h < season.dusk;
}

/**
 * How much of its rated power a fixed panel makes at this time under a clear
 * sky: 0 at night, rising to the season's peak at noon along a half sine.
 */
export function sunFactor(time, season = SEASONS[0]) {
  const h = hourOf(time);
  if (h <= season.dawn || h >= season.dusk) return 0;
  return (
    season.peak *
    Math.sin((Math.PI * (h - season.dawn)) / (season.dusk - season.dawn))
  );
}

/**
 * The same for a panel that turns to face the sun: it gives up nothing at
 * noon and far less than a fixed one in the morning and evening.
 */
export function trackingFactor(time, season = SEASONS[0]) {
  const fixed = sunFactor(time, season);
  return fixed <= 0 ? 0 : season.peak * Math.sqrt(fixed / season.peak);
}

/** Where the sun is on its arc, 0 at dawn to 1 at dusk. */
export function sunArc(time, season = SEASONS[0]) {
  return (hourOf(time) - season.dawn) / (season.dusk - season.dawn);
}

/** The same for the moon, across the night. */
export function moonArc(time, season = SEASONS[0]) {
  const h = hourOf(time);
  const night = HOURS_PER_DAY - (season.dusk - season.dawn);
  const since =
    h >= season.dusk ? h - season.dusk : h + HOURS_PER_DAY - season.dusk;
  return since / night;
}

/**
 * The way to the sun (or the moon) from the island for a place on its arc,
 * as a unit vector into `out` ({ x, y, z }; +x is east, +y up, +z south).
 * It rises in the east, leans south by `lean` at its height and sets in the
 * west. It is never quite on the horizon: a light lying flat would throw
 * shadows for ever.
 */
export function arcDirection(arc, lean, out = { x: 0, y: 0, z: 0 }) {
  const phi = Math.min(1, Math.max(0, arc)) * Math.PI;
  let x = Math.cos(phi);
  let y = Math.max(0.14, Math.sin(phi) * Math.cos(lean));
  let z = Math.sin(phi) * Math.sin(lean);
  const length = Math.hypot(x, y, z);
  out.x = x / length;
  out.y = y / length;
  out.z = z / length;
  return out;
}

/** The way to the sun right now, or null when it is down. */
export function sunDirection(time, season = SEASONS[0], out) {
  if (!isDaylight(time, season)) return null;
  return arcDirection(sunArc(time, season), season.lean, out);
}

/**
 * The hour the sky's own colours should be at: the island's day, however
 * long the season makes it, mapped onto a day that dawns at 6 and darkens at
 * 18, which is what the sky's keyframes are written in.
 */
export function skyHour(time, season = SEASONS[0]) {
  const h = hourOf(time);
  if (h < season.dawn) return (h / season.dawn) * 6;
  if (h < season.dusk)
    return 6 + ((h - season.dawn) / (season.dusk - season.dawn)) * 12;
  return 18 + ((h - season.dusk) / (HOURS_PER_DAY - season.dusk)) * 6;
}

/** "6:05 am": the clock as the HUD writes it. */
export function formatClock(time) {
  const h = hourOf(time);
  let hours = Math.floor(h);
  let minutes = Math.floor((h - hours) * 60);
  // Count in fives: a clock whose minutes tick over every frame is noise.
  minutes -= minutes % 5;
  const suffix = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${suffix}`;
}
