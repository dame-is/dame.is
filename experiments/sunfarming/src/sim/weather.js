// The weather: what kind of day it is, and how hard the wind blows.
//
// Each day has one sky, drawn from the island's seed and the day's number, so
// tomorrow's weather is already decided and a forecast is simply looking it
// up. Nothing here is random at play time: the same island has the same
// weather every time it is played, which is what lets a layout be learned.

import { DAYBREAK, HOURS_PER_DAY } from './catalog.js';
import { hash2 } from './rng.js';
import { dayOf } from './sun.js';

/**
 * The four skies. `sun` is how much of the clear-sky light gets through to a
 * panel; `wind` is how hard it blows, 0 to 1.
 */
export const SKIES = Object.freeze({
  clear: Object.freeze({ key: 'clear', name: 'Clear', sun: 1, wind: 0.28 }),
  fair: Object.freeze({ key: 'fair', name: 'Fair', sun: 0.8, wind: 0.42 }),
  cloudy: Object.freeze({
    key: 'cloudy',
    name: 'Cloudy',
    sun: 0.4,
    wind: 0.68,
  }),
  storm: Object.freeze({ key: 'storm', name: 'Storm', sun: 0.15, wind: 1 }),
});

/**
 * How often each sky turns up, by the kind of climate an island has: the
 * chance of clear, then fair, then cloudy; what is left is storm.
 */
export const CLIMATES = Object.freeze({
  sunny: Object.freeze([0.56, 0.3, 0.12]),
  mixed: Object.freeze([0.36, 0.34, 0.24]),
  grey: Object.freeze([0.18, 0.3, 0.4]),
});

/** The sky on a given day of an island. The first day is always clear. */
export function skyOf(spec, day) {
  if (day <= 1) return SKIES.clear;
  const odds = CLIMATES[spec?.climate] || CLIMATES.sunny;
  const roll = hash2(day, 7919, (spec?.seed || 0) + 101);
  if (roll < odds[0]) return SKIES.clear;
  if (roll < odds[0] + odds[1]) return SKIES.fair;
  if (roll < odds[0] + odds[1] + odds[2]) return SKIES.cloudy;
  return SKIES.storm;
}

export function skyAt(spec, time) {
  return skyOf(spec, dayOf(time));
}

/** Today's sky and the next `days` after it, for the forecast. */
export function forecast(spec, time, days = 3) {
  const today = dayOf(time);
  const out = [];
  for (let i = 0; i <= days; i += 1) out.push(skyOf(spec, today + i));
  return out;
}

/**
 * How hard the wind is blowing right now, 0 to 1: the day's wind, scaled by
 * how windy the island is, stronger after dark than at noon, with a slow
 * swell and lull on top so a turbine's output wanders the way wind does.
 */
export function windAt(spec, time) {
  const sky = skyAt(spec, time);
  const hour = ((time % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  // Strongest around 2 am, weakest around 2 pm.
  const daily = 1 + 0.25 * Math.cos(((hour - 2) / HOURS_PER_DAY) * Math.PI * 2);
  const seed = (spec?.seed || 0) + 577;
  const t = (time - DAYBREAK) / 3;
  const a = hash2(Math.floor(t), 31, seed);
  const b = hash2(Math.floor(t) + 1, 31, seed);
  const f = t - Math.floor(t);
  const gust = 0.78 + 0.44 * (a + (b - a) * f * f * (3 - 2 * f));
  return Math.min(1, Math.max(0, sky.wind * (spec?.wind ?? 1) * daily * gust));
}
