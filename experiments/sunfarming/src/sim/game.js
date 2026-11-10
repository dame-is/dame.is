// The game itself: an island, what stands on it, a purse, and a clock.
//
// Everything here is plain data and plain functions. Nothing touches the DOM,
// the GPU or the wall clock, so a whole season on the island can be played
// out in a test, and the picture (src/view) and the HUD (src/ui) are only
// ever readers of a `game` object that this file alone changes.
//
// The island starts on diesel. A generator at the water's edge keeps the
// village lit from the first minute, and burns fuel for every kilowatt-hour.
// What the player builds takes its place, an hour at a time:
//
//   sun, wind → panels, turbines ─┬→ homes → coins
//                  batteries ←────┤     ↑
//                  generator ─────┴─────┘   (only for what is still short)
//
// A village that got most of what it asked for grows at dawn: a family moves
// onto the next plot, and a home that has had a run of good days moves up a
// tier, wanting more power and at a harder time of day.

import {
  BUILDABLE,
  FUEL_PER_KWH,
  GROW_AT,
  HOUSES_FOR_TIER_2,
  INLAND_WIND,
  KINDS,
  LOCKED,
  MAX_STEP_HOURS,
  SHADE_FACTOR,
  START_HOUR,
  START_HOUSES,
  TERRAIN,
  TIERS,
  loadAt,
} from './catalog.js';
import { generateIsland } from './island.js';
import { ISLANDS, specById } from './islands.js';
import { findNetworks } from './network.js';
import { shadeNow } from './shade.js';
import { dayOf, hourOf, seasonAt, sunFactor, trackingFactor } from './sun.js';
import { skyAt, windAt } from './weather.js';

/** Bump when a saved game from before can no longer be read. */
export const SAVE_VERSION = 2;

const fedBySun = (game) =>
  networks(game).nets.some(
    (net) => net.panels.length > 0 && net.houses.length > 0,
  );
const quietDay = (game) =>
  Boolean(
    game.yesterday &&
    game.yesterday.demanded > 0 &&
    game.yesterday.diesel < 0.01 &&
    game.yesterday.share >= GROW_AT,
  );

/**
 * The things to aim for, in order. Each pays out once, the moment it is
 * first true. `done` reads the game and nothing else. The last is the
 * island finished: it is what opens the next one.
 */
export const GOALS = Object.freeze([
  Object.freeze({
    key: 'tap',
    title: 'Wire a solar panel into the village',
    hint: 'Put a panel against the old power line, or run a line of your own to it.',
    reward: 40,
    done: fedBySun,
  }),
  Object.freeze({
    key: 'half',
    title: 'Half a day’s power from sun and wind',
    hint: 'Every kilowatt-hour the sun makes is one the generator doesn’t burn.',
    reward: 80,
    done: (game) => Boolean(game.yesterday && game.yesterday.clean >= 0.5),
  }),
  Object.freeze({
    key: 'quiet',
    title: 'A whole day without the generator',
    hint: 'Batteries carry the day into the night. The evening is the hard part.',
    reward: 200,
    done: quietDay,
  }),
  Object.freeze({
    key: 'full',
    title: 'A home on every plot',
    hint: 'A family moves in each dawn the village was well powered.',
    reward: 150,
    done: (game) => game.plots.length > 0 && game.houses >= game.plots.length,
  }),
  Object.freeze({
    key: 'done',
    title: 'The island runs on the sun',
    hint: 'Every home as far up as it can go, and a whole day with the generator silent.',
    reward: 400,
    done: (game) => villageComplete(game) && quietDay(game),
  }),
]);

const emptyDay = () => ({
  demanded: 0,
  delivered: 0,
  // Of what was delivered: from sun, wind and batteries; and from diesel.
  clean: 0,
  diesel: 0,
  wasted: 0,
  earned: 0,
  fuel: 0,
});

