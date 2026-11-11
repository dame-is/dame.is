// What everything looks like. Each model is one merged, vertex-coloured
// geometry (plus a welded copy for its outline), built once and shared by
// every instance on the island. A tile is 1 unit square and models stand on
// y = 0 at its centre, facing south (+z), which is where the sun spends the
// day. A few things have a part that moves (a tracker's head, a turbine's
// rotor); those parts are models of their own, placed by PARTS below.

import { box, blob, cylinder, lump, merge, roof } from './shapes.js';
import { outlineGeometry } from './toon.js';

/** How far the fixed solar panels lean toward the sun's side of the sky. */
export const PANEL_TILT = 0.44;

const ROOFS = [
  '#e2574c',
  '#f0a23b',
  '#3fa7a3',
  '#8c6bd1',
  '#e77fa4',
  '#4f86d9',
];
const WALLS = ['#fff4dc', '#fbe9c9', '#f6efe6'];
const WOOD = '#b47a42';
const WOOD_DARK = '#8a5a2e';
const STEEL = '#aab2bf';
const STEEL_DARK = '#8d95a3';
const CREAM = '#fbf3df';

// A slab of solar cells lying flat with its middle at the origin: a pale
// frame, and `cols` × 2 cells standing a hair proud of it.
function cells(width, depth, cols, shades) {
  const parts = [box([width, 0.05, depth], '#eef2f7', [0, 0, 0])];
  const cw = (width - 0.06) / cols;
  const cd = (depth - 0.06) / 2;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      parts.push(
        box([cw - 0.03, 0.02, cd - 0.03], shades[(row + col) % 2], [
          (col - (cols - 1) / 2) * cw,
          0.03,
          (row - 0.5) * cd,
        ]),
      );
    }
  }
  return merge(parts);
}

function panel() {
  const slab = cells(0.9, 0.64, 3, ['#2a59b0', '#2f66c4']);
  slab.rotateX(PANEL_TILT);
  slab.translate(0, 0.36, 0);
  return merge([
    box([0.3, 0.05, 0.3], STEEL_DARK, [0, 0.025, 0]),
    box([0.08, 0.34, 0.08], STEEL, [0, 0.17, 0]),
    slab,
  ]);
}

// A tracking panel is a stout post with a yellow yoke; its head is separate
// and turned to face the sun (see PARTS and world.js).
function tracker() {
  return merge([
    box([0.34, 0.06, 0.34], STEEL_DARK, [0, 0.03, 0]),
    box([0.12, 0.42, 0.12], STEEL, [0, 0.24, 0]),
    box([0.2, 0.1, 0.2], '#ffc93c', [0, 0.47, 0]),
  ]);
}

function trackerHead() {
  const slab = cells(0.92, 0.66, 3, ['#1f8fa8', '#27a3bd']);
  slab.translate(0, 0.07, 0);
  return merge([slab, box([0.14, 0.06, 0.5], STEEL_DARK, [0, 0.02, 0])]);
}

function turbine() {
  return merge([
    box([0.36, 0.06, 0.36], STEEL_DARK, [0, 0.03, 0]),
    cylinder(0.05, 0.1, 1.5, '#f4f6f9', [0, 0.78, 0], 8),
    box([0.17, 0.15, 0.34], '#f4f6f9', [0, 1.55, 0.02]),
    box([0.17, 0.05, 0.34], '#f25f4c', [0, 1.65, 0.02]),
  ]);
}

// Three blades about a hub, in the plane that faces south; spun about z.
function turbineRotor() {
  const parts = [cylinder(0.07, 0.07, 0.1, '#f25f4c', [0, 0, 0], 8)];
  parts[0].rotateX(Math.PI / 2);
  for (let i = 0; i < 3; i += 1) {
    const blade = box([0.09, 0.62, 0.03], '#f4f6f9', [0, 0.33, 0]);
    blade.rotateZ((i * Math.PI * 2) / 3);
    parts.push(blade);
  }
  return merge(parts);
}

