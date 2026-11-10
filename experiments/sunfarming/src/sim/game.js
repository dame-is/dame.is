// The game itself: an island, what stands on it, a purse, and a clock.
//
// Everything here is plain data and plain functions. Nothing touches the DOM,
// the GPU or the wall clock, so a whole week on the island can be played out
// in a test, and the picture (src/view) and the HUD (src/ui) are only ever
// readers of a `game` object that this file alone changes.
//
// The loop it models, start to finish:
//
//   sun → panels → (touching things, power lines) → houses → coins
//                        ↘ batteries ↗ (spare by day, back at night)
//
// A house that is sent power pays for it. A village that got most of what it
// asked for over a day grows by a house at dawn, and then asks for more.

import {
  BUILDABLE,
  GROW_AT,
  KINDS,
  MAX_STEP_HOURS,
  PRICE_PER_KWH,
  START_COINS,
  START_HOUR,
  START_HOUSES,
  TERRAIN,
} from './catalog.js';
import { DEFAULT_SEED, generateIsland } from './island.js';
import { findNetworks } from './network.js';
import { dayOf, sunFactor } from './sun.js';

/** Bump when a saved game from before can no longer be read. */
export const SAVE_VERSION = 1;

/**
 * The things to aim for, in order. Each pays out once, the moment it is
 * first true. `done` reads the game and nothing else.
 */
export const GOALS = Object.freeze([
  Object.freeze({
    key: 'connect',
    title: 'Wire a solar panel to the village',
    hint: 'Put a panel down, then run a power line from it to a house.',
    reward: 40,
    done: (game) =>
      networks(game).nets.some(
        (net) => net.panels.length > 0 && net.houses.length > 0,
      ),
  }),
  Object.freeze({
    key: 'lit',
    title: 'Light every house at once',
    hint: 'More panels make more power. Midday is the easy part.',
    reward: 60,
    done: (game) => game.houses > 0 && game.flow.litHouses === game.houses,
  }),
  Object.freeze({
    key: 'night',
    title: 'Power the village for a whole day and night',
    hint: 'Batteries fill up on spare sun and empty after dark.',
    reward: 120,
    done: (game) => Boolean(game.yesterday && game.yesterday.share >= 0.995),
  }),
  Object.freeze({
    key: 'six',
    title: 'Grow the village to 6 houses',
    hint: 'A family moves in each dawn the village was well powered.',
    reward: 200,
    done: (game) => game.houses >= 6,
  }),
  Object.freeze({
    key: 'twelve',
    title: 'Fill the village: all 12 houses',
    hint: 'Every new house wants power too.',
    reward: 500,
    done: (game) => game.houses >= game.plots.length && game.plots.length > 0,
  }),
]);

const emptyDay = () => ({
  demanded: 0,
  delivered: 0,
  generated: 0,
  wasted: 0,
  earned: 0,
});

const emptyFlow = () => ({
  sun: 0,
  // What the panels could make at noon, and what they are making now.
  peakKw: 0,
  generatingKw: 0,
  demandKw: 0,
  deliveredKw: 0,
  // Into the batteries when positive, out of them when negative.
  chargingKw: 0,
  wastedKw: 0,
  storedKwh: 0,
  capacityKwh: 0,
  litHouses: 0,
});

/* ── starting ─────────────────────────────────────────────────────────────── */

/** A fresh island: trees and rocks where the seed put them, a first few houses. */
export function createGame({ seed = DEFAULT_SEED } = {}) {
  const island = generateIsland(seed);
  const things = new Array(island.size * island.size).fill(null);
  for (const s of island.scenery)
    things[s.idx] = { kind: s.kind, variant: s.variant };
  const game = {
    seed: island.seed,
    size: island.size,
    terrain: island.terrain,
    plots: island.plots,
    things,
    houses: 0,
    coins: START_COINS,
    time: START_HOUR,
    today: emptyDay(),
    yesterday: null,
    totals: { delivered: 0, earned: 0 },
    flow: emptyFlow(),
    goals: {},
    // Derived, never saved: see networks().
    wiring: null,
  };
  for (let i = 0; i < START_HOUSES; i += 1) buildHouse(game);
  refresh(game);
  return game;
}