const emptyFlow = () => ({
  // The light a fixed panel is getting, 0 to 1, after the weather.
  sun: 0,
  // How hard the wind is blowing, 0 to 1.
  wind: 0,
  sky: 'clear',
  // What the panels could make at noon under a clear sky.
  peakKw: 0,
  solarKw: 0,
  windKw: 0,
  dieselKw: 0,
  demandKw: 0,
  deliveredKw: 0,
  // Into the batteries when positive, out of them when negative.
  chargingKw: 0,
  wastedKw: 0,
  storedKwh: 0,
  capacityKwh: 0,
  litHouses: 0,
  shadedPanels: 0,
});

/* ── starting ─────────────────────────────────────────────────────────────── */

/**
 * A fresh island: trees and rocks where the seed put them, a first few
 * cottages, and the generator on the beach with its line up to them.
 * `unlocked` is what has been earned on other islands and comes along.
 */
export function createGame({ spec = ISLANDS[0], unlocked = [] } = {}) {
  const island = generateIsland(spec);
  const things = new Array(island.size * island.size).fill(null);
  for (const s of island.scenery)
    things[s.idx] = { kind: s.kind, variant: s.variant };
  if (island.generator >= 0) {
    things[island.generator] = { kind: 'generator' };
    for (const idx of island.line) things[idx] = { kind: 'cable', old: true };
  }
  const game = base(spec, island, things);
  game.coins = spec.coins;
  game.unlocked = spec.free
    ? [...LOCKED]
    : LOCKED.filter((kind) => unlocked.includes(kind));
  for (let i = 0; i < START_HOUSES; i += 1) buildHouse(game);
  refresh(game);
  return game;
}

// The parts of a game that come from its island, whether new or loaded.
function base(spec, island, things) {
  return {
    spec,
    size: island.size,
    terrain: island.terrain,
    plots: island.plots,
    pier: island.pier,
    things,
    houses: 0,
    coins: 0,
    time: START_HOUR,
    today: emptyDay(),
    yesterday: null,
    totals: { delivered: 0, clean: 0, diesel: 0, earned: 0, fuel: 0 },
    flow: emptyFlow(),
    goals: {},
    unlocked: [],
    // `{ day }` once the island is finished.
    done: null,
    // Derived, never saved: see networks() and shade.js.
    wiring: null,
    light: null,
  };
}

function changed(game) {
  game.wiring = null;
  game.light = null;
}

function buildHouse(game) {
  const idx = game.plots[game.houses];
  if (idx === undefined) return null;
  // The variant picks the roof; it only has to differ between neighbours.
  game.things[idx] = {
    kind: 'house',
    order: game.houses,
    variant: game.houses * 7 + game.spec.seed,
    tier: 1,
    good: 0,
    lit: false,
  };
  game.houses += 1;
  changed(game);
  return { type: 'house', idx };
}

/** The power networks as they stand, recounted only after something changed. */
export function networks(game) {
  if (!game.wiring) {
    game.wiring = findNetworks(game.things, game.size);
    // A panel or battery that can't reach a home is doing nobody any good;
    // the view marks those so the player can see what is left to wire.
    for (const net of game.wiring.nets) {
      const live = net.houses.length > 0;
      for (const idx of net.tiles) game.things[idx].live = live;
    }
  }
  return game.wiring;
}

/** The generator's tile, or -1 once it has been sent away. */
export function generatorTile(game) {
  return game.things.findIndex((thing) => thing?.kind === 'generator');
}

/* ── building ─────────────────────────────────────────────────────────────── */

const isReservedPlot = (game, idx) => game.plots.indexOf(idx) >= game.houses;

/** What a building costs here: nothing at all in free build. */
export function costOf(game, kind) {
  return game.spec.free ? 0 : KINDS[kind].cost;
}

export function isUnlocked(game, kind) {
  return !LOCKED.includes(kind) || game.unlocked.includes(kind);
}

/**
 * Whether `kind` can go on tile `idx`: `{ ok: true }`, or `{ ok: false,
 * reason, message }` with a sentence the HUD can say as it is.
 */
