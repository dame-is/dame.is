// Where the grid sits in the 3D world. A tile is 1 unit square, the island is
// centred on the origin, +x is east and +z is south. The sun rises in the
// east, leans south at noon and sets in the west, so +z is the lit side of
// everything.

import { TERRAIN } from '../sim/catalog.js';

/** Heights of the tops of things: the grass sits a step above the beach. */
export const GRASS_Y = 0.16;
export const SAND_Y = 0;
export const SEA_Y = -0.13;
/** How far the island's skirt hangs down under the water. */
export const SKIRT_Y = -0.9;

export function tileX(idx, size) {
  return (idx % size) - size / 2 + 0.5;
}

export function tileZ(idx, size) {
  return Math.floor(idx / size) - size / 2 + 0.5;
}

/** The height of a tile's top, or of the sea for a tile of water. */
export function tileY(terrain, idx) {
  const t = terrain[idx];
  if (t === TERRAIN.GRASS) return GRASS_Y;
  if (t === TERRAIN.SAND) return SAND_Y;
  return SEA_Y;
}

/** The tile under a point on the ground, or -1 if it is off the map. */
export function tileAt(wx, wz, size) {
  const x = Math.floor(wx + size / 2);
  const z = Math.floor(wz + size / 2);
  if (x < 0 || z < 0 || x >= size || z >= size) return -1;
  return z * size + x;
}
