// A plate in the incubator: a recipe and the simulation state grown from it.
//
// The recipe (recipe.js) says what should have happened by which hour. This
// file makes it so: it pours, applies each event when the plate's own clock
// reaches it, and steps the simulation toward the hour the recipe asks for.
// Catching a plate up after a reload and letting one run while someone
// watches are the same thing done at different speeds.

import { clockUniforms, packPlate, packLook } from './pack.js';
import { cultureById } from './cultures.js';
import { resolveMedium } from './recipe.js';
import { applyStamps, stampsFor } from './tools.js';

/**
 * Pour a dish's medium into a simulation plate and get ready to grow it.
 * Nothing in the recipe has been applied yet; `advance` does that.
 */
export function begin(sim, plate, dish) {
  const medium = resolveMedium(dish);
  sim.pour(plate, { nutrient: medium.nutrient, ph: medium.ph || 0 }, dish.seed);
  const live = {
    plate,
    dish,
    medium,
    env: { ...dish.env }, // the incubator now: as poured, plus every change since
    slots: [], // culture ids, in the order they arrived
    cursor: 0, // the next event in dish.events to apply
    seeded: false, // whether anything has been put on the plate yet
    packed: null,
    look: null,
    refused: null,
    stale: true, // the display textures need composing again
  };
  repack(sim, live);
  return live;
}

/** Rebuild the plate's numbers: after a new culture arrives, or the
 *  incubator's settings change. */
export function repack(sim, live) {
  live.medium = resolveMedium(live.dish);
  live.packed = packPlate({
    slots: live.slots.map(cultureById),
    medium: live.medium,
    env: live.env,
    grid: sim.grid,
    seed: live.dish.seed,
  });
  live.look = packLook({ cultures: live.packed.cultures, medium: live.medium });
  live.stale = true;
}

/** Apply one event to the plate. */
function apply(sim, live, event) {
  if (event.do === 'set') {
    live.env = { ...live.env, ...event.env };
    repack(sim, live);
    return;
  }
  const before = live.slots.length;
  const { stamps, refused } = stampsFor(event, live.slots);
  if (refused) {
    live.refused = refused;
    return;
  }
  if (live.slots.length !== before) repack(sim, live);
  applyStamps(sim, live.plate, stamps);
  live.seeded = true;
  live.stale = true;
}

/** Apply every event whose hour has come. Returns true if any was. */
function applyDue(sim, live) {
  const { dish, plate } = live;
  let any = false;
  while (
    live.cursor < dish.events.length &&
    dish.events[live.cursor].at <= plate.hours + 1e-6
  ) {
    apply(sim, live, dish.events[live.cursor]);
    live.cursor += 1;
    any = true;
  }
  return any;
}

/**
 * Bring the plate toward `dish.hours`, by at most `budget` steps. Returns
 * how many it took. A plate with nothing on it has nothing to simulate: its
 * clock is simply moved on (it still dries out while it waits).
 */
export function advance(sim, live, budget) {
  const { dish, plate } = live;
  const { dt } = sim.grid;
  let steps = 0;
  applyDue(sim, live);
  while (steps < budget && plate.hours + dt * 0.5 < dish.hours) {
    if (!live.seeded) {
      // Skip to the next thing that will happen to it, or to now. The
      // clock moves in whole steps, so it is taken just past an event's
      // hour (or the event would never come due) and just short of now.
      const next =
        live.cursor < dish.events.length
          ? dish.events[live.cursor].at
          : Infinity;
      if (next > dish.hours) {
        const skipped = Math.floor((dish.hours - plate.hours) / dt + 1e-6);
        plate.steps += skipped;
        plate.hours += skipped * dt;
        break;
      }
      const skipped = Math.max(0, Math.ceil((next - plate.hours) / dt - 1e-6));
      plate.steps += skipped;
      plate.hours += skipped * dt;
      if (!applyDue(sim, live)) break;
      continue;
    }
    sim.step(plate, {
      ...live.packed.u,
      ...clockUniforms({
        softness: live.packed.softness,
        medium: live.medium,
        env: live.env,
        hours: plate.hours,
      }),
    });
    steps += 1;
    live.stale = true;
    applyDue(sim, live);
  }
  return steps;
}

/** How far behind its recipe a plate is, in hours. */
export function behind(live) {
  return Math.max(0, live.dish.hours - live.plate.hours);
}

/** The hour to write an event down at: now, rounded down, so that on a
 *  replay its hour has come by the time the plate gets to where it was. */
function now(live) {
  return Math.floor(live.plate.hours * 1000) / 1000;
}

/**
 * Something done to the plate now, by hand. It is written into the recipe
 * at the hour the plate has actually reached (which is what the hand saw),
 * and applied at once. Returns the reason if it was refused.
 */
export function act(sim, live, event) {
  const { dish } = live;
  const stamped = { ...event, at: now(live) };
  live.refused = null;
  apply(sim, live, stamped);
  if (live.refused) return live.refused;
  // Anything still waiting in the recipe for a later hour stays after it.
  dish.events.splice(live.cursor, 0, stamped);
  live.cursor += 1;
  return null;
}

/**
 * Stamp part of an event that is still being drawn: the segments of its
 * path from `fromSegment` on. Returns how many segments the path now has,
 * or the reason it was refused. Nothing is written down; `record` does
 * that when the hand lifts.
 */
export function draw(sim, live, event, fromSegment) {
  const before = live.slots.length;
  const { stamps, refused } = stampsFor(event, live.slots, fromSegment);
  if (refused) return { refused };
  if (live.slots.length !== before) repack(sim, live);
  applyStamps(sim, live.plate, stamps);
  if (stamps.length) {
    live.seeded = true;
    live.stale = true;
  }
  return { segments: fromSegment + stamps.length };
}

/**
 * Write down something that has already been done to the plate stamp by
 * stamp (a streak, drawn as the hand moves), without doing it again.
 */
export function record(live, event) {
  live.dish.events.splice(live.cursor, 0, { ...event, at: now(live) });
  live.cursor += 1;
}

/**
 * Change the incubator's settings from now on. A run of changes made
 * within the same half hour (a slider being dragged) is one entry in the
 * recipe, not fifty.
 */
export function setEnv(sim, live, patch) {
  const { dish } = live;
  const last = dish.events[live.cursor - 1];
  if (last && last.do === 'set' && live.plate.hours - last.at < 0.5) {
    last.env = { ...last.env, ...patch };
  } else if (!live.seeded && live.cursor === 0) {
    // Nothing has happened yet: this is simply how the plate was set up.
    dish.env = { ...dish.env, ...patch };
  } else {
    dish.events.splice(live.cursor, 0, {
      at: now(live),
      do: 'set',
      env: { ...patch },
    });
    live.cursor += 1;
  }
  live.env = { ...live.env, ...patch };
  repack(sim, live);
}