function buildHouse(game) {
  const idx = game.plots[game.houses];
  if (idx === undefined) return null;
  // The variant picks the roof; it only has to differ between neighbours.
  game.things[idx] = {
    kind: 'house',
    order: game.houses,
    variant: game.houses * 7 + game.seed,
    lit: false,
  };
  game.houses += 1;
  game.wiring = null;
  return { type: 'house', idx };
}

/** The power networks as they stand, recounted only after something changed. */
export function networks(game) {
  if (!game.wiring) {
    game.wiring = findNetworks(game.things, game.size);
    // A panel or battery that can't reach a house is doing nobody any good;
    // the view marks those so the player can see what is left to wire.
    for (const net of game.wiring.nets) {
      const live = net.houses.length > 0;
      for (const idx of net.tiles) game.things[idx].live = live;
    }
  }
  return game.wiring;
}

/* ── building ─────────────────────────────────────────────────────────────── */

const isReservedPlot = (game, idx) => game.plots.indexOf(idx) >= game.houses;

/**
 * Whether `kind` can go on tile `idx`: `{ ok: true }`, or `{ ok: false,
 * reason, message }` with a sentence the HUD can say as it is.
 */
export function canPlace(game, kind, idx) {
  const def = KINDS[kind];
  if (!def || !BUILDABLE.includes(kind))
    return { ok: false, reason: 'unknown', message: '' };
  if (!(idx >= 0 && idx < game.things.length)) {
    return { ok: false, reason: 'offmap', message: '' };
  }
  if (game.terrain[idx] === TERRAIN.WATER) {
    return { ok: false, reason: 'water', message: 'That’s the sea.' };
  }
  const thing = game.things[idx];
  if (thing) {
    if (KINDS[thing.kind]?.scenery) {
      return {
        ok: false,
        reason: 'blocked',
        message: `There’s a ${thing.kind} in the way. Clear it first.`,
      };
    }
    return {
      ok: false,
      reason: 'occupied',
      message: 'Something is already there.',
    };
  }
  if (isReservedPlot(game, idx)) {
    return {
      ok: false,
      reason: 'reserved',
      message: 'That plot is kept for the village.',
    };
  }
  if (game.coins < def.cost) {
    return {
      ok: false,
      reason: 'coins',
      message: `Not enough coins: a ${def.name.toLowerCase()} is ${def.cost}.`,
    };
  }
  return { ok: true };
}

/** Put `kind` on tile `idx` and pay for it. Returns canPlace's answer. */
export function place(game, kind, idx) {
  const can = canPlace(game, kind, idx);
  if (!can.ok) return can;
  game.coins -= KINDS[kind].cost;
  game.things[idx] = kind === 'battery' ? { kind, charge: 0 } : { kind };
  game.wiring = null;
  refresh(game);
  return { ok: true, kind, idx };
}

/**
 * What removing whatever is on `idx` would do: `{ ok, kind, coins }` where
 * `coins` is what comes back (a building) or what it costs (scenery, as a
 * negative number), or `{ ok: false, reason, message }`.
 */
export function canRemove(game, idx) {
  const thing = game.things[idx];
  if (!thing) return { ok: false, reason: 'empty', message: '' };
  const def = KINDS[thing.kind];
  if (thing.kind === 'house') {
    return { ok: false, reason: 'house', message: 'Somebody lives there.' };
  }
  if (def.scenery) {
    if (game.coins < def.clearCost) {
      return {
        ok: false,
        reason: 'coins',
        message: `Clearing a ${thing.kind} costs ${def.clearCost}.`,
      };
    }
    return { ok: true, kind: thing.kind, coins: -def.clearCost };
  }
  // A building comes back for what it cost: moving things around to try a
  // different layout should never be a reason not to.
  return { ok: true, kind: thing.kind, coins: def.cost };
}

/** Take away whatever is on `idx`. Returns canRemove's answer. */
export function remove(game, idx) {
  const can = canRemove(game, idx);
  if (!can.ok) return can;
  game.coins += can.coins;
  game.things[idx] = null;
  game.wiring = null;
  refresh(game);
  return { ...can, idx };
}