function battery() {
  return merge([
    box([0.74, 0.07, 0.56], STEEL_DARK, [0, 0.035, 0]),
    box([0.64, 0.4, 0.46], CREAM, [0, 0.27, 0]),
    box([0.66, 0.09, 0.48], '#35b8a6', [0, 0.2, 0]),
    box([0.66, 0.05, 0.48], '#2a3b45', [0, 0.495, 0]),
    cylinder(0.045, 0.045, 0.09, '#f25f4c', [-0.24, 0.56, -0.14], 8),
    cylinder(0.045, 0.045, 0.09, '#4a5568', [0.24, 0.56, -0.14], 8),
  ]);
}

function bank() {
  return merge([
    box([0.94, 0.08, 0.76], STEEL_DARK, [0, 0.04, 0]),
    box([0.86, 0.5, 0.68], CREAM, [0, 0.33, 0]),
    box([0.88, 0.1, 0.7], '#35b8a6', [0, 0.22, 0]),
    box([0.88, 0.1, 0.7], '#35b8a6', [0, 0.44, 0]),
    box([0.88, 0.06, 0.7], '#2a3b45', [0, 0.61, 0]),
    // Cooling fins down the south face.
    box([0.5, 0.26, 0.04], '#c9d2dc', [0.12, 0.33, 0.35]),
    box([0.12, 0.3, 0.04], '#ffc93c', [-0.3, 0.33, 0.35]),
  ]);
}

/** One of the lamps on a battery's lid; a row of them is its gauge. */
function batteryLamp() {
  return box([0.1, 0.03, 0.2], '#ffffff', [0, 0, 0]);
}

function pole() {
  return merge([
    box([0.2, 0.05, 0.2], WOOD_DARK, [0, 0.025, 0]),
    box([0.085, 0.8, 0.085], WOOD, [0, 0.4, 0]),
    box([0.2, 0.07, 0.2], '#5b4a6b', [0, 0.8, 0]),
    box([0.09, 0.07, 0.09], CREAM, [0, 0.87, 0]),
  ]);
}

// The old diesel generator: an orange set on skids with its exhaust stack
// (smoke comes from the top of it, see SMOKE_AT) and a fuel drum beside it.
function generator() {
  return merge([
    box([0.86, 0.06, 0.6], '#4a4458', [0, 0.03, 0]),
    box([0.62, 0.36, 0.46], '#e08a2e', [-0.08, 0.24, 0]),
    box([0.64, 0.06, 0.48], '#b86a1e', [-0.08, 0.44, 0]),
    box([0.3, 0.2, 0.03], '#4a4458', [-0.08, 0.26, 0.235]),
    box([0.03, 0.2, 0.3], '#4a4458', [-0.395, 0.26, 0]),
    cylinder(0.035, 0.035, 0.42, '#4a4458', [-0.26, 0.66, -0.1], 6),
    cylinder(0.055, 0.055, 0.06, '#2a2440', [-0.26, 0.88, -0.1], 6),
    cylinder(0.13, 0.13, 0.34, '#c8412f', [0.31, 0.23, 0.08], 8),
    cylinder(0.135, 0.135, 0.04, '#8f2c20', [0.31, 0.2, 0.08], 8),
  ]);
}

/** Where the generator's smoke leaves it, above its own tile. */
export const SMOKE_AT = Object.freeze([-0.26, 0.95, -0.1]);

// The fuel pier: planks from the beach out over one tile of sea, built
// running north to south (+z is the seaward end) and turned to face the sea.
function pier() {
  const parts = [box([0.5, 0.05, 1.5], WOOD, [0, 0.03, 0.25])];
  for (let i = 0; i < 6; i += 1) {
    parts.push(box([0.52, 0.02, 0.03], WOOD_DARK, [0, 0.06, -0.4 + i * 0.26]));
  }
  for (const [x, z] of [
    [-0.22, 0.1],
    [0.22, 0.1],
    [-0.22, 0.92],
    [0.22, 0.92],
  ]) {
    parts.push(box([0.07, 0.5, 0.07], WOOD_DARK, [x, -0.14, z]));
  }
  return merge(parts);
}

