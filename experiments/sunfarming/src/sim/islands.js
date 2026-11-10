// The archipelago: which islands there are, what is different about each,
// and what has been done on them so far.
//
// An island is a spec: a seed for its ground and a handful of knobs (how big,
// how wooded, what the weather is like, how far the village can go). The
// islands open one after another, each when the one before it has been
// brought off diesel, and each leans on one thing the others don't, so the
// same tools make a different puzzle.

import { LOCKED } from './catalog.js';
import { hash2 } from './rng.js';

const defaults = Object.freeze({
  size: 20,
  // How far out the coast runs, as a share of the half-width of the grid.
  reach: 0.78,
  // How wooded: 1 is the ordinary scatter of trees.
  trees: 1,
  // Plots for the village, as a block [across, deep].
  block: Object.freeze([4, 3]),
  // The highest tier a home can reach here (see TIERS).
  maxTier: 3,
  climate: 'sunny',
  // How windy, as a multiple of the ordinary.
  wind: 1,
  seasons: false,
  season: 0,
  coins: 250,
  // What the old generator can make, in kW.
  generatorKw: 2,
});

const island = (spec) => Object.freeze({ ...defaults, ...spec });

/** The islands, in the order they open. */
export const ISLANDS = Object.freeze([
  island({
    id: 'tern',
    name: 'Tern Rock',
    seed: 11,
    block: Object.freeze([4, 2]),
    maxTier: 2,
    blurb: 'A first island. Sunny, a little wooded, and a village of eight.',
  }),
  island({
    id: 'pines',
    name: 'The Pines',
    seed: 5,
    trees: 2.6,
    blurb: 'Wooded nearly to the water. Every tree throws a shadow.',
  }),
  island({
    id: 'windward',
    name: 'Windward',
    seed: 37,
    climate: 'grey',
    wind: 1.35,
    trees: 0.6,
    blurb: 'More cloud than sun. The wind makes up for it, if you let it.',
  }),
  island({
    id: 'saltmarsh',
    name: 'Saltmarsh',
    seed: 23,
    size: 16,
    reach: 0.74,
    trees: 0.5,
    climate: 'mixed',
    blurb: 'Hardly any land at all. Every tile is an argument.',
  }),
  island({
    id: 'northing',
    name: 'Northing',
    seed: 52,
    seasons: true,
    season: 2,
    climate: 'mixed',
    blurb: 'Far north. It is autumn, and the days are about to get short.',
  }),
  island({
    id: 'harbour',
    name: 'Harbour',
    seed: 71,
    size: 26,
    reach: 0.8,
    block: Object.freeze([4, 4]),
    seasons: true,
    season: 1,
    climate: 'mixed',
    coins: 300,
    generatorKw: 2.5,
    blurb: 'The big one: a town of sixteen and all four seasons.',
  }),
]);

/** Build with no purse, no goals and nothing locked. */
export const FREE_BUILD = island({
  id: 'free',
  name: 'Free build',
  seed: 404,
  size: 24,
  reach: 0.8,
  block: Object.freeze([4, 4]),
  seasons: true,
  season: 0,
  climate: 'mixed',
  free: true,
  blurb: 'Everything unlocked and nothing to pay for. Build what you like.',
});

/** "2026-11-10": the calendar day `date` falls on, in UTC. */
export function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Today's island: the same one for everybody on a given day, grown from the
 * date, with its own mix of size, woods and weather.
 */
export function todaysIsland(key = dateKey()) {
  const n = Number(key.replaceAll('-', '')) || 1;
  const roll = (i) => hash2(n, i, 2024);
  return island({
    id: 'today',
    date: key,
    name: 'Today’s island',
    seed: Math.floor(roll(1) * 1e9),
    size: 18 + 2 * Math.floor(roll(2) * 3),
    trees: 0.5 + roll(3) * 1.8,
    block: Object.freeze([4, 2]),
    maxTier: 2,
    climate: ['sunny', 'mixed', 'grey'][Math.floor(roll(4) * 3)],
    wind: 0.7 + roll(5) * 0.7,
    seasons: roll(6) < 0.4,
    season: Math.floor(roll(7) * 4),
    daily: true,
    blurb: 'The same island for everyone, today only.',
  });
}

/** The spec an id names, or null. `date` is for 'today'. */
export function specById(id, date) {
  if (id === 'free') return FREE_BUILD;
  if (id === 'today') return todaysIsland(date || dateKey());
  return ISLANDS.find((spec) => spec.id === id) || null;
}

/* ── what has been done ───────────────────────────────────────────────────── */

/** Nothing done, nothing unlocked. */
export function newProgress() {
  return { done: {}, unlocked: [] };
}

/** Progress from storage, with anything that isn't progress dropped. */
export function readProgress(data) {
  const progress = newProgress();
  if (!data || typeof data !== 'object') return progress;
  if (data.done && typeof data.done === 'object') {
    for (const [id, result] of Object.entries(data.done)) {
      if (!result || typeof result !== 'object') continue;
      if (!Number.isFinite(result.day) || result.day < 1) continue;
      progress.done[id] = {
        day: Math.floor(result.day),
        ...(typeof result.date === 'string' ? { date: result.date } : {}),
      };
    }
  }
  if (Array.isArray(data.unlocked)) {
    progress.unlocked = LOCKED.filter((kind) => data.unlocked.includes(kind));
  }
  return progress;
}

/**
 * Whether an island can be played yet: the first always can, each of the
 * others once the one before it is done. Free build opens with the second
 * island, so the first is always met with a purse.
 */
export function isOpen(progress, id) {
  if (id === 'today') return Boolean(progress.done[ISLANDS[0].id]);
  if (id === 'free') return Boolean(progress.done[ISLANDS[0].id]);
  const i = ISLANDS.findIndex((spec) => spec.id === id);
  if (i < 0) return false;
  return i === 0 || Boolean(progress.done[ISLANDS[i - 1].id]);
}

/**
 * Record an island as done on `day`. A better (earlier) day replaces a
 * worse one; today's island is remembered only for the date it was played.
 */
export function markDone(progress, spec, day) {
  const before = progress.done[spec.id];
  const sameRun = !spec.daily || before?.date === spec.date;
  if (before && sameRun && before.day <= day) return progress;
  return {
    ...progress,
    done: {
      ...progress.done,
      [spec.id]: { day, ...(spec.daily ? { date: spec.date } : {}) },
    },
  };
}

/** Add newly earned buildings to the ones kept from island to island. */
export function withUnlocked(progress, kinds) {
  const all = LOCKED.filter(
    (kind) => progress.unlocked.includes(kind) || kinds.includes(kind),
  );
  if (all.length === progress.unlocked.length) return progress;
  return { ...progress, unlocked: all };
}

/** The island that opens when `id` is finished, or null. */
export function nextIsland(id) {
  const i = ISLANDS.findIndex((spec) => spec.id === id);
  return i >= 0 && i < ISLANDS.length - 1 ? ISLANDS[i + 1] : null;
}