export function canPlace(game, kind, idx) {
  const def = KINDS[kind];
  if (!def || !BUILDABLE.includes(kind))
    return { ok: false, reason: 'unknown', message: '' };
  if (!isUnlocked(game, kind)) {
    return {
      ok: false,
      reason: 'locked',
      message: `Not yet: ${def.unlock.toLowerCase()}.`,
    };
  }
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
  if (game.coins < costOf(game, kind)) {
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
  game.coins -= costOf(game, kind);
  game.things[idx] = KINDS[kind].stores ? { kind, charge: 0 } : { kind };
  changed(game);
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
  if (thing.kind === 'generator') {
    if (!game.goals.quiet && !game.spec.free) {
      return {
        ok: false,
        reason: 'needed',
        message:
          'The village still leans on it. Go a whole day without it first.',
      };
    }
    return {
      ok: true,
      kind: thing.kind,
      coins: game.spec.free ? 0 : def.scrap,
    };
  }
  if (def.scenery) {
    const cost = game.spec.free ? 0 : def.clearCost;
    if (game.coins < cost) {
      return {
        ok: false,
        reason: 'coins',
        message: `Clearing a ${thing.kind} costs ${def.clearCost}.`,
      };
    }
    return { ok: true, kind: thing.kind, coins: -cost };
  }
  // A building comes back for what it cost: moving things around to try a
  // different layout should never be a reason not to. (The island's old
  // line was never paid for.)
  return {
    ok: true,
    kind: thing.kind,
    coins: thing.old ? 0 : costOf(game, thing.kind),
  };
}

/** Take away whatever is on `idx`. Returns canRemove's answer. */
export function remove(game, idx) {
  const can = canRemove(game, idx);
  if (!can.ok) return can;
  game.coins += can.coins;
  game.things[idx] = null;
  changed(game);
  refresh(game);
  return { ...can, idx };
}

/* ── time ─────────────────────────────────────────────────────────────────── */

/**
 * Let `hours` of island time pass. Returns what happened that somebody
 * should be told about, as `{ type, … }`:
 *
 *   morning   a day's books closed (how it went, and what changed)
 *   house     a family moved onto a plot
 *   upgrade   a home moved up a tier
 *   unlock    a new kind of building can be built from now on
 *   goal      a goal was reached
 *   done      the island is finished
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
  checkUnlocks(game, events);
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

/** How much of its rating a turbine makes in a wind of this strength. */
export function turbineFactor(wind) {
  return Math.min(1, Math.max(0, (wind - 0.1) / 0.65));
}

// One small step of the power system. Each network balances on its own:
// sun and wind feed the homes first, what is spare goes into batteries, what
// is short comes back out of them, the generator makes up what is still
// missing if it is on that network, and what nobody wants is wasted.
function settle(game, dt) {
  const { things, spec, terrain } = game;
  const season = seasonAt(spec, game.time);
  const sky = skyAt(spec, game.time);
  const hour = hourOf(game.time);
  const fixed = sunFactor(game.time, season) * sky.sun;
  const tracking = trackingFactor(game.time, season) * sky.sun;
  const wind = windAt(spec, game.time);
  const shaded = fixed > 0 ? shadeNow(game, season) : null;

  const flow = emptyFlow();
  flow.sun = fixed;
  flow.wind = wind;
  flow.sky = sky.key;

  for (const net of networks(game).nets) {
    let solar = 0;
    for (const idx of net.panels) {
      const thing = things[idx];
      const def = KINDS[thing.kind];
      thing.shaded = Boolean(shaded && shaded[idx]);
      if (thing.shaded) flow.shadedPanels += 1;
      const light = thing.kind === 'tracker' ? tracking : fixed;
      solar += def.peakKw * light * (thing.shaded ? SHADE_FACTOR : 1);
      flow.peakKw += def.peakKw;
    }
    let blown = 0;
    for (const idx of net.turbines) {
      const site = terrain[idx] === TERRAIN.SAND ? 1 : INLAND_WIND;
      blown += KINDS.turbine.peakKw * turbineFactor(wind) * site;
    }

    let wanted = 0;
    let worth = 0;
    for (const idx of net.houses) {
      const load = loadAt(things[idx].tier, hour);
      wanted += load;
      worth += load * TIERS[things[idx].tier].pays;
    }
    const price = wanted > 0 ? worth / wanted : 0;

    const made = solar + blown;
    const direct = Math.min(made, wanted);
    const spare = made - direct;
    let short = wanted - direct;

    let charged = 0;
    let drawn = 0;
    if (net.stores.length && dt > 0) {
      if (spare > 1e-9) {
        // Shared out by how much room each has, so a bank fills together.
        let room = 0;
        const rooms = net.stores.map((idx) => {
          const def = KINDS[things[idx].kind];
          const r = Math.max(
            0,
            Math.min(def.rateKw * dt, def.capacityKwh - things[idx].charge),
          );
          room += r;
          return r;
        });
        if (room > 0) {
          const f = Math.min(1, (spare * dt) / room);
          net.stores.forEach((idx, i) => {
            const cap = KINDS[things[idx].kind].capacityKwh;
            things[idx].charge = Math.min(
              cap,
              things[idx].charge + rooms[i] * f,
            );
          });
          charged = (room * f) / dt;
        }
      } else if (short > 1e-9) {
        let stock = 0;
        const stocks = net.stores.map((idx) => {
          const def = KINDS[things[idx].kind];
          const s = Math.max(0, Math.min(def.rateKw * dt, things[idx].charge));
          stock += s;
          return s;
        });
        if (stock > 0) {
          const f = Math.min(1, (short * dt) / stock);
          net.stores.forEach((idx, i) => {
            things[idx].charge = Math.max(
              0,
              things[idx].charge - stocks[i] * f,
            );
          });
          drawn = (stock * f) / dt;
        }
      }
    } else if (net.stores.length && short > 1e-9) {
      // No time is passing (refresh): say what the batteries could give.
      let able = 0;
      for (const idx of net.stores) {
        if (things[idx].charge > 1e-6) able += KINDS[things[idx].kind].rateKw;
      }
      drawn = Math.min(short, able);
    }
    short -= drawn;

    const diesel =
      short > 1e-9
        ? Math.min(short, spec.generatorKw * net.generators.length)
        : 0;
    for (const idx of net.generators) things[idx].running = diesel > 1e-3;

    const clean = direct + drawn;
    const delivered = clean + diesel;
    const share = wanted > 0 ? delivered / wanted : 0;
    // Not enough to go round lights the oldest homes first, whole homes at
    // a time: a street half lit, not every window at half brightness.
    const lit = wanted > 0 ? Math.floor(share * net.houses.length + 1e-6) : 0;
    net.houses.forEach((idx, i) => {
      things[idx].lit = i < lit;
    });

    const wasted = Math.max(0, spare - charged);
    flow.solarKw += solar;
    flow.windKw += blown;
    flow.dieselKw += diesel;
    flow.demandKw += wanted;
    flow.deliveredKw += delivered;
    flow.chargingKw += charged - drawn;
    flow.wastedKw += wasted;
    flow.litHouses += lit;
    for (const idx of net.stores) {
      flow.storedKwh += things[idx].charge;
      flow.capacityKwh += KINDS[things[idx].kind].capacityKwh;
    }

    if (dt > 0) {
      const earned = delivered * dt * price;
      const fuel = diesel * dt * FUEL_PER_KWH;
      game.coins += earned - fuel;
      game.today.demanded += wanted * dt;
      game.today.delivered += delivered * dt;
      game.today.clean += clean * dt;
      game.today.diesel += diesel * dt;
      game.today.wasted += wasted * dt;
      game.today.earned += earned;
      game.today.fuel += fuel;
      game.totals.delivered += delivered * dt;
      game.totals.clean += clean * dt;
      game.totals.diesel += diesel * dt;
      game.totals.earned += earned;
      game.totals.fuel += fuel;
    }
  }
  game.flow = flow;
}

/** No more than this many homes move up a tier at one dawn. */
export const UPGRADES_PER_DAWN = 2;

/**
 * What the next dawn will bring if today goes well: `{ moves, upgrades }`,
 * where `moves` says a family will take the next plot and `upgrades` lists
 * the homes (`{ idx, tier }`) that will move up. It is the same reckoning
 * closeDay does, so the HUD can promise it.
 *
 * A home moves up once it has had enough good days in the tier it is in.
 * The first cottages wait until the village has five homes; nobody becomes a
 * townhouse until every plot is built.
 */
export function dawnPlan(game) {
  const moves = game.houses < game.plots.length;
  // Counting the family about to move in, as closeDay will.
  const houses = game.houses + (moves ? 1 : 0);
  const upgrades = [];
  for (
    let i = 0;
    i < game.houses && upgrades.length < UPGRADES_PER_DAWN;
    i += 1
  ) {
    const idx = game.plots[i];
    const home = game.things[idx];
    if (!home || home.tier >= game.spec.maxTier) continue;
    if (home.good + 1 < TIERS[home.tier + 1].after) continue;
    if (
      home.tier === 1 &&
      houses < Math.min(HOUSES_FOR_TIER_2, game.plots.length)
    )
      continue;
    if (home.tier === 2 && houses < game.plots.length) continue;
    upgrades.push({ idx, tier: home.tier + 1 });
  }
  return { moves, upgrades };
}

/** Whether every plot is built and every home is as far up as it can go here. */
export function villageComplete(game) {
  if (!game.plots.length || game.houses < game.plots.length) return false;
  return game.plots.every((idx) => game.things[idx]?.tier >= game.spec.maxTier);
}

// Daybreak: yesterday's books close. After a well powered day a family moves
// onto the next plot, and homes that have had enough good days move up a
// tier.
function closeDay(game, day, events) {
  const d = game.today;
  const share = d.demanded > 0 ? Math.min(1, d.delivered / d.demanded) : 0;
  const clean = d.delivered > 0 ? Math.min(1, d.clean / d.delivered) : 0;
  let moved = false;
  let upgraded = 0;
  if (share >= GROW_AT) {
    const plan = dawnPlan(game);
    for (let i = 0; i < game.houses; i += 1)
      game.things[game.plots[i]].good += 1;
    if (plan.moves) {
      const built = buildHouse(game);
      if (built) {
        moved = true;
        events.push(built);
      }
    }
    for (const { idx, tier } of plan.upgrades) {
      // A new object, not a changed one: the picture redraws what is replaced.
      game.things[idx] = { ...game.things[idx], tier, good: 0 };
      changed(game);
      upgraded += 1;
      events.push({ type: 'upgrade', idx, tier });
    }
  }
  game.yesterday = { ...d, share, clean, day, moved, upgraded };
  game.today = emptyDay();
  events.push({
    type: 'morning',
    day,
    share,
    clean,
    earned: d.earned,
    fuel: d.fuel,
    moved,
    upgraded,
    houses: game.houses,
  });
  if (moved || upgraded) refresh(game);
}

// What the village has to be before each locked building can be had.
const EARNED = {
  tracker: (game) => game.houses >= 5,
  turbine: (game) =>
    game.plots.slice(0, game.houses).some((idx) => game.things[idx]?.tier >= 2),
  bank: (game) => game.houses >= 8,
};

function checkUnlocks(game, events) {
  for (const kind of LOCKED) {
    if (game.unlocked.includes(kind) || !EARNED[kind](game)) continue;
    game.unlocked = LOCKED.filter(
      (k) => k === kind || game.unlocked.includes(k),
    );
    events.push({ type: 'unlock', kind, name: KINDS[kind].name });
  }
}

function checkGoals(game, events) {
  if (game.spec.free) return;
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
    if (goal.key === 'done' && !game.done) {
      game.done = { day: game.yesterday.day };
      events.push({ type: 'done', day: game.done.day });
    }
  }
}

