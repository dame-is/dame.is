// What a plate is poured into.
//
// Most plates are a 90 mm dish with one medium in it. A bi-plate has a
// plastic wall across the middle and a medium on each side of it, so two
// media can be read against each other on one plate. A six-well plate is six
// small round wells in a block of clear plastic, each poured on its own: six
// little plates side by side.
//
// Every vessel is worked out on the same square grid a dish is (units.js),
// so the six-well plate here is about two thirds the size of a real one,
// whose wells are 35 mm across: at full size it wouldn't fit the grid.
//
// Positions are in mm from the middle of the vessel, x to the right and y
// away from the viewer, as everywhere else.

import { DISH } from './units.js';

/** Half the width of a bi-plate's dividing wall, mm. */
export const DIVIDER = 0.8;

/** The wells of the six-well plate: three across, two deep, numbered as
 *  they are read, along the far row first. */
export const WELL_RADIUS = 12.5;
const WELL_PITCH = 28;
export const WELLS = [1, -1].flatMap((row) =>
  [-1, 0, 1].map((col) => [col * WELL_PITCH, row * WELL_PITCH * 0.5]),
);
/** The six-well plate's block of plastic: half its width and depth, mm. */
export const BLOCK = { halfW: 45.5, halfD: 31.5 };

export const VESSELS = [
  {
    id: 'dish',
    name: 'Dish',
    compartments: 1,
    hint: 'A 90 mm dish, one medium.',
  },
  {
    id: 'split',
    name: 'Bi-plate',
    compartments: 2,
    hint: 'A dish with a wall across the middle: a medium each side, and nothing crosses.',
  },
  {
    id: 'wells',
    name: 'Six wells',
    compartments: 6,
    hint: 'Six small wells in a block, each poured with its own medium.',
  },
];

const BY_ID = new Map(VESSELS.map((v) => [v.id, v]));

export function vesselById(id) {
  return BY_ID.get(id) || null;
}

/** The names of a vessel's compartments, as the page says them. */
export function compartmentNames(id) {
  if (id === 'split') return ['Left', 'Right'];
  if (id === 'wells') return ['1', '2', '3', '4', '5', '6'];
  return ['Dish'];
}

/** The well a point is nearest, and how far from its middle, mm. */
export function nearestWell(x, y) {
  let best = 0;
  let far = Infinity;
  WELLS.forEach(([cx, cy], i) => {
    const r = Math.hypot(x - cx, y - cy);
    if (r < far) {
      far = r;
      best = i;
    }
  });
  return { index: best, r: far };
}

/**
 * Which compartment a point is in, or -1 where there is no gel: outside the
 * dish, on a bi-plate's wall, or between the wells.
 */
export function compartmentAt(vessel, x, y, inset = 0) {
  if (vessel === 'wells') {
    const { index, r } = nearestWell(x, y);
    return r <= WELL_RADIUS - inset ? index : -1;
  }
  if (Math.hypot(x, y) > DISH.radius - inset) return -1;
  if (vessel === 'split') {
    if (Math.abs(x) < DIVIDER + inset) return -1;
    return x < 0 ? 0 : 1;
  }
  return 0;
}

/** A point somewhere in a compartment, clear of its edge: for things put
 *  down without a pointer. `random` is 0 to 1, as Math.random gives. */
export function somewhereIn(vessel, compartment, random = Math.random) {
  const angle = random() * Math.PI * 2;
  const spread = Math.sqrt(random());
  if (vessel === 'wells') {
    const [cx, cy] = WELLS[compartment] || WELLS[0];
    const r = spread * (WELL_RADIUS - 4);
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  }
  if (vessel === 'split') {
    // Within the half, clear of the wall and the rim.
    const side = compartment === 1 ? 1 : -1;
    for (let i = 0; i < 20; i += 1) {
      const x = side * (DIVIDER + 4 + random() * 28);
      const y = (random() * 2 - 1) * 30;
      if (Math.hypot(x, y) < DISH.radius - 6) return { x, y };
    }
    return { x: side * 18, y: 0 };
  }
  const r = spread * 28;
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/** The middle of a compartment. */
export function middleOf(vessel, compartment) {
  if (vessel === 'wells') {
    const [x, y] = WELLS[compartment] || WELLS[0];
    return { x, y };
  }
  if (vessel === 'split') return { x: compartment === 1 ? 18 : -18, y: 0 };
  return { x: 0, y: 0 };
}

/**
 * The vessel's shape as uniforms, for the passes that need to know where
 * the gel is: 0 a dish, 1 a bi-plate, 2 the six wells, and the wells.
 */
export function vesselUniforms(vessel) {
  return {
    uVessel: vessel === 'wells' ? 2 : vessel === 'split' ? 1 : 0,
    uDivider: DIVIDER,
    uWells: WELLS.flatMap(([x, y]) => [x, y, WELL_RADIUS]),
  };
}
