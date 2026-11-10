// What everything looks like. Each model is one merged, vertex-coloured
// geometry (plus a welded copy for its outline), built once and shared by
// every instance on the island. A tile is 1 unit square and models stand on
// y = 0 at its centre, facing south (+z), which is where the sun spends the
// day.

import { box, blob, cylinder, lump, merge, roof } from './shapes.js';
import { outlineGeometry } from './toon.js';

/** How far the solar panels lean toward the sun's side of the sky. */
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

function panel() {
  const tilt = [PANEL_TILT, 0, 0];
  const lift = 0.36;
  const parts = [
    box([0.3, 0.05, 0.3], '#8d95a3', [0, 0.025, 0]),
    box([0.08, 0.34, 0.08], '#aab2bf', [0, 0.17, 0]),
    // The frame, then six cells standing a hair proud of it.
    box([0.9, 0.05, 0.64], '#eef2f7', [0, lift, 0], tilt),
  ];
  const cos = Math.cos(PANEL_TILT);
  const sin = Math.sin(PANEL_TILT);
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const x = (col - 1) * 0.285;
      const along = (row - 0.5) * 0.295;
      // A point `along` the slab's depth and 0.03 above it, tilted with it.
      const y = lift + 0.03 * cos - along * sin;
      const z = 0.03 * sin + along * cos;
      const shade = (row + col) % 2 ? '#2f66c4' : '#2a59b0';
      parts.push(box([0.255, 0.02, 0.265], shade, [x, y, z], tilt));
    }
  }
  return merge(parts);
}

function battery() {
  return merge([
    box([0.74, 0.07, 0.56], '#8d95a3', [0, 0.035, 0]),
    box([0.64, 0.4, 0.46], '#fbf3df', [0, 0.27, 0]),
    box([0.66, 0.09, 0.48], '#35b8a6', [0, 0.2, 0]),
    box([0.66, 0.05, 0.48], '#2a3b45', [0, 0.495, 0]),
    cylinder(0.045, 0.045, 0.09, '#f25f4c', [-0.24, 0.56, -0.14], 8),
    cylinder(0.045, 0.045, 0.09, '#4a5568', [0.24, 0.56, -0.14], 8),
  ]);
}

/** One of the four lamps on a battery's lid; four of them make its gauge. */
function batteryLamp() {
  return box([0.1, 0.03, 0.2], '#ffffff', [0, 0, 0]);
}

function pole() {
  return merge([
    box([0.2, 0.05, 0.2], '#8a5a2e', [0, 0.025, 0]),
    box([0.085, 0.8, 0.085], '#b47a42', [0, 0.4, 0]),
    box([0.2, 0.07, 0.2], '#5b4a6b', [0, 0.8, 0]),
    box([0.09, 0.07, 0.09], '#fbf3df', [0, 0.87, 0]),
  ]);
}

function house(variant) {
  const wall = WALLS[variant % WALLS.length];
  const top = ROOFS[variant % ROOFS.length];
  return merge([
    box([0.66, 0.4, 0.58], wall, [0, 0.2, 0]),
    roof(0.8, 0.74, 0.34, top, [0, 0.4, 0]),
    // The gables under the roof, in the wall's colour.
    box([0.05, 0.16, 0.3], wall, [-0.305, 0.44, 0]),
    box([0.05, 0.16, 0.3], wall, [0.305, 0.44, 0]),
    box([0.16, 0.24, 0.03], '#8a5a2e', [-0.14, 0.12, 0.3]),
    box([0.1, 0.22, 0.1], '#c9c2b8', [0.2, 0.66, -0.12]),
    box([0.13, 0.04, 0.13], '#8d8478', [0.2, 0.78, -0.12]),
  ]);
}

/** A house's windows, apart from it so they can be lit and unlit. */
function houseWindows() {
  return merge([
    box([0.17, 0.15, 0.03], '#ffffff', [0.14, 0.22, 0.295]),
    box([0.15, 0.14, 0.03], '#ffffff', [-0.14, 0.22, -0.295]),
    box([0.15, 0.14, 0.03], '#ffffff', [0.14, 0.22, -0.295]),
    box([0.03, 0.14, 0.17], '#ffffff', [0.335, 0.22, 0.05]),
    box([0.03, 0.14, 0.17], '#ffffff', [-0.335, 0.22, 0.05]),
  ]);
}

function tree(variant) {
  const greens = [
    ['#3f9e4d', '#57b85a', '#2f8a47'],
    ['#4aa84f', '#6cc761', '#368f49'],
    ['#3a9360', '#55b074', '#2c7d54'],
    ['#5aa63f', '#7cc24f', '#458c36'],
  ][variant % 4];
  const lean = ((variant >> 2) % 5) * 0.03 - 0.06;
  return merge([
    cylinder(0.05, 0.085, 0.4, '#8a5a2e', [0, 0.2, 0], 6),
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
  const peg = '#fbf3df';
  return merge([
    box([0.86, 0.02, 0.86], '#d1b77c', [0, 0.011, 0]),
    box([0.05, 0.16, 0.05], peg, [-0.4, 0.08, -0.4]),
    box([0.05, 0.16, 0.05], peg, [0.4, 0.08, -0.4]),
    box([0.05, 0.16, 0.05], peg, [0.4, 0.08, 0.4]),
    box([0.05, 0.16, 0.05], peg, [-0.4, 0.08, 0.4]),
  ]);
}

const HOUSE_VARIANTS = ROOFS.length * WALLS.length;
const TREE_VARIANTS = 8;
const ROCK_VARIANTS = 7;

/**
 * The model shop: `get(kind, variant)` hands back `{ geometry, outline }`,
 * built the first time it is asked for and shared after that.
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
    get(kind, variant = 0) {
      const v = Math.abs(Math.floor(variant)) || 0;
      switch (kind) {
        case 'panel':
          return make('panel', panel);
        case 'battery':
          return make('battery', battery);
        case 'batteryLamp':
          return make('batteryLamp', batteryLamp, false);
        case 'cable':
          return make('cable', pole);
        case 'house':
          return make(`house:${v % HOUSE_VARIANTS}`, () =>
            house(v % HOUSE_VARIANTS),
          );
        case 'houseWindows':
          return make('houseWindows', houseWindows, false);
        case 'tree':
          return make(`tree:${v % TREE_VARIANTS}`, () =>
            tree(v % TREE_VARIANTS),
          );
        case 'rock':
          return make(`rock:${v % ROCK_VARIANTS}`, () =>
            rock(v % ROCK_VARIANTS),
          );
        case 'plot':
          return make('plot', plot, false);
        default:
          return null;
      }
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
 * how far from its centre the wire stops short (so a line to a house ends at
 * the wall, not in the living room).
 */
export const WIRE_ANCHOR = Object.freeze({
  cable: { y: 0.84, inset: 0 },
  panel: { y: 0.3, inset: 0 },
  battery: { y: 0.46, inset: 0.3 },
  house: { y: 0.36, inset: 0.3 },
});
