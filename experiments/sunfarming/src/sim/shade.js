// Shade: whether the sun can reach a panel past the things around it.
//
// Trees, homes and the taller machines stand between a panel and a low sun.
// A panel in their shadow makes a quarter of what it would (the light of the
// sky, not the sun). The test walks from the panel toward the sun across the
// grid and asks, tile by tile, whether what stands there is taller than the
// ray at that point. It uses the same sun direction the picture is lit by,
// so the shadow drawn across a panel is the one it is charged for.

import { GROUND, KINDS, TERRAIN, TIERS } from './catalog.js';
import { SEASONS, sunDirection, sunFactor } from './sun.js';

/** How high off its tile a panel looks at the sky from. */
const PANEL_EYE = 0.36;
/** A shadow is not looked for further away than this, in tiles. */
const REACH = 5;
const STEP = 0.25;

/** How tall a thing stands for the purposes of shade; 0 for flat things. */
export function shadeHeight(thing) {
  if (!thing) return 0;
  if (thing.kind === 'house') return TIERS[thing.tier || 1].height;
  return KINDS[thing.kind]?.shade || 0;
}

const groundAt = (game, idx) =>
  game.terrain[idx] === TERRAIN.GRASS ? GROUND.GRASS : GROUND.SAND;

/**
 * Whether tile `idx` is in shadow when the sun is at `dir` (a unit vector
 * toward it, as sunDirection gives). `skip` is a tile to see through: the
 * thing about to be replaced, when asking about somewhere not yet built on.
 */
export function isShaded(game, idx, dir, skip = -1) {
  const { size, things } = game;
  const flat = Math.hypot(dir.x, dir.z);
  // Straight overhead: nothing beside a panel can cover it.
  if (flat < 1e-6) return false;
  const stepX = dir.x / flat;
  const stepZ = dir.z / flat;
  const rise = dir.y / flat;
  const cx = (idx % size) + 0.5;
  const cz = Math.floor(idx / size) + 0.5;
  const eye = groundAt(game, idx) + PANEL_EYE;
  let last = idx;
  for (let s = 0.5; s <= REACH; s += STEP) {
    const x = Math.floor(cx + stepX * s);
    const z = Math.floor(cz + stepZ * s);
    if (x < 0 || z < 0 || x >= size || z >= size) return false;
    const at = z * size + x;
    if (at === last || at === idx || at === skip) continue;
    last = at;
    const height = shadeHeight(things[at]);
    if (height > 0 && groundAt(game, at) + height > eye + rise * s) return true;
  }
  return false;
}

const scratch = { x: 0, y: 0, z: 0 };

/**
 * Which tiles holding a panel are in shadow right now, as a Uint8Array over
 * the grid (1 = shaded). Kept on the game and worked out again only when the
 * sun has moved a quarter of an hour or something has been built.
 */
export function shadeNow(game, season) {
  const stamp = Math.floor(game.time * 4);
  if (game.light && game.light.stamp === stamp) return game.light.shaded;
  const shaded =
    game.light?.shaded?.fill(0) || new Uint8Array(game.things.length);
  const dir = sunDirection(game.time, season, scratch);
  if (dir) {
    for (let idx = 0; idx < game.things.length; idx += 1) {
      const kind = game.things[idx]?.kind;
      if (kind !== 'panel' && kind !== 'tracker') continue;
      if (isShaded(game, idx, dir)) shaded[idx] = 1;
    }
  }
  game.light = { stamp, shaded };
  return shaded;
}

/**
 * How much of a day's light each tile would get if a panel stood on it: a
 * Float32Array over the grid, 0 to 1, with -1 for the sea. It is weighted by
 * how strong the sun is at each hour, so shade at noon costs more than shade
 * at dawn. This is the map shown while a panel is in hand.
 */
export function sunMap(game, season = SEASONS[0]) {
  const map = new Float32Array(game.things.length);
  const hours = [];
  for (let h = season.dawn + 0.25; h < season.dusk; h += 0.5) {
    const dir = sunDirection(h, season, { x: 0, y: 0, z: 0 });
    if (dir) hours.push({ dir, weight: sunFactor(h, season) });
  }
  const total = hours.reduce((sum, hour) => sum + hour.weight, 0) || 1;
  for (let idx = 0; idx < map.length; idx += 1) {
    if (game.terrain[idx] === TERRAIN.WATER) {
      map[idx] = -1;
      continue;
    }
    let lit = 0;
    for (const { dir, weight } of hours) {
      // The tile itself is seen through: the question is what a panel put
      // here would get, whatever is here now.
      if (!isShaded(game, idx, dir, idx)) lit += weight;
    }
    map[idx] = lit / total;
  }
  return map;
}