/* ── time ─────────────────────────────────────────────────────────────────── */

/**
 * Let `hours` of island time pass. Returns what happened that somebody
 * should be told about: `{ type: 'morning', … }` when a day's books close,
 * `{ type: 'house', idx }` when a family moves in, `{ type: 'goal', … }`
 * when one is reached.
 */
export function step(game, hours) {
  const events = [];
  let left = Math.max(0, Number(hours) || 0);
  while (left > 1e-9) {
    const h = Math.min(left, MAX_STEP_HOURS);
    left -= h;
    settle(game, h);
    const before = dayOf(game.time);
    game.time += h;
    if (dayOf(game.time) > before) closeDay(game, before, events);
  }
  checkGoals(game, events);
  return events;
}

/**
 * Recount the meters without letting any time pass: what the HUD shows the
 * instant something is built, before the next tick would have caught up.
 */
export function refresh(game) {
  settle(game, 0);
  return game.flow;
}

// One small step of the power system. Each network balances on its own:
// panels feed the houses first, what is spare goes into batteries, what is
// short comes back out of them, and what neither wants is wasted.
function settle(game, dt) {
  const { things } = game;
  const flow = emptyFlow();
  flow.sun = sunFactor(game.time);
  const battery = KINDS.battery;

  for (const net of networks(game).nets) {
    const made = net.panels.length * KINDS.panel.peakKw * flow.sun;
    const wanted = net.houses.length * KINDS.house.demandKw;
    const direct = Math.min(made, wanted);
    const spare = made - direct;
    const short = wanted - direct;

    let charged = 0;
    let drawn = 0;
    if (net.batteries.length && dt > 0) {
      if (spare > 1e-9) {
        // Shared out by how much room each has, so a bank fills together.
        let room = 0;
        const rooms = net.batteries.map((idx) => {
          const r = Math.max(
            0,
            Math.min(
              battery.rateKw * dt,
              battery.capacityKwh - things[idx].charge,
            ),
          );
          room += r;
          return r;
        });
        if (room > 0) {
          const f = Math.min(1, (spare * dt) / room);
          net.batteries.forEach((idx, i) => {
            things[idx].charge = Math.min(
              battery.capacityKwh,
              things[idx].charge + rooms[i] * f,
            );
          });
          charged = (room * f) / dt;
        }
      } else if (short > 1e-9) {
        let stock = 0;
        const stocks = net.batteries.map((idx) => {
          const s = Math.max(
            0,
            Math.min(battery.rateKw * dt, things[idx].charge),
          );
          stock += s;
          return s;
        });
        if (stock > 0) {
          const f = Math.min(1, (short * dt) / stock);
          net.batteries.forEach((idx, i) => {
            things[idx].charge = Math.max(
              0,
              things[idx].charge - stocks[i] * f,
            );
          });
          drawn = (stock * f) / dt;
        }
      }
    } else if (net.batteries.length && short > 1e-9) {
      // No time is passing (refresh): say what the batteries could give.
      let able = 0;
      for (const idx of net.batteries)
        if (things[idx].charge > 1e-6) able += battery.rateKw;
      drawn = Math.min(short, able);
    }

    const delivered = direct + drawn;
    const share = wanted > 0 ? delivered / wanted : 0;
    // Not enough to go round lights the oldest houses first, whole houses at
    // a time: a street half lit, not every window at half brightness.
    const lit = wanted > 0 ? Math.floor(share * net.houses.length + 1e-6) : 0;
    net.houses.forEach((idx, i) => {
      things[idx].lit = i < lit;
    });

    const wasted = Math.max(0, spare - charged);
    flow.peakKw += net.panels.length * KINDS.panel.peakKw;
    flow.generatingKw += made;
    flow.demandKw += wanted;
    flow.deliveredKw += delivered;
    flow.chargingKw += charged - drawn;
    flow.wastedKw += wasted;
    flow.litHouses += lit;
    for (const idx of net.batteries) {
      flow.storedKwh += things[idx].charge;
      flow.capacityKwh += battery.capacityKwh;
    }

    if (dt > 0) {
      const earned = delivered * dt * PRICE_PER_KWH;
      game.coins += earned;
      game.today.demanded += wanted * dt;
      game.today.delivered += delivered * dt;
      game.today.generated += made * dt;
      game.today.wasted += wasted * dt;
      game.today.earned += earned;
      game.totals.delivered += delivered * dt;
      game.totals.earned += earned;
    }
  }
  game.flow = flow;
}

