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
/**
 * The drops the hand can leave, by how far each spreads before it dries.
 * The size of the drop is the size of the colony's middle: everything in it
 * arrives at once, so it keeps a character of its own (a disc, a ring where
 * the drop dried, a maze) while the growth round it is drawn out into
 * spokes. Colony biofilms are photographed from a few microlitres spotted
 * and left for days, and it is the big drop that gives them their core.
 */
export const DROPS = [
  {
    value: 'touch',
    label: 'Touch',
    radius: SPOT_RADIUS,
    hint: 'A touch of the loop: a colony from a point.',
  },
  {
    value: 'drop',
    label: 'Drop',
    radius: 3.5,
    hint: 'A drop from a pipette, a few millimetres across.',
  },
  {
    value: 'pool',
    label: 'Pool',
    radius: 6,
    hint: 'A big drop left to dry: the colony keeps it as a core.',
  },
];
export const DEFAULT_DROP = 'drop';

/** A drop's radius by name, mm; the loop's touch for a name it doesn't know. */
export function dropRadius(value) {
  const drop = DROPS.find((d) => d.value === value);
  return drop ? drop.radius : SPOT_RADIUS;
}

/** How long a drop stays wet enough for another to run into it, hours. */
export const WET_HOURS = 1;
/** Half the width of the line a loop draws, mm. */
export const STREAK_RADIUS = 0.75;
/** The share of the surface a spread plate's cells land on: all of it,
 *  which is a lawn. */
export const LAWN_DENSITY = 1;
/** How wide the soft edge of a paper disc is where it is put down, mm. */
const PAPER_EDGE = 1.4;
/** How big the patches are that a mixed drop's strains settle out in, mm. */
export const CLUMP = 1.1;
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
    // A spread plate. `density` is the share of the surface a cell lands
    // on. Spread over all of it, it comes up as a lawn, even and all at
    // once; spread thinly each cell becomes a colony of its own, and the
    // same amount of culture goes onto fewer places.
    const density = event.density ?? LAWN_DENSITY;
    return [
      {
        surface: {
          from: [0, 0],
          radius: DISH.radius,
          feather: 0.01,
          speckle: density,
          seed,
          ...deposit(culture, slot, Math.min(1.2, 0.2 / density)),
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
  // mixed culture leaves each strain in about half the places, in patches:
  // the "homeland" sectors grow out of.
  const radius = event.size ?? SPOT_RADIUS;
  return [
    {
      surface: {
        from: [event.x, event.y],
        radius,
        feather: Math.min(0.5, radius * 0.4),
        ring: 0.7,
        speckle: event.mixed ? 0.5 : 1,
        clump: event.mixed ? CLUMP : 0,
        seed,
        ...deposit(culture, slot, 1),
      },
    },
  ];
}

/** How much of a thing is put down per segment of a line drawn with it:
 *  enough that the line comes out as strong as one drop of it, though each
 *  point of it is passed over by several segments. */
function perSegment(length, radius) {
  return length / (length + 2 * radius);
}

const scaled = (v, k) => v.map((x) => x * k);
const any = (v) => v.some((x) => x !== 0);

/**
 * Where a strip lies: from its strong end to its weak one. Laid by hand, it
 * is the two ends the record holds; set down at a point, it lies along the
 * radius through that point, its strong end toward the middle, moved in as
 * far as it has to be to lie wholly on the gel.
 */
export function stripEnds(event, length) {
  if (event.path && event.path.length > 1) return event.path.slice(0, 2);
  const r = Math.hypot(event.x, event.y);
  const u = r > 3 ? [event.x / r, event.y / r] : [1, 0];
  const middle = Math.min(r, DISH.radius - 2 - length / 2);
  return [
    [u[0] * (middle - length / 2), u[1] * (middle - length / 2)],
    [u[0] * (middle + length / 2), u[1] * (middle + length / 2)],
  ];
}

/** A strip's two stamps: its drug falling off along it, and its paper. */
function strip(item, event) {
  const [from, to] = stripEnds(event, item.strip.length);
  const d = item.drop;
  const shape = {
    from,
    to,
    radius: item.radius + PAPER_EDGE / 2,
    feather: PAPER_EDGE,
  };
  return [
    {
      agar: {
        ...shape,
        taper: -item.strip.halvings * Math.LN2,
        add0: [0, 0, d.toxinX || 0, 0],
        add1: [0, 0, 0, d.toxinY || 0],
      },
    },
    { agar: { ...shape, add2: [0, 0, 0, 1] } },
  ];
}

/** Stamps for an addition, at a point or along a path. */
function addition(event) {
  const item = additionById(event.addition);
  if (!item) return [];
  if (item.strip) return strip(item, event);
  const path = event.path || [[event.x, event.y]];
  const drawn = path.length > 1;
  const segments = drawn
    ? path.slice(1).map((p, i) => [path[i], p])
    : [[path[0], path[0]]];
  // Drawn, a drop is a line as wide as the brush it is drawn with.
  const radius =
    event.size ?? (drawn ? (item.line ?? item.radius) : item.radius);
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
        reagents: {
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
        // What the cells had taken up goes with them.
        reagents: {
          from,
          to,
          radius,
          feather: 0.4,
          clear0: [0, 0, 1, 0],
          clear2: ONES,
        },
      });
      continue;
    }
    const d = item.drop || {};
    const dye = d.dye ? hexToAbsorbance(d.dye, d.strength ?? 2) : [0, 0, 0];
    const k = drawn
      ? perSegment(Math.hypot(to[0] - from[0], to[1] - from[1]), radius)
      : 1;
    // A disc's edge is laid down soft, over more than one texel of the
    // agar, and still half way down at the disc's own radius. Laid down
    // hard it is a handful of squares, and no amount of care in the
    // drawing makes a circle of those.
    const shape = {
      from,
      to,
      radius: d.paper ? radius + PAPER_EDGE / 2 : radius,
      feather: d.paper ? PAPER_EDGE : radius * 0.5,
    };
    const stamp = {};
    const add0 = scaled(
      [d.nutrient || 0, d.surfactant || 0, d.toxinX || 0, d.signal || 0],
      k,
    );
    const add1 = scaled([d.acid || 0, 0, d.nutrient || 0, d.toxinY || 0], k);
    // The paper is there or it isn't, however many segments cross it.
    const add2 = [0, 0, 0, d.paper || 0];
    if (any(add0) || any(add1) || any(add2)) {
      stamp.agar = { ...shape, add0, add1, add2 };
    }
    const r0 = scaled([d.indicator || 0, d.ttc || 0, 0, d.calcofluor || 0], k);
    const r1 = scaled([...dye, d.fluorescein || 0], k);
    if (any(r0) || any(r1)) {
      stamp.reagents = { ...shape, add0: r0, add1: r1 };
    }
    stamps.push(stamp);
  }
  return stamps;
}

