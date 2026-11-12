// A plate, as it is remembered.
//
// What is kept of a plate is its recipe: what it was poured from, the
// incubator it sits in, and everything that has been done to it since, each
// with the hour it was done. The picture is not kept. A plate is re-grown
// from its recipe whenever it is needed again, which is why one can be
// stored in a few hundred bytes, or sent to someone as a link.

import { cultureById } from './cultures.js';
import { GRADIENTS, mediumById } from './media.js';
import { vesselById } from './vessels.js';
import { additionById } from './additions.js';
import { SLOTS } from './pack.js';

/** The newest shape of a saved bench. Bump it when a recipe's meaning
 *  changes; anything older is dropped rather than misread.
 *
 *  2: films spread and fold differently, and cultures hold their ground
 *     against each other, so a plate saved before grows into another one. */
export const RECIPE_VERSION = 2;

export const DEFAULT_ENV = {
  temperature: 30, // °C
  humidity: 0.85, // relative, 0..1
  light: 'cycle', // 'cycle' (12 h on, 12 off), 'on' or 'dark'
};

export const TEMPERATURE_RANGE = { min: 4, max: 45, step: 1 };
export const HUMIDITY_RANGE = { min: 0.2, max: 1, step: 0.05 };

/** How long a plate is worth incubating. Past this it has long since run
 *  out of food, and a recipe that asks for more is asking for a long wait. */
export const MAX_HOURS = 24 * 21;

let counter = 0;
function freshSeed() {
  counter += 1;
  return ((Date.now() ^ (counter * 2654435761)) >>> 0) % 1000000;
}

/** A freshly poured plate of a medium, with nothing on it. */
export function createDish(mediumId = 'broth', overrides = {}) {
  return {
    medium: mediumById(mediumId) ? mediumId : 'broth',
    agar: null, // percent, when the pour departs from the medium's own
    nutrient: null,
    vessel: 'dish', // vessels.js
    // One medium id per compartment, for a vessel with more than one; the
    // first is always `medium`. null for a dish.
    media: null,
    gradient: null, // a media.js GRADIENTS value, or none
    env: { ...DEFAULT_ENV },
    seed: freshSeed(),
    events: [],
    hours: 0,
    held: false,
    ...overrides,
  };
}

/** The medium as poured: the library entry with this plate's own agar and
 *  strength where the sliders moved them. */
export function resolveMedium(dish) {
  const base = mediumById(dish.medium) || mediumById('broth');
  return {
    ...base,
    agar: dish.agar ?? base.agar,
    nutrient: dish.nutrient ?? base.nutrient,
  };
}

/**
 * Every compartment's medium as poured, one per compartment of the vessel.
 * They are poured from one gel, so all are as firm as the first; each keeps
 * its own food, pH and look. The strength slider is for a plate of one
 * medium, and is set aside for more.
 */
export function resolveMedia(dish) {
  const first = resolveMedium(dish);
  const vessel = vesselById(dish.vessel) || vesselById('dish');
  if (vessel.compartments === 1 || !dish.media) return [first];
  return Array.from({ length: vessel.compartments }, (_, i) => {
    if (i === 0) return first;
    const base = mediumById(dish.media[i]) || first;
    return { ...base, agar: first.agar };
  });
}

/** The cultures on a plate, in the order they arrived: its four slots. */
export function slotsOf(dish) {
  const slots = [];
  for (const event of dish.events) {
    if (!event.culture) continue;
    if (!slots.includes(event.culture) && slots.length < SLOTS) {
      slots.push(event.culture);
    }
  }
  return slots;
}

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const point = (p) => Array.isArray(p) && finite(p[0]) && finite(p[1]);
const round = (x, places = 2) => {
  const k = 10 ** places;
  return Math.round(x * k) / k;
};

/** Incubator settings from untrusted data: only the known ones, in range. */
function cleanEnv(raw) {
  const env = {};
  if (!raw || typeof raw !== 'object') return env;
  if (finite(raw.temperature)) {
    env.temperature = Math.min(
      Math.max(raw.temperature, TEMPERATURE_RANGE.min),
      TEMPERATURE_RANGE.max,
    );
  }
  if (finite(raw.humidity)) {
    env.humidity = Math.min(
      Math.max(raw.humidity, HUMIDITY_RANGE.min),
      HUMIDITY_RANGE.max,
    );
  }
  if (['cycle', 'on', 'dark'].includes(raw.light)) env.light = raw.light;
  return env;
}

/** One event, checked and trimmed, or null if it makes no sense. A recipe
 *  can arrive from a link someone else wrote, so nothing in it is trusted
 *  to be the shape it should be. */
function cleanEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const at = finite(raw.at) ? Math.min(Math.max(raw.at, 0), MAX_HOURS) : 0;
  const out = { at: round(at, 3), do: raw.do };
  if (raw.do === 'set') {
    const env = cleanEnv(raw.env);
    return Object.keys(env).length ? { ...out, env } : null;
  }
  if (raw.do === 'add') {
    if (!additionById(raw.addition)) return null;
    out.addition = raw.addition;
  } else if (raw.do === 'spot' || raw.do === 'streak' || raw.do === 'lawn') {
    if (!cultureById(raw.culture)) return null;
    out.culture = raw.culture;
    out.seed = finite(raw.seed) ? raw.seed >>> 0 : 1;
  } else {
    return null;
  }
  if (raw.do === 'lawn') {
    if (finite(raw.density))
      out.density = Math.min(Math.max(raw.density, 0.002), 1);
    return out;
  }
  if (Array.isArray(raw.path) && raw.path.length > 1) {
    const path = raw.path.filter(point).slice(0, 400);
    if (path.length < 2) return null;
    out.path = path.map((p) => [round(p[0]), round(p[1])]);
  } else if (finite(raw.x) && finite(raw.y)) {
    if (raw.do === 'streak') return null;
    out.x = round(raw.x);
    out.y = round(raw.y);
  } else {
    return null;
  }
  if (finite(raw.size)) out.size = Math.min(Math.max(raw.size, 0.3), 8);
  if (raw.mixed && raw.do === 'spot') out.mixed = true;
  return out;
}

/** A dish from untrusted data: a saved bench, or a link. Never throws. */
export function cleanDish(raw) {
  if (!raw || typeof raw !== 'object') return createDish();
  const dish = createDish(raw.medium);
  if (finite(raw.agar)) dish.agar = Math.min(Math.max(raw.agar, 0.3), 2.5);
  const vessel = vesselById(raw.vessel);
  if (vessel && vessel.compartments > 1) {
    dish.vessel = vessel.id;
    const listed = Array.isArray(raw.media) ? raw.media : [];
    dish.media = Array.from({ length: vessel.compartments }, (_, i) =>
      i === 0 ? dish.medium : mediumById(listed[i]) ? listed[i] : dish.medium,
    );
  }
  if (GRADIENTS.some((g) => g.value === raw.gradient)) {
    dish.gradient = raw.gradient;
  }
  if (finite(raw.nutrient)) {
    dish.nutrient = Math.min(Math.max(raw.nutrient, 0.1), 1.5);
  }
  dish.env = { ...dish.env, ...cleanEnv(raw.env) };
  if (finite(raw.seed)) dish.seed = raw.seed >>> 0;
  if (finite(raw.hours))
    dish.hours = Math.min(Math.max(raw.hours, 0), MAX_HOURS);
  dish.held = Boolean(raw.held);
  if (typeof raw.recipe === 'string') dish.recipe = raw.recipe.slice(0, 40);
  if (Array.isArray(raw.events)) {
    dish.events = raw.events
      .slice(0, 400)
      .map(cleanEvent)
      .filter(Boolean)
      .sort((a, b) => a.at - b.at);
  }
  return dish;
}

/** A dish as it is written down: only what departs from a fresh pour. */
export function packDish(dish) {
  const out = {
    medium: dish.medium,
    seed: dish.seed,
    hours: round(dish.hours, 2),
  };
  if (dish.agar != null) out.agar = dish.agar;
  if (dish.nutrient != null) out.nutrient = dish.nutrient;
  if (dish.vessel && dish.vessel !== 'dish') {
    out.vessel = dish.vessel;
    out.media = dish.media;
  }
  if (dish.gradient) out.gradient = dish.gradient;
  const env = {};
  for (const key of Object.keys(DEFAULT_ENV)) {
    if (dish.env[key] !== DEFAULT_ENV[key]) env[key] = dish.env[key];
  }
  if (Object.keys(env).length) out.env = env;
  if (dish.held) out.held = true;
  if (dish.recipe) out.recipe = dish.recipe;
  if (dish.events.length) out.events = dish.events;
  return out;
}

/**
 * A plate as a string that fits in a link: its recipe as JSON, in the
 * URL-safe base64 alphabet.
 */
export function encodeDish(dish) {
  const json = JSON.stringify(packDish(dish));
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The other way. Null for anything that isn't a plate. */
export function decodeDish(text) {
  try {
    const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    if (!raw || typeof raw !== 'object' || !mediumById(raw.medium)) return null;
    return cleanDish(raw);
  } catch {
    return null;
  }
}
