// From what the hand did to what the simulation is told.
//
// Everything that happens to a plate after it is poured is an event: a
// culture put on with a loop, a disc set down, a cut. An event is small and
// serialisable, because a plate is remembered as its recipe (the medium and
// the list of events) and re-grown from it. This file turns one event into
// the stamps the simulation applies.
//
//   { at, do: 'spot',   culture, x, y, size?, mixed?, seed }
//   { at, do: 'streak', culture, path: [[x, y], …], seed }
//   { at, do: 'lawn',   culture, density?, seed }
//   { at, do: 'add',    addition, x, y } or { …, path }
//
// `at` is the plate's age in hours when it happens; positions are in mm from
// the centre of the dish, x to the right and y away from the viewer.

import { SLOTS } from './pack.js';
import { DISH, hexToAbsorbance } from './units.js';
import { cultureById } from './cultures.js';
import { additionById } from './additions.js';

/** A drop from a pipette: about 3 µl spreads to this radius, mm. */
export const SPOT_RADIUS = 1.7;
/** Half the width of the line a loop draws, mm. */
export const STREAK_RADIUS = 0.75;
/** How far along a streak the loop still carries half its load, mm. */
const STREAK_HALF = 30;

const ONES = [1, 1, 1, 1];

function unit(slot, amount) {
  const v = [0, 0, 0, 0];
  v[slot] = amount;
  return v;
}

/**
 * The slot a culture holds on a plate, giving it the next free one if it is
 * new there. Returns -1 when the plate already holds four others.
 */
export function slotFor(slots, cultureId) {
  const have = slots.indexOf(cultureId);
  if (have >= 0) return have;
  if (slots.length >= SLOTS) return -1;
  slots.push(cultureId);
  return slots.length - 1;
}

/**
 * What a culture leaves where it is put down. Something that travels
 * arrives as a little of both its states; something that makes its
 * travellers itself (a swarmer with a launch window) arrives settled, and
 * so does everything that doesn't move.
 */
function deposit(culture, slot, load) {
  const travels = culture.motility > 0 && !culture.launch;
  return {
    addD: unit(slot, 0.26 * load),
    addB: travels ? unit(slot, 0.16 * load) : undefined,
  };
}

/** Stamps for an inoculation event. `slot` is from slotFor(). */
function inoculation(event, slot) {
  const culture = cultureById(event.culture);
  if (!culture || slot < 0) return [];
  const seed = event.seed >>> 0;

  if (event.do === 'lawn') {
    // A spread plate: the whole surface, a few cells here and there. Each
    // becomes a colony; enough of them become a lawn.
    return [
      {
        surface: {
          from: [0, 0],
          radius: DISH.radius,
          feather: 0.01,
          speckle: event.density ?? 0.05,
          seed,
          ...deposit(culture, slot, 1.2),
        },
      },
    ];
  }

  if (event.do === 'streak') {
    // A loop is loaded once and wiped off as it goes: a solid line to
    // begin with, single cells by the end. It is how one colony is got out
    // of a mixed culture, and here it is why a long streak ends in dots.
    const stamps = [];
    let travelled = 0;
    const path = event.path || [];
    for (let i = 1; i < path.length; i += 1) {
      const from = path[i - 1];
      const to = path[i];
      const carried = 0.5 ** (travelled / STREAK_HALF);
      stamps.push({
        surface: {
          from,
          to,
          radius: event.size ?? STREAK_RADIUS,
          feather: 0.3,
          speckle: Math.max(0.012, carried),
          seed: seed + i * 7919,
          ...deposit(culture, slot, 1),
        },
      });
      travelled += Math.hypot(to[0] - from[0], to[1] - from[1]);
    }
    return stamps;
  }

  // A spot: a drop left to dry. It dries from its edge and the flow carries
  // cells there, so more land at the rim than in the middle. A drop of a
  // mixed culture leaves each strain in about half the places, which is
  // the speckled "homeland" sectors grow out of.
  const radius = event.size ?? SPOT_RADIUS;
  return [
    {
      surface: {
        from: [event.x, event.y],
        radius,
        feather: Math.min(0.5, radius * 0.4),
        ring: 0.7,
        speckle: event.mixed ? 0.5 : 1,
        seed,
        ...deposit(culture, slot, 1),
      },
    },
  ];
}

/** Stamps for an addition, at a point or along a path. */
function addition(event) {
  const item = additionById(event.addition);
  if (!item) return [];
  const path = event.path || [[event.x, event.y]];
  const segments =
    path.length === 1
      ? [[path[0], path[0]]]
      : path.slice(1).map((p, i) => [path[i], p]);
  const radius = event.size ?? item.radius;
  const stamps = [];

  for (const [from, to] of segments) {
    if (item.cut) {
      stamps.push({
        surface: {
          from,
          to,
          radius,
          feather: 0.2,
          clearB: ONES,
          clearD: ONES,
          clearAux: ONES,
          addAux: [-1, 0, 0, 0],
        },
        agar: {
          from,
          to,
          radius: radius + 0.3,
          feather: 0.2,
          clear0: ONES,
          clear1: ONES,
          clear2: ONES,
        },
      });
      continue;
    }
    if (item.scrape) {
      stamps.push({
        surface: {
          from,
          to,
          radius,
          feather: 0.4,
          clearB: ONES,
          clearD: ONES,
          clearAux: [1, 1, 1, 0],
          addAux: [-1, 0, 0, 0],
        },
      });
      continue;
    }
    const d = item.drop || {};
    const dye = d.dye ? hexToAbsorbance(d.dye, d.strength ?? 2) : [0, 0, 0];
    stamps.push({
      agar: {
        from,
        to,
        radius,
        feather: d.paper ? 0.25 : radius * 0.5,
        add0: [
          d.nutrient || 0,
          d.surfactant || 0,
          d.toxinX || 0,
          d.signal || 0,
        ],
        add1: [d.acid || 0, 0, d.nutrient || 0, d.toxinY || 0],
        add2: [dye[0], dye[1], dye[2], d.paper || 0],
      },
    });
  }
  return stamps;
}

/** What a plate says when a fifth culture is offered to it. */
export const FULL = 'A plate holds four cultures at most.';

/**
 * The stamps for one event on a plate whose cultures are `slots` (an array
 * of culture ids, extended if the event brings a new one). Returns
 * `{ stamps, refused }`: `refused` says why nothing was done.
 *
 * An event drawn along a path gives one stamp per segment of it, in order.
 * `fromSegment` asks for only those from that segment on: a streak is
 * stamped as the hand moves, a segment at a time, and comes out exactly as
 * it will when the finished event is replayed whole.
 */
export function stampsFor(event, slots, fromSegment = 0) {
  if (event.do === 'add') {
    return { stamps: addition(event).slice(fromSegment) };
  }
  const slot = slotFor(slots, event.culture);
  if (slot < 0) return { stamps: [], refused: FULL };
  return { stamps: inoculation(event, slot).slice(fromSegment) };
}

/** Apply an event's stamps to a simulation plate. */
export function applyStamps(sim, plate, stamps) {
  for (const stamp of stamps) {
    if (stamp.surface) sim.stampSurface(plate, stamp.surface);
    if (stamp.agar) sim.stampAgar(plate, stamp.agar);
  }
}