/**
 * The drops on a plate that a new one would run into: another culture's,
 * put down within the hour, with one of the two centres well inside the
 * other drop. Returns their indexes in `events`.
 *
 * Two drops that meet while both are wet are one drop of a mixed culture:
 * each strain lands in about half the places, and what grows out of it is
 * the two sharing a middle and contesting an edge. (A drop put onto a
 * colony that has already dried and grown is only a drop on a colony.)
 */
export function wetDropsUnder(events, event) {
  const found = [];
  if (event.do !== 'spot') return found;
  const radius = event.size ?? SPOT_RADIUS;
  events.forEach((other, index) => {
    if (other.do !== 'spot' || other.culture === event.culture) return;
    if (Math.abs((event.at ?? 0) - other.at) > WET_HOURS) return;
    const reach = 0.5 * Math.max(radius, other.size ?? SPOT_RADIUS);
    if (Math.hypot(event.x - other.x, event.y - other.y) <= reach) {
      found.push(index);
    }
  });
  return found;
}

/**
 * A record with the mixed drops that have nothing left to be mixed with put
 * back as drops. Taking back one half of a mixed drop leaves the other
 * written down as half a drop; this is what makes it whole again.
 */
export function unmixed(events) {
  return events.map((event, index) => {
    if (!event.mixed || event.do !== 'spot') return event;
    const partnered = events.some(
      (other, at) =>
        at !== index && other.mixed && wetDropsUnder([other], event).length > 0,
    );
    if (partnered) return event;
    const whole = { ...event };
    delete whole.mixed;
    return whole;
  });
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
    if (stamp.reagents) sim.stampReagents(plate, stamp.reagents);
  }
}
