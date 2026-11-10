// The island's clock and its sun.
//
// Time is a single number: hours since the midnight before the game began.
// Everything else (which day it is, the hour on the clock, how hard the sun is
// shining) is read off it, so the simulation, the sky and the HUD can't
// disagree about what time it is.

import { DAWN, DUSK, HOURS_PER_DAY } from './catalog.js';

/** The hour on the clock, 0 ≤ h < 24. */
export function hourOf(time) {
  const h = time % HOURS_PER_DAY;
  return h < 0 ? h + HOURS_PER_DAY : h;
}

/**
 * Which day it is, counting from 1. A day runs dawn to dawn rather than
 * midnight to midnight: the books close when the sun comes up, so one day is
 * one sunlit stretch and the night it has to last through.
 */
export function dayOf(time) {
  return Math.floor((time - DAWN) / HOURS_PER_DAY) + 1;
}

export function isDaylight(time) {
  const h = hourOf(time);
  return h >= DAWN && h < DUSK;
}

/**
 * How much of its rated power a panel makes at this time: 0 at night, rising
 * to 1 at noon along a half sine. (A fixed panel under a sun that crosses the
 * sky; no clouds yet.)
 */
export function sunFactor(time) {
  const h = hourOf(time);
  if (h <= DAWN || h >= DUSK) return 0;
  return Math.sin((Math.PI * (h - DAWN)) / (DUSK - DAWN));
}

/**
 * Where the sun is on its arc, 0 at dawn to 1 at dusk; and the same for the
 * moon across the night. The view places its lights from these.
 */
export function sunArc(time) {
  return (hourOf(time) - DAWN) / (DUSK - DAWN);
}

export function moonArc(time) {
  const h = hourOf(time);
  const since = h >= DUSK ? h - DUSK : h + HOURS_PER_DAY - DUSK;
  return since / (HOURS_PER_DAY - (DUSK - DAWN));
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
