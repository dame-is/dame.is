// The island: which tiles are sea, beach and grass, where the trees and rocks
// stand, and which tiles the village will grow onto.
//
// It is all drawn from a seed, and nothing here is saved: a saved game keeps
// the seed and what has been built, and the ground comes back from this.

import { GRID, TERRAIN, VILLAGE_PLOTS } from './catalog.js';
import { createRng, hash2 } from './rng.js';

/** The seed a first visit lands on: an island picked to be a good start. */
export const DEFAULT_SEED = 11;

export const indexOf = (x, z, size = GRID) => z * size + x;
export const xOf = (idx, size = GRID) => idx % size;
export const zOf = (idx, size = GRID) => Math.floor(idx / size);
export const inBounds = (x, z, size = GRID) =>
  x >= 0 && z >= 0 && x < size && z < size;

/** The four tiles a tile touches, as indexes. Diagonals don't touch. */
export function neighbours(idx, size = GRID) {
  const x = xOf(idx, size);
  const z = zOf(idx, size);
  const out = [];
  if (z > 0) out.push(idx - size);
  if (x < size - 1) out.push(idx + 1);
  if (z < size - 1) out.push(idx + size);
  if (x > 0) out.push(idx - 1);
  return out;
}

// Smooth value noise over the grid, for clumping trees into woods.
function valueNoise(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/**
 * Grow an island from a seed.
 *
 * Returns `{ seed, size, terrain, scenery, plots }`: `terrain` is one
 * TERRAIN value per tile, `scenery` the trees and rocks as `{ idx, kind,
 * variant }`, and `plots` the tiles kept for the village, in the order houses
 * are built on them. Each plot touches one before it, so the village is
 * always a single block that one power line can reach.
 */
export function generateIsland(seed = DEFAULT_SEED, size = GRID) {
  const rng = createRng(seed);
  const terrain = new Uint8Array(size * size);

  // The coast: a circle with a few slow lobes and a little grit, so it has
  // bays and headlands but stays one piece.
  const lobes = [
    { n: 2, amp: 0.05 + rng() * 0.04, phase: rng() * Math.PI * 2 },
    { n: 3, amp: 0.04 + rng() * 0.04, phase: rng() * Math.PI * 2 },
    { n: 5, amp: 0.02 + rng() * 0.03, phase: rng() * Math.PI * 2 },
  ];
  const half = size / 2;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5 - half) / half;
      const v = (z + 0.5 - half) / half;
      const r = Math.hypot(u, v);
      const angle = Math.atan2(v, u);
      let edge = 0.78;
      for (const lobe of lobes)
        edge += lobe.amp * Math.sin(lobe.n * angle + lobe.phase);
      edge += (hash2(x, z, seed) - 0.5) * 0.05;
      terrain[indexOf(x, z, size)] = r < edge ? TERRAIN.GRASS : TERRAIN.WATER;
    }
  }

  // The outermost tile of the map is always sea, so the island has water all
  // the way round whatever the lobes did.
  for (let i = 0; i < size; i += 1) {
    terrain[indexOf(i, 0, size)] = TERRAIN.WATER;
    terrain[indexOf(i, size - 1, size)] = TERRAIN.WATER;
    terrain[indexOf(0, i, size)] = TERRAIN.WATER;
    terrain[indexOf(size - 1, i, size)] = TERRAIN.WATER;
  }

  // The beach: any land that can see the sea, corners included.
  const beach = [];
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = indexOf(x, z, size);
      if (terrain[idx] !== TERRAIN.GRASS) continue;
      let coastal = false;
      for (let dz = -1; dz <= 1 && !coastal; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!inBounds(x + dx, z + dz, size)) continue;
          if (terrain[indexOf(x + dx, z + dz, size)] === TERRAIN.WATER) {
            coastal = true;
            break;
          }
        }
      }
      if (coastal) beach.push(idx);
    }
  }
  for (const idx of beach) terrain[idx] = TERRAIN.SAND;

  const plots = villagePlots(terrain, size);
  const plotSet = new Set(plots);

  // Keep a clear tile around the village so there is always a way in.
  const apron = new Set(plots);
  for (const idx of plots) {
    const x = xOf(idx, size);
    const z = zOf(idx, size);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (inBounds(x + dx, z + dz, size))
          apron.add(indexOf(x + dx, z + dz, size));
      }
    }
  }

  // Trees in clumps on the grass, a few rocks anywhere on land.
  const scenery = [];
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = indexOf(x, z, size);
      if (terrain[idx] === TERRAIN.WATER || plotSet.has(idx) || apron.has(idx))
        continue;
      const roll = rng();
      const variant = Math.floor(rng() * 1000);
      if (terrain[idx] === TERRAIN.GRASS) {
        const wood = valueNoise(x / 3.1, z / 3.1, seed + 17);
        if (roll < 0.03) scenery.push({ idx, kind: 'rock', variant });
        else if (roll < 0.03 + Math.max(0, wood - 0.42) * 1.25) {
          scenery.push({ idx, kind: 'tree', variant });
        }
      } else if (roll < 0.035) {
        scenery.push({ idx, kind: 'rock', variant });
      }
    }
  }

  return { seed, size, terrain, scenery, plots };
}

// The village: a 4 × 3 block of grass, as near as it can be found to a spot
// west of the middle. Its plots are ordered from the block's heart outwards,
// each one touching an earlier one.
function villagePlots(terrain, size) {
  const W = 4;
  const D = 3;
  const targetX = size * 0.3;
  const targetZ = size * 0.52;
  let best = null;
  for (let z = 0; z + D <= size; z += 1) {
    for (let x = 0; x + W <= size; x += 1) {
      let grass = true;
      for (let dz = 0; dz < D && grass; dz += 1) {
        for (let dx = 0; dx < W; dx += 1) {
          if (terrain[indexOf(x + dx, z + dz, size)] !== TERRAIN.GRASS) {
            grass = false;
            break;
          }
        }
      }
      if (!grass) continue;
      const score = Math.hypot(x + W / 2 - targetX, z + D / 2 - targetZ);
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  if (!best) return [];

  // The first house goes on the edge of the block that faces the middle of
  // the island, where the room to build is, and the rest spread back from
  // it. An edge, because the plots around a house are kept for the village:
  // a first house in the middle of the block could never be wired to.
  const mid = (size - 1) / 2;
  const cells = [];
  for (let dz = 0; dz < D; dz += 1) {
    for (let dx = 0; dx < W; dx += 1) {
      const x = best.x + dx;
      const z = best.z + dz;
      cells.push({
        idx: indexOf(x, z, size),
        x,
        z,
        edge: dx === 0 || dz === 0 || dx === W - 1 || dz === D - 1,
        inward: Math.hypot(x - mid, z - mid),
      });
    }
  }
  const first = cells
    .filter((c) => c.edge)
    .reduce((a, b) => (b.inward < a.inward ? b : a));
  for (const c of cells) {
    // The lean toward the middle breaks ties the same way every time.
    c.d = Math.hypot(c.x - first.x, c.z - first.z) + c.inward * 1e-3;
  }
  cells.sort((a, b) => a.d - b.d);

  const ordered = [cells.shift().idx];
  while (cells.length && ordered.length < VILLAGE_PLOTS) {
    const at = cells.findIndex((c) =>
      neighbours(c.idx, size).some((n) => ordered.includes(n)),
    );
    ordered.push(cells.splice(at < 0 ? 0 : at, 1)[0].idx);
  }
  return ordered;
}
