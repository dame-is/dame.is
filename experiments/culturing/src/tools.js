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
//   { at, do: 'print',  cultures, map, seed }   (a velvet's print, below)
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

/**
 * How far what the hand puts down strays from a perfect shape, as a share
 * of its radius (stamp.js `uWobble`). A drop on agar spreads and soaks in a
 * little further one way than another; a line from a loop or a brush
 * thickens and thins as it goes. Paper is punched and cut, and stays true.
 */
const WOBBLE = { drop: 0.16, spill: 0.33, line: 0.25 };
/** How unevenly a drop from the tray soaks in (stamp.js `uMottle`). */
const MOTTLE = 0.5;
/** The shape every half of a mixed drop shares, so the two land as one. */
const MIXED_SHAPE = 0x2545f491;

/** A seed as a number from 0 to 1, the same every time. */
function fraction(seed) {
  return ((Math.imul(seed >>> 0, 2654435761) >>> 0) % 100000) / 100000;
}

/**
 * The seed of something put down by hand. Older records have none for
 * what came off the tray; theirs is made from where it went, so a plate
 * still grows the same each time.
 */
export function seedOf(event) {
  if (Number.isFinite(event.seed)) return event.seed >>> 0;
  const [x, y] = event.path ? event.path[0] : [event.x || 0, event.y || 0];
  return (
    (Math.imul(Math.round(x * 100), 73856093) ^
      Math.imul(Math.round(y * 100), 19349663)) >>>
    0
  );
}

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
          wobble: WOBBLE.line,
          shape: seed,
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
  // No two drops come out quite the same size or quite round; the halves
  // of a mixed drop come out as the same one.
  const shape = event.mixed ? MIXED_SHAPE : seed;
  const radius = (event.size ?? SPOT_RADIUS) * (0.94 + 0.12 * fraction(shape));
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
        wobble: WOBBLE.drop,
        shape,
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
    // drawing makes a circle of those. A drop is never quite round.
    const seed = seedOf(event);
    const shape = d.paper
      ? { from, to, radius: radius + PAPER_EDGE / 2, feather: PAPER_EDGE }
      : {
          from,
          to,
          radius: drawn ? radius : radius * (0.92 + 0.16 * fraction(seed)),
          // A liquid's edge is a meniscus: firmer than a disc's, which
          // only its own spreading softens afterwards.
          feather: radius * (drawn ? 0.45 : 0.28),
          wobble: drawn ? WOBBLE.line : WOBBLE.spill,
          mottle: MOTTLE,
          shape: seed,
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
  if (event.do === 'print') {
    // Every culture in the print needs a slot, or none of it is put down.
    const wanted = event.cultures.filter((id) => !slots.includes(id));
    if (slots.length + wanted.length > SLOTS)
      return { stamps: [], refused: FULL };
    const at = event.cultures.map((id) => slotFor(slots, id));
    return { stamps: printStamps(event, at).slice(fromSegment) };
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

/**
 * The stamps that pour a gradient (media.js GRADIENTS) into a plate that
 * has just been poured: a ramp across the dish, from nothing at its left
 * edge to `peak` at its right. A pH gradient runs from alkaline to acid
 * through the medium's own, and moves the pH the gel is buffered to with
 * it, so it keeps its gradient.
 */
export function gradientStamps(kind, peak) {
  const ramp = { from: [-DISH.radius, 0], to: [DISH.radius, 0], ramp: true };
  const all = { from: [0, 0], radius: DISH.radius * 2, feather: 0.01 };
  const p = peak[kind] ?? 0;
  if (kind === 'antibiotic') return [{ agar: { ...ramp, add0: [0, 0, p, 0] } }];
  if (kind === 'sugar') {
    return [{ agar: { ...ramp, add0: [p, 0, 0, 0], add1: [0, 0, p, 0] } }];
  }
  if (kind === 'ph') {
    const shift = (x) => ({ add1: [x, 0, 0, 0], add3: [0, x, 0, 0] });
    return [
      { agar: { ...all, ...shift(-p) } },
      { agar: { ...ramp, ...shift(2 * p) } },
    ];
  }
  return [];
}

// ---------------------------------------------------------------- velvet
//
// Replica plating: a square of velvet pressed onto a grown plate picks up a
// few cells from everything on it, and pressed onto a fresh plate puts them
// down in the same places. What it carries is written into the record as a
// map, so a printed plate is still only its recipe and can be grown again,
// or sent, without the plate it was printed from.
//
// The map is a grid of PRINT × PRINT cells over the dish, each nothing or
// one of up to four cultures, kept as runs: a letter for what is in a cell
// (a for nothing, b to e for the print's cultures in turn) and how many
// cells in a row it covers, row after row from the near edge of the dish.

/** Cells across a print. Each is a little over a millimetre: the velvet's
 *  nap, more or less, and the finest a link should have to carry. */
export const PRINT = 64;
/** The square a print covers, mm: the dish. */
const PRINT_SPAN = 2 * DISH.radius;

/** Cells as runs (see above). */
export function encodePrint(cells) {
  let out = '';
  let run = 0;
  for (let i = 0; i <= cells.length; i += 1) {
    if (i > 0 && (i === cells.length || cells[i] !== cells[i - 1])) {
      out += String.fromCharCode(97 + cells[i - 1]) + run;
      run = 0;
    }
    run += 1;
  }
  return out;
}

/** The other way: PRINT × PRINT cells, or null if it isn't a print. */
export function decodePrint(text) {
  const cells = new Uint8Array(PRINT * PRINT);
  if (typeof text !== 'string' || text.length > 4 * PRINT * PRINT) return null;
  let at = 0;
  for (const [, letter, count] of text.matchAll(/([a-e])(\d+)/g)) {
    const n = Number(count);
    if (at + n > cells.length) return null;
    cells.fill(letter.charCodeAt(0) - 97, at, at + n);
    at += n;
  }
  return at === cells.length ? cells : null;
}

/**
 * What a velvet picks up from a plate: for each cell, whichever culture has
 * the most there, if anything has much. `B` and `D` are the plate's two
 * biomass textures read back (RGBA floats, n × n, row 0 at the near edge)
 * and `slots` the culture in each channel; `span` is the mm the texture
 * covers. Returns `{ cultures, map }`, or null for a plate with nothing on
 * it.
 */
export function printOf(slots, B, D, n, span, threshold = 0.15) {
  const sums = new Float32Array(PRINT * PRINT * 4);
  const counts = new Uint16Array(PRINT * PRINT);
  for (let j = 0; j < n; j += 1) {
    const y = ((j + 0.5) / n - 0.5) * span;
    const cj = Math.floor(((y + PRINT_SPAN / 2) / PRINT_SPAN) * PRINT);
    if (cj < 0 || cj >= PRINT) continue;
    for (let i = 0; i < n; i += 1) {
      const x = ((i + 0.5) / n - 0.5) * span;
      const ci = Math.floor(((x + PRINT_SPAN / 2) / PRINT_SPAN) * PRINT);
      if (ci < 0 || ci >= PRINT) continue;
      const cell = cj * PRINT + ci;
      const k = (j * n + i) * 4;
      for (let c = 0; c < 4; c += 1) sums[cell * 4 + c] += B[k + c] + D[k + c];
      counts[cell] += 1;
    }
  }
  const cultures = [];
  const cells = new Uint8Array(PRINT * PRINT);
  for (let cell = 0; cell < cells.length; cell += 1) {
    let best = -1;
    let most = 0;
    let total = 0;
    for (let c = 0; c < 4; c += 1) {
      const v = sums[cell * 4 + c];
      total += v;
      if (v > most) {
        most = v;
        best = c;
      }
    }
    if (
      best < 0 ||
      !slots[best] ||
      total < threshold * Math.max(counts[cell], 1)
    )
      continue;
    let index = cultures.indexOf(slots[best]);
    if (index < 0) index = cultures.push(slots[best]) - 1;
    cells[cell] = index + 1;
  }
  if (!cultures.length) return null;
  return { cultures, map: encodePrint(cells) };
}

/** A print's stamps: one capsule for each run of a culture along a row,
 *  speckled, since a velvet lifts a few cells and not a colony. */
function printStamps(event, at) {
  const cells = decodePrint(event.map);
  if (!cells) return [];
  const size = PRINT_SPAN / PRINT;
  const seed = event.seed >>> 0;
  const stamps = [];
  for (let j = 0; j < PRINT; j += 1) {
    const y = -PRINT_SPAN / 2 + (j + 0.5) * size;
    let i = 0;
    while (i < PRINT) {
      const v = cells[j * PRINT + i];
      let end = i;
      while (end + 1 < PRINT && cells[j * PRINT + end + 1] === v) end += 1;
      const slot = v > 0 ? at[v - 1] : -1;
      const culture = v > 0 ? cultureById(event.cultures[v - 1]) : null;
      if (culture && slot >= 0) {
        stamps.push({
          surface: {
            from: [-PRINT_SPAN / 2 + (i + 0.5) * size, y],
            to: [-PRINT_SPAN / 2 + (end + 0.5) * size, y],
            radius: size * 0.55,
            feather: size * 0.3,
            speckle: 0.25,
            seed: seed + j * 131 + i,
            ...deposit(culture, slot, 0.6),
          },
        });
      }
      i = end + 1;
    }
  }
  return stamps;
}