// Dawn: yesterday's books close, and if the village was well enough powered a
// family moves onto the next plot.
function closeDay(game, day, events) {
  const d = game.today;
  const share = d.demanded > 0 ? Math.min(1, d.delivered / d.demanded) : 0;
  let grew = false;
  if (share >= GROW_AT && game.houses < game.plots.length) {
    const built = buildHouse(game);
    if (built) {
      grew = true;
      events.push(built);
    }
  }
  game.yesterday = { ...d, share, day, grew };
  game.today = emptyDay();
  events.push({
    type: 'morning',
    day,
    share,
    earned: d.earned,
    grew,
    houses: game.houses,
  });
  if (grew) refresh(game);
}

function checkGoals(game, events) {
  for (const goal of GOALS) {
    if (game.goals[goal.key]) continue;
    if (!goal.done(game)) continue;
    game.goals[goal.key] = true;
    game.coins += goal.reward;
    events.push({
      type: 'goal',
      key: goal.key,
      title: goal.title,
      reward: goal.reward,
    });
  }
}

/** The first goal not yet reached, or null when they all are. */
export function nextGoal(game) {
  return GOALS.find((goal) => !game.goals[goal.key]) || null;
}

/* ── reading a tile ───────────────────────────────────────────────────────── */

const kw = (n) => `${(Math.round(n * 10) / 10).toFixed(1)} kW`;

/**
 * What is on a tile, in words: `{ title, lines }` for the HUD's readout.
 * Null for a tile off the map.
 */
export function describeTile(game, idx) {
  if (!(idx >= 0 && idx < game.things.length)) return null;
  const thing = game.things[idx];
  if (!thing) {
    if (game.terrain[idx] === TERRAIN.WATER) return { title: 'Sea', lines: [] };
    if (isReservedPlot(game, idx)) {
      return {
        title: 'Village plot',
        lines: ['Kept for the next family to move in.'],
      };
    }
    return {
      title: game.terrain[idx] === TERRAIN.SAND ? 'Beach' : 'Grass',
      lines: ['Room to build.'],
    };
  }
  const def = KINDS[thing.kind];
  const lines = [];
  const unwired = thing.live === false ? 'Not wired to the village yet.' : null;
  if (thing.kind === 'panel') {
    lines.push(
      `Making ${kw(def.peakKw * game.flow.sun)} of ${kw(def.peakKw)}.`,
    );
    if (unwired) lines.push(unwired);
  } else if (thing.kind === 'battery') {
    lines.push(`Holding ${thing.charge.toFixed(1)} of ${def.capacityKwh} kWh.`);
    if (unwired) lines.push(unwired);
  } else if (thing.kind === 'cable') {
    lines.push(unwired || 'Carrying power.');
  } else if (thing.kind === 'house') {
    lines.push(thing.lit ? 'Lights on.' : 'Dark: no power is reaching it.');
    lines.push(`Wants ${kw(def.demandKw)}, day and night.`);
  } else {
    lines.push(def.blurb);
  }
  return { title: def.name, lines };
}

/* ── saving ───────────────────────────────────────────────────────────────── */