// The fuel boat, bow toward +z.
function boat() {
  return merge([
    box([0.4, 0.16, 0.84], '#2f5d8c', [0, 0.02, 0]),
    box([0.3, 0.16, 0.2], '#2f5d8c', [0, 0.02, 0.5], [0, Math.PI / 4, 0]),
    box([0.44, 0.04, 0.88], CREAM, [0, 0.11, 0]),
    box([0.26, 0.22, 0.26], CREAM, [0, 0.24, -0.22]),
    box([0.3, 0.04, 0.3], '#e2574c', [0, 0.37, -0.22]),
    cylinder(0.08, 0.08, 0.2, '#c8412f', [-0.08, 0.23, 0.16], 8),
    cylinder(0.08, 0.08, 0.2, '#c8412f', [0.09, 0.23, 0.2], 8),
  ]);
}

/* ── homes ────────────────────────────────────────────────────────────────── */

function cottage(variant) {
  const wall = WALLS[variant % WALLS.length];
  const top = ROOFS[variant % ROOFS.length];
  return merge([
    box([0.66, 0.4, 0.58], wall, [0, 0.2, 0]),
    roof(0.8, 0.74, 0.34, top, [0, 0.4, 0]),
    // The gables under the roof, in the wall's colour.
    box([0.05, 0.16, 0.3], wall, [-0.305, 0.44, 0]),
    box([0.05, 0.16, 0.3], wall, [0.305, 0.44, 0]),
    box([0.16, 0.24, 0.03], WOOD_DARK, [-0.14, 0.12, 0.3]),
    box([0.1, 0.22, 0.1], '#c9c2b8', [0.2, 0.66, -0.12]),
    box([0.13, 0.04, 0.13], '#8d8478', [0.2, 0.78, -0.12]),
  ]);
}

function cottageWindows() {
  return merge([
    box([0.17, 0.15, 0.03], '#ffffff', [0.14, 0.22, 0.295]),
    box([0.15, 0.14, 0.03], '#ffffff', [-0.14, 0.22, -0.295]),
    box([0.15, 0.14, 0.03], '#ffffff', [0.14, 0.22, -0.295]),
    box([0.03, 0.14, 0.17], '#ffffff', [0.335, 0.22, 0.05]),
    box([0.03, 0.14, 0.17], '#ffffff', [-0.335, 0.22, 0.05]),
  ]);
}

// A house: a storey and a half, a porch, a dormer.
function house(variant) {
  const wall = WALLS[variant % WALLS.length];
  const top = ROOFS[variant % ROOFS.length];
  return merge([
    box([0.76, 0.52, 0.64], wall, [0, 0.26, 0]),
    roof(0.9, 0.8, 0.38, top, [0, 0.52, 0]),
    box([0.05, 0.2, 0.34], wall, [-0.355, 0.57, 0]),
    box([0.05, 0.2, 0.34], wall, [0.355, 0.57, 0]),
    // The porch and its little roof.
    box([0.36, 0.04, 0.16], '#c9c2b8', [-0.14, 0.02, 0.38]),
    box([0.4, 0.04, 0.2], top, [-0.14, 0.34, 0.38]),
    box([0.04, 0.3, 0.04], CREAM, [-0.3, 0.18, 0.44]),
    box([0.04, 0.3, 0.04], CREAM, [0.02, 0.18, 0.44]),
    box([0.16, 0.26, 0.03], WOOD_DARK, [-0.14, 0.15, 0.33]),
    // A dormer on the south slope.
    box([0.2, 0.16, 0.2], wall, [0.16, 0.66, 0.2]),
    box([0.24, 0.04, 0.24], top, [0.16, 0.75, 0.2]),
    box([0.11, 0.26, 0.11], '#c9c2b8', [0.24, 0.82, -0.14]),
    box([0.14, 0.04, 0.14], '#8d8478', [0.24, 0.96, -0.14]),
  ]);
}

