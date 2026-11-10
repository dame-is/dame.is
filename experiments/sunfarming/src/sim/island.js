// The island's ground: which tiles are sea, beach and grass, where the trees
// and rocks stand, which tiles the village will grow onto, and where the old
// diesel generator sits at the water's edge with its line up to the village.
//
// It is all drawn from a spec (src/sim/islands.js) and nothing here is saved:
// a saved game keeps the spec's id and what has been built, and the ground
// comes back from this.

import { START_HOUSES, TERRAIN } from './catalog.js';
import { createRng, hash2 } from './rng.js';

export const indexOf = (x, z, size) => z * size + x;
export const xOf = (idx, size) => idx % size;
export const zOf = (idx, size) => Math.floor(idx / size);
export const inBounds = (x, z, size) =>
  x >= 0 && z >= 0 && x < size && z < size;

/** The four tiles a tile touches, as indexes. Diagonals don't touch. */
export function neighbours(idx, size) {
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
 * Grow an island from its spec.
 *
 * Returns `{ size, terrain, scenery, plots, generator, line, pier }`:
 * `terrain` is one TERRAIN value per tile; `scenery` the trees and rocks as
 * `{ idx, kind, variant }`; `plots` the tiles kept for the village, in the
 * order homes are built on them (each touches one before it, so the village
 * is always a single block); `generator` the beach tile the diesel generator
 * stands on, `line` the tiles of power line from it to the first home, and
 * `pier` the tile of sea its fuel comes in at. The last three are -1, [] and
 * -1 on the rare island with no way to the coast.
 *
 * A spec with a `map` is drawn by hand instead (see drawnIsland), and also
 * returns `marks`: the tiles its map names, for a lesson to point at.
 */
export function generateIsland(spec) {
  if (spec.map) return drawnIsland(spec);
  const { seed, size } = spec;
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
      let edge = spec.reach;
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

  layBeach(terrain, size);

  const plots = villagePlots(terrain, size, spec.block);
  const plotSet = new Set(plots);
  const dock = generatorSite(terrain, size, plots);
  const kept = new Set([...plots, ...dock.line, dock.generator]);

  // Keep a clear tile around the village so there is always a way in.
  for (const idx of plots) {
    const x = xOf(idx, size);
    const z = zOf(idx, size);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (inBounds(x + dx, z + dz, size))
          kept.add(indexOf(x + dx, z + dz, size));
      }
    }
  }

  // Trees in clumps on the grass, a few rocks anywhere on land.
  const scenery = [];
  const woods = spec.trees ?? 1;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = indexOf(x, z, size);
      // The stream is drawn from for every tile, wooded or not, so the same
      // seed scatters the same rocks however many trees were asked for.
      const roll = rng();
      const variant = Math.floor(rng() * 1000);
      if (terrain[idx] === TERRAIN.WATER || plotSet.has(idx) || kept.has(idx))
        continue;
      if (terrain[idx] === TERRAIN.GRASS) {
        const wood = valueNoise(x / 3.1, z / 3.1, seed + 17);
        const chance = Math.min(
          0.85,
          (Math.max(0, wood - 0.42) * 1.25 + (woods - 1) * 0.12) * woods,
        );
        if (roll < 0.03) scenery.push({ idx, kind: 'rock', variant });
        else if (roll < 0.03 + Math.max(0, chance))
          scenery.push({ idx, kind: 'tree', variant });
      } else if (roll < 0.035) {
        scenery.push({ idx, kind: 'rock', variant });
      }
    }
  }

  return { size, terrain, scenery, plots, ...dock };
}

// The beach: any land that can see the sea, corners included.
function layBeach(terrain, size) {
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
}

/**
 * An island drawn by hand: `spec.map` is its rows, north first, a character
 * a tile (the key is beside the one island that has one, in islands.js). It
 * returns what generateIsland does, and `marks`: for each name the map
 * uses, the tiles carrying it, in reading order.
 */