const CODES = {
  panel: 'p',
  battery: 'b',
  cable: 'c',
  house: 'h',
  tree: 't',
  rock: 'r',
};
const KIND_OF = Object.fromEntries(
  Object.entries(CODES).map(([kind, code]) => [code, kind]),
);
const round = (n, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

/** The game as plain JSON. The ground isn't in it: the seed regrows it. */
export function serialize(game) {
  const things = [];
  game.things.forEach((thing, idx) => {
    if (!thing) return;
    const entry = [idx, CODES[thing.kind]];
    if (thing.kind === 'battery') entry.push(round(thing.charge));
    else if (thing.kind === 'house') entry.push(thing.order, thing.variant);
    else if (thing.variant !== undefined) entry.push(thing.variant);
    things.push(entry);
  });
  const day = (d) =>
    d
      ? Object.fromEntries(
          Object.entries(d).map(([k, v]) => [
            k,
            typeof v === 'number' ? round(v) : v,
          ]),
        )
      : null;
  return {
    v: SAVE_VERSION,
    seed: game.seed,
    coins: round(game.coins),
    time: round(game.time, 4),
    things,
    today: day(game.today),
    yesterday: day(game.yesterday),
    totals: day(game.totals),
    goals: Object.keys(game.goals).filter((key) => game.goals[key]),
  };
}

/**
 * A game from what serialize wrote, or null for anything else: a save from
 * another version, a truncated one, one that has been edited into nonsense.
 * A null is answered with a fresh island, never with a broken one.
 */
export function deserialize(data) {
  try {
    if (!data || typeof data !== 'object' || data.v !== SAVE_VERSION)
      return null;
    const finite = (n) => typeof n === 'number' && Number.isFinite(n);
    if (!finite(data.seed) || !finite(data.coins) || !finite(data.time))
      return null;
    if (!Array.isArray(data.things)) return null;

    const island = generateIsland(data.seed);
    const things = new Array(island.size * island.size).fill(null);
    let houses = 0;
    for (const entry of data.things) {
      if (!Array.isArray(entry)) return null;
      const [idx, code, a, b] = entry;
      const kind = KIND_OF[code];
      if (!kind || !Number.isInteger(idx) || idx < 0 || idx >= things.length)
        return null;
      if (island.terrain[idx] === TERRAIN.WATER || things[idx]) return null;
      if (kind === 'battery') {
        const charge = finite(a)
          ? Math.min(KINDS.battery.capacityKwh, Math.max(0, a))
          : 0;
        things[idx] = { kind, charge };
      } else if (kind === 'house') {
        if (!Number.isInteger(a) || island.plots[a] !== idx) return null;
        things[idx] = {
          kind,
          order: a,
          variant: finite(b) ? b : a,
          lit: false,
        };
        houses += 1;
      } else if (finite(a)) {
        things[idx] = { kind, variant: a };
      } else {
        things[idx] = { kind };
      }
    }
    // Houses fill the plots in order, so a save with a gap isn't one of ours.
    for (let i = 0; i < houses; i += 1) {
      if (things[island.plots[i]]?.kind !== 'house') return null;
    }
    if (houses === 0) return null;

    const day = (d) => {
      const out = emptyDay();
      if (d && typeof d === 'object') {
        for (const key of Object.keys(out))
          if (finite(d[key])) out[key] = Math.max(0, d[key]);
      }
      return out;
    };
    const game = {
      seed: island.seed,
      size: island.size,
      terrain: island.terrain,
      plots: island.plots,
      things,
      houses,
      coins: Math.max(0, data.coins),
      time: Math.max(0, data.time),
      today: day(data.today),
      yesterday:
        data.yesterday && typeof data.yesterday === 'object'
          ? {
              ...day(data.yesterday),
              share: finite(data.yesterday.share)
                ? Math.min(1, Math.max(0, data.yesterday.share))
                : 0,
              day: finite(data.yesterday.day) ? data.yesterday.day : 0,
              grew: data.yesterday.grew === true,
            }
          : null,
      totals: {
        delivered: finite(data.totals?.delivered)
          ? Math.max(0, data.totals.delivered)
          : 0,
        earned: finite(data.totals?.earned)
          ? Math.max(0, data.totals.earned)
          : 0,
      },
      flow: emptyFlow(),
      goals: {},
      wiring: null,
    };
    const known = new Set(GOALS.map((goal) => goal.key));
    for (const key of Array.isArray(data.goals) ? data.goals : []) {
      if (known.has(key)) game.goals[key] = true;
    }
    refresh(game);
    return game;
  } catch {
    return null;
  }
}