function houseWindows() {
  return merge([
    box([0.2, 0.18, 0.03], '#ffffff', [0.18, 0.28, 0.325]),
    box([0.12, 0.1, 0.03], '#ffffff', [0.16, 0.66, 0.305]),
    box([0.17, 0.16, 0.03], '#ffffff', [-0.18, 0.28, -0.325]),
    box([0.17, 0.16, 0.03], '#ffffff', [0.18, 0.28, -0.325]),
    box([0.03, 0.16, 0.2], '#ffffff', [0.385, 0.28, 0.04]),
    box([0.03, 0.16, 0.2], '#ffffff', [-0.385, 0.28, 0.04]),
  ]);
}

// A townhouse: three storeys, a workshop door, a balcony, and a charger on
// the wall for whatever is plugged in overnight.
function townhouse(variant) {
  const wall = WALLS[variant % WALLS.length];
  const top = ROOFS[variant % ROOFS.length];
  return merge([
    box([0.78, 0.8, 0.66], wall, [0, 0.4, 0]),
    box([0.8, 0.04, 0.68], top, [0, 0.31, 0]),
    roof(0.9, 0.8, 0.3, top, [0, 0.8, 0]),
    box([0.05, 0.14, 0.3], wall, [-0.365, 0.83, 0]),
    box([0.05, 0.14, 0.3], wall, [0.365, 0.83, 0]),
    // The workshop's wide door, and the front door beside it.
    box([0.3, 0.24, 0.03], '#6f8fa8', [0.16, 0.13, 0.34]),
    box([0.14, 0.26, 0.03], WOOD_DARK, [-0.22, 0.14, 0.34]),
    // A balcony on the first floor.
    box([0.44, 0.03, 0.14], '#c9c2b8', [-0.08, 0.36, 0.39]),
    box([0.44, 0.1, 0.02], '#4a4458', [-0.08, 0.42, 0.45]),
    // The charger.
    box([0.08, 0.16, 0.06], '#3fbf74', [0.425, 0.16, 0.2]),
    box([0.11, 0.3, 0.11], '#c9c2b8', [0.24, 1.02, -0.14]),
    box([0.14, 0.04, 0.14], '#8d8478', [0.24, 1.18, -0.14]),
  ]);
}

function townhouseWindows() {
  const parts = [];
  for (const y of [0.5, 0.68]) {
    for (const x of [-0.2, 0.2]) {
      parts.push(box([0.17, 0.12, 0.03], '#ffffff', [x, y, 0.335]));
      parts.push(box([0.17, 0.12, 0.03], '#ffffff', [x, y, -0.335]));
    }
    parts.push(box([0.03, 0.12, 0.22], '#ffffff', [0.395, y, 0]));
    parts.push(box([0.03, 0.12, 0.22], '#ffffff', [-0.395, y, 0]));
  }
  parts.push(box([0.03, 0.12, 0.2], '#ffffff', [-0.395, 0.16, 0]));
  return merge(parts);
}

const HOMES = [null, cottage, house, townhouse];
const HOME_WINDOWS = [null, cottageWindows, houseWindows, townhouseWindows];

/* ── scenery ──────────────────────────────────────────────────────────────── */

function tree(variant) {
  const greens = [
    ['#3f9e4d', '#57b85a', '#2f8a47'],
    ['#4aa84f', '#6cc761', '#368f49'],
    ['#3a9360', '#55b074', '#2c7d54'],
    ['#5aa63f', '#7cc24f', '#458c36'],
  ][variant % 4];
  const lean = ((variant >> 2) % 5) * 0.03 - 0.06;
  return merge([
    cylinder(0.05, 0.085, 0.4, WOOD_DARK, [0, 0.2, 0], 6),
    blob(0.31, greens[0], [lean, 0.6, 0], [1, 0.92, 1]),
    blob(0.23, greens[1], [0.13 + lean, 0.84, 0.06], [1, 0.9, 1]),
    blob(0.2, greens[2], [-0.17, 0.5, 0.12], [1, 0.85, 1]),
  ]);
}

function rock(variant) {
  const turn = (variant % 7) * 0.9;
  return merge([
    lump(0.3, '#a3adb5', [0, 0.16, 0], [1.15, 0.72, 0.95], [0, turn, 0.2]),
    lump(0.17, '#8f9aa4', [0.24, 0.09, 0.15], [1, 0.75, 1], [0.4, turn * 2, 0]),
  ]);
}