/** The first goal not yet reached, or null when they all are (or in free build). */
export function nextGoal(game) {
  if (game.spec.free) return null;
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
  const { flow } = game;
  if (thing.kind === 'panel' || thing.kind === 'tracker') {
    const season = seasonAt(game.spec, game.time);
    const sky = skyAt(game.spec, game.time);
    const light =
      (thing.kind === 'tracker'
        ? trackingFactor(game.time, season)
        : sunFactor(game.time, season)) * sky.sun;
    const now = def.peakKw * light * (thing.shaded ? SHADE_FACTOR : 1);
    lines.push(`Making ${kw(now)} of ${kw(def.peakKw)}.`);
    if (thing.shaded) lines.push('In shade right now.');
    if (unwired) lines.push(unwired);
  } else if (thing.kind === 'turbine') {
    const site = game.terrain[idx] === TERRAIN.SAND ? 1 : INLAND_WIND;
    lines.push(
      `Making ${kw(def.peakKw * turbineFactor(flow.wind) * site)} of ${kw(def.peakKw)}.`,
    );
    if (site < 1) lines.push('Inland: it would catch more wind on the beach.');
    if (unwired) lines.push(unwired);
  } else if (def.stores) {
    lines.push(`Holding ${thing.charge.toFixed(1)} of ${def.capacityKwh} kWh.`);
    if (unwired) lines.push(unwired);
  } else if (thing.kind === 'cable') {
    lines.push(
      unwired ||
        (thing.old
          ? 'The island’s old line. Carrying power.'
          : 'Carrying power.'),
    );
  } else if (thing.kind === 'house') {
    const tier = TIERS[thing.tier];
    lines.push(thing.lit ? 'Lights on.' : 'Dark: no power is reaching it.');
    lines.push(tier.wants);
    return { title: tier.name, lines };
  } else if (thing.kind === 'generator') {
    lines.push(
      thing.running
        ? `Running: ${kw(flow.dieselKw)}, burning ${Math.round(flow.dieselKw * FUEL_PER_KWH)} coins an hour.`
        : 'Silent.',
    );
    lines.push(
      `Can make ${kw(game.spec.generatorKw)}, and burns fuel to do it.`,
    );
  } else {
    lines.push(def.blurb);
  }
  return { title: def.name, lines };
}