function drawnIsland(spec) {
  const { size, seed = 0 } = spec;
  const terrain = new Uint8Array(size * size);
  const scenery = [];
  const plots = [];
  const line = [];
  const marks = {};
  let generator = -1;
  let pier = -1;
  const mark = (name, idx) => {
    (marks[name] ||= []).push(idx);
  };
  const variantAt = (x, z) => Math.floor(hash2(x, z, seed) * 1000);

  for (let z = 0; z < size; z += 1) {
    const row = spec.map[z] || '';
    for (let x = 0; x < size; x += 1) {
      const idx = indexOf(x, z, size);
      const c = row[x] || '.';
      if (c === '.' || c === '~') {
        terrain[idx] = TERRAIN.WATER;
        if (c === '~') pier = idx;
        continue;
      }
      terrain[idx] = TERRAIN.GRASS;
      if (c === 'T' || c === '*') {
        scenery.push({ idx, kind: 'tree', variant: variantAt(x, z) });
        if (c === '*') mark('tree', idx);
      } else if (c === 'R') {
        scenery.push({ idx, kind: 'rock', variant: variantAt(x, z) });
      } else if (c === 'G') generator = idx;
      else if (c === '=') line.push(idx);
      else if (c >= '1' && c <= '9') plots[Number(c) - 1] = idx;
      else if (c >= 'a' && c <= 'z') mark(c, idx);
    }
  }
  layBeach(terrain, size);

  // The line as a walk from the first home down to the generator, which is
  // the order the grown islands give it in.
  const ordered = [];
  const left = new Set(line);
  let at = plots[0];
  while (left.size) {
    const next = neighbours(at, size).find((n) => left.has(n));
    if (next === undefined) break;
    left.delete(next);
    ordered.push(next);
    at = next;
  }

  return {
    size,
    terrain,
    scenery,
    plots: plots.filter((idx) => idx !== undefined),
    generator,
    line: ordered,
    pier,
    marks,
  };
}

// The village: a block of grass, as near as it can be found to a spot west of
// the middle. Its plots are ordered outwards from the first, each one
// touching an earlier one.
function villagePlots(terrain, size, block) {
  const [W, D] = block;
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

  // The first home goes on the edge of the block that faces the middle of
  // the island, where the room to build is, and the rest spread back from
  // it. An edge, because the plots around a home are kept for the village:
  // a first home in the middle of the block could never be wired to.
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
  while (cells.length) {
    const at = cells.findIndex((c) =>
      neighbours(c.idx, size).some((n) => ordered.includes(n)),
    );
    ordered.push(cells.splice(at < 0 ? 0 : at, 1)[0].idx);
  }
  return ordered;
}

// Where the generator goes: the nearest piece of beach with sea beside it
// that can be walked to from the first homes without crossing a plot. The
// walk is the power line.
function generatorSite(terrain, size, plots) {
  const none = { generator: -1, line: [], pier: -1 };
  if (!plots.length) return none;
  const plotSet = new Set(plots);
  const homes = plots.slice(0, START_HOUSES);
  const from = new Map();
  const queue = [];
  for (const home of homes) {
    for (const n of neighbours(home, size)) {
      if (terrain[n] === TERRAIN.WATER || plotSet.has(n) || from.has(n))
        continue;
      from.set(n, -1);
      queue.push(n);
    }
  }
  while (queue.length) {
    const idx = queue.shift();
    const sea = neighbours(idx, size).find((n) => terrain[n] === TERRAIN.WATER);
    // Not right against a home: a generator wants a little distance.
    if (
      terrain[idx] === TERRAIN.SAND &&
      sea !== undefined &&
      from.get(idx) !== -1
    ) {
      const line = [];
      for (let at = from.get(idx); at !== -1; at = from.get(at)) line.push(at);
      return { generator: idx, line: line.reverse(), pier: sea };
    }
    for (const n of neighbours(idx, size)) {
      if (terrain[n] === TERRAIN.WATER || plotSet.has(n) || from.has(n))
        continue;
      from.set(n, idx);
      queue.push(n);
    }
  }
  return none;
}