function plot() {
  return merge([
    box([0.86, 0.02, 0.86], '#d1b77c', [0, 0.011, 0]),
    box([0.05, 0.16, 0.05], CREAM, [-0.4, 0.08, -0.4]),
    box([0.05, 0.16, 0.05], CREAM, [0.4, 0.08, -0.4]),
    box([0.05, 0.16, 0.05], CREAM, [0.4, 0.08, 0.4]),
    box([0.05, 0.16, 0.05], CREAM, [-0.4, 0.08, 0.4]),
  ]);
}

/** A puff of smoke, a flower, and a gull's wing: the small things. */
const puff = () => blob(0.12, '#6b6478', [0, 0, 0], [1, 0.9, 1]);
const flower = () => blob(0.05, '#ffffff', [0, 0.05, 0], [1, 0.7, 1], 0);
const wing = () => box([0.3, 0.03, 0.12], '#ffffff', [0.15, 0, 0]);

const VARIANTS = ROOFS.length * WALLS.length;
const TREE_VARIANTS = 8;
const ROCK_VARIANTS = 7;

const BUILDERS = {
  panel,
  tracker,
  trackerHead,
  turbine,
  turbineRotor,
  battery,
  bank,
  cable: pole,
  generator,
  pier,
  boat,
};
// Things too small or too flat to want an outline.
const PLAIN = { batteryLamp, plot, puff, flower, wing };

/**
 * The moving part of a model, and where it sits on it: `{ part, at }`. The
 * ghost under the cursor draws the part at rest in the same place.
 */
export const PARTS = Object.freeze({
  tracker: Object.freeze({
    part: 'trackerHead',
    at: Object.freeze([0, 0.52, 0]),
  }),
  turbine: Object.freeze({
    part: 'turbineRotor',
    at: Object.freeze([0, 1.55, 0.24]),
  }),
});

/**
 * The model shop: `get(kind, variant, tier)` hands back `{ geometry,
 * outline }`, built the first time it is asked for and shared after that.
 */
export function createModels() {
  const cache = new Map();
  const make = (key, build, outlined = true) => {
    if (!cache.has(key)) {
      const geometry = build();
      cache.set(key, {
        geometry,
        outline: outlined ? outlineGeometry(geometry) : null,
      });
    }
    return cache.get(key);
  };

  return {
    get(kind, variant = 0, tier = 1) {
      const v = Math.abs(Math.floor(variant)) || 0;
      if (BUILDERS[kind]) return make(kind, BUILDERS[kind]);
      if (PLAIN[kind]) return make(kind, PLAIN[kind], false);
      if (kind === 'house') {
        const t = HOMES[tier] ? tier : 1;
        return make(`house:${t}:${v % VARIANTS}`, () => HOMES[t](v % VARIANTS));
      }
      if (kind === 'houseWindows') {
        const t = HOME_WINDOWS[tier] ? tier : 1;
        return make(`houseWindows:${t}`, HOME_WINDOWS[t], false);
      }
      if (kind === 'tree')
        return make(`tree:${v % TREE_VARIANTS}`, () => tree(v % TREE_VARIANTS));
      if (kind === 'rock')
        return make(`rock:${v % ROCK_VARIANTS}`, () => rock(v % ROCK_VARIANTS));
      return null;
    },
    dispose() {
      for (const { geometry, outline } of cache.values()) {
        geometry.dispose();
        outline?.dispose();
      }
      cache.clear();
    },
  };
}

/**
 * Where a wire lands on each kind of thing, as a height above its tile and
 * how far from its centre the wire stops short (so a line to a home ends at
 * the wall, not in the living room).
 */
export const WIRE_ANCHOR = Object.freeze({
  cable: { y: 0.84, inset: 0 },
  panel: { y: 0.3, inset: 0 },
  tracker: { y: 0.4, inset: 0 },
  turbine: { y: 0.5, inset: 0.05 },
  battery: { y: 0.46, inset: 0.3 },
  bank: { y: 0.5, inset: 0.42 },
  generator: { y: 0.4, inset: 0.36 },
  house: { y: 0.36, inset: 0.33 },
});