/* ── saving ───────────────────────────────────────────────────────────────── */

const CODES = {
  panel: 'p',
  tracker: 'k',
  turbine: 'w',
  battery: 'b',
  bank: 'n',
  cable: 'c',
  house: 'h',
  generator: 'g',
  tree: 't',
  rock: 'r',
};
const KIND_OF = Object.fromEntries(
  Object.entries(CODES).map(([kind, code]) => [code, kind]),
);
const round = (n, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

const numbers = (record) =>
  record
    ? Object.fromEntries(
        Object.entries(record).map(([k, v]) => [
          k,
          typeof v === 'number' ? round(v) : v,
        ]),
      )
    : null;

/** The game as plain JSON. The ground isn't in it: the island's spec regrows it. */
export function serialize(game) {
  const things = [];
  game.things.forEach((thing, idx) => {
    if (!thing) return;
    const entry = [idx, CODES[thing.kind]];
    if (KINDS[thing.kind].stores) entry.push(round(thing.charge));
    else if (thing.kind === 'house')
      entry.push(thing.order, thing.variant, thing.tier, thing.good);
    else if (thing.kind === 'cable') {
      if (thing.old) entry.push(1);
    } else if (thing.variant !== undefined) entry.push(thing.variant);
    things.push(entry);
  });
  return {
    v: SAVE_VERSION,
    island: game.spec.id,
    ...(game.spec.date ? { date: game.spec.date } : {}),
    coins: round(game.coins),
    time: round(game.time, 4),
    things,
    today: numbers(game.today),
    yesterday: numbers(game.yesterday),
    totals: numbers(game.totals),
    goals: Object.keys(game.goals).filter((key) => game.goals[key]),
    unlocked: [...game.unlocked],
    done: game.done ? { day: game.done.day } : null,
  };
}

const readDay = (d) => {
  const out = emptyDay();
  if (d && typeof d === 'object') {
    for (const key of Object.keys(out))
      if (finite(d[key])) out[key] = Math.max(0, d[key]);
  }
  return out;
};

const unit = (n) => (finite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * A game from what serialize wrote, or null for anything else: a save from
 * another version, a truncated one, one that has been edited into nonsense.
 * A null is answered with a fresh island, never with a broken one.
 */
export function deserialize(data) {
  try {
    if (!data || typeof data !== 'object' || data.v !== SAVE_VERSION)
      return null;
    if (
      !finite(data.coins) ||
      !finite(data.time) ||
      !Array.isArray(data.things)
    )
      return null;
    const spec = specById(
      data.island,
      typeof data.date === 'string' ? data.date : undefined,
    );
    if (!spec) return null;

    const island = generateIsland(spec);
    const things = new Array(island.size * island.size).fill(null);
    let houses = 0;
    for (const entry of data.things) {
      if (!Array.isArray(entry)) return null;
      const [idx, code, a, b, c, d] = entry;
      const kind = KIND_OF[code];
      if (!kind || !Number.isInteger(idx) || idx < 0 || idx >= things.length)
        return null;
      if (island.terrain[idx] === TERRAIN.WATER || things[idx]) return null;
      if (KINDS[kind].stores) {
        const cap = KINDS[kind].capacityKwh;
        things[idx] = {
          kind,
          charge: finite(a) ? Math.min(cap, Math.max(0, a)) : 0,
        };
      } else if (kind === 'house') {
        if (!Number.isInteger(a) || island.plots[a] !== idx) return null;
        things[idx] = {
          kind,
          order: a,
          variant: finite(b) ? b : a,
          tier: Number.isInteger(c) && c >= 1 && c <= spec.maxTier ? c : 1,
          good: Number.isInteger(d) && d >= 0 ? d : 0,
          lit: false,
        };
        houses += 1;
      } else if (kind === 'generator') {
        // There is one, and it stands where the island put it.
        if (idx !== island.generator) return null;
        things[idx] = { kind };
      } else if (kind === 'cable') {
        things[idx] = a === 1 ? { kind, old: true } : { kind };
      } else if (finite(a)) {
        things[idx] = { kind, variant: a };
      } else {
        things[idx] = { kind };
      }
    }
    // Homes fill the plots in order, so a save with a gap isn't one of ours.
    for (let i = 0; i < houses; i += 1) {
      if (things[island.plots[i]]?.kind !== 'house') return null;
    }
    if (houses === 0) return null;

    const game = base(spec, island, things);
    game.houses = houses;
    game.coins = Math.max(0, data.coins);
    game.time = Math.max(0, data.time);
    game.today = readDay(data.today);
    if (data.yesterday && typeof data.yesterday === 'object') {
      game.yesterday = {
        ...readDay(data.yesterday),
        share: unit(data.yesterday.share),
        clean: unit(data.yesterday.clean),
        day: finite(data.yesterday.day) ? data.yesterday.day : 0,
        moved: data.yesterday.moved === true,
        upgraded: finite(data.yesterday.upgraded) ? data.yesterday.upgraded : 0,
      };
    }
    for (const key of Object.keys(game.totals)) {
      if (finite(data.totals?.[key]))
        game.totals[key] = Math.max(0, data.totals[key]);
    }
    const known = new Set(GOALS.map((goal) => goal.key));
    for (const key of Array.isArray(data.goals) ? data.goals : []) {
      if (known.has(key)) game.goals[key] = true;
    }
    game.unlocked = spec.free
      ? [...LOCKED]
      : LOCKED.filter(
          (kind) =>
            Array.isArray(data.unlocked) && data.unlocked.includes(kind),
        );
    if (data.done && finite(data.done.day)) game.done = { day: data.done.day };
    refresh(game);
    return game;
  } catch {
    return null;
  }
}
