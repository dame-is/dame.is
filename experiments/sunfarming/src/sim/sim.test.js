import { describe, expect, it } from 'vitest';
import {
  DAWN,
  GRID,
  KINDS,
  PRICE_PER_KWH,
  START_COINS,
  START_HOUSES,
  TERRAIN,
  VILLAGE_PLOTS,
} from './catalog.js';
import {
  GOALS,
  canPlace,
  canRemove,
  createGame,
  describeTile,
  deserialize,
  networks,
  nextGoal,
  place,
  remove,
  serialize,
  step,
} from './game.js';
import {
  DEFAULT_SEED,
  generateIsland,
  indexOf,
  neighbours,
  xOf,
  zOf,
} from './island.js';
import { findNetworks } from './network.js';
import {
  dayOf,
  formatClock,
  hourOf,
  moonArc,
  sunArc,
  sunFactor,
} from './sun.js';

/* ── helpers ──────────────────────────────────────────────────────────────── */

// Free, buildable tiles in a straight run out from one of the village's
// houses, so a test can lay a chain down without caring where the seed put
// things. run[0] touches a house; each tile after it touches only the one
// before. (Asked of an open game: trees would break the run.)
function clearRun(game, length) {
  const purse = game.coins;
  game.coins = Infinity;
  try {
    for (const start of game.plots.slice(0, game.houses)) {
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]) {
        const run = [];
        let x = xOf(start) + dx;
        let z = zOf(start) + dz;
        while (
          run.length < length &&
          x >= 0 &&
          z >= 0 &&
          x < GRID &&
          z < GRID
        ) {
          const idx = indexOf(x, z);
          if (!canPlace(game, 'cable', idx).ok) break;
          run.push(idx);
          x += dx;
          z += dz;
        }
        if (run.length === length) return run;
      }
    }
  } finally {
    game.coins = purse;
  }
  throw new Error(`no clear run of ${length} from the village`);
}

// Free tiles in one patch against the village, nearest first: for a test on
// an island that still has its trees, where a straight run may not exist.
function clearPatch(game, count) {
  const purse = game.coins;
  game.coins = Infinity;
  try {
    const seen = new Set(game.plots.slice(0, game.houses));
    const queue = [...seen];
    const patch = [];
    while (queue.length && patch.length < count) {
      for (const n of neighbours(queue.shift())) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (!canPlace(game, 'cable', n).ok) continue;
        patch.push(n);
        queue.push(n);
        if (patch.length === count) break;
      }
    }
    if (patch.length === count) return patch;
  } finally {
    game.coins = purse;
  }
  throw new Error(`no clear patch of ${count} against the village`);
}

// A game with every tree and rock gone and a deep purse: room to build.
function openGame(coins = 100000) {
  const game = createGame();
  game.things.forEach((thing, idx) => {
    if (thing && KINDS[thing.kind].scenery) game.things[idx] = null;
  });
  game.wiring = null;
  game.coins = coins;
  return game;
}

const runHours = (game, hours, tick = 0.25) => {
  const events = [];
  for (let t = 0; t < hours - 1e-9; t += tick) events.push(...step(game, tick));
  return events;
};

/* ── the island ───────────────────────────────────────────────────────────── */

describe('the island', () => {
  it('grows the same from the same seed, and differently from another', () => {
    const a = generateIsland(5);
    const b = generateIsland(5);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(a.scenery).toEqual(b.scenery);
    expect(a.plots).toEqual(b.plots);
    expect(Array.from(generateIsland(6).terrain)).not.toEqual(
      Array.from(a.terrain),
    );
  });

  it('is one piece of land with sea all the way round', () => {
    for (const seed of [DEFAULT_SEED, 1, 2, 3, 42, 1234]) {
      const { terrain, size } = generateIsland(seed);
      for (let i = 0; i < size; i += 1) {
        expect(terrain[indexOf(i, 0)]).toBe(TERRAIN.WATER);
        expect(terrain[indexOf(i, size - 1)]).toBe(TERRAIN.WATER);
        expect(terrain[indexOf(0, i)]).toBe(TERRAIN.WATER);
        expect(terrain[indexOf(size - 1, i)]).toBe(TERRAIN.WATER);
      }
      const land = [];
      terrain.forEach((t, idx) => t !== TERRAIN.WATER && land.push(idx));
      expect(land.length).toBeGreaterThan(120);
      const seen = new Set([land[0]]);
      const queue = [land[0]];
      while (queue.length) {
        for (const n of neighbours(queue.pop(), size)) {
          if (terrain[n] === TERRAIN.WATER || seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      expect(seen.size).toBe(land.length);
    }
  });

  it('puts a beach between the grass and the sea', () => {
    const { terrain, size } = generateIsland(DEFAULT_SEED);
    terrain.forEach((t, idx) => {
      if (t !== TERRAIN.GRASS) return;
      for (const n of neighbours(idx, size))
        expect(terrain[n]).not.toBe(TERRAIN.WATER);
    });
  });

  it('keeps twelve grass plots for the village, each touching an earlier one, and clear of trees', () => {
    for (const seed of [DEFAULT_SEED, 1, 2, 3, 42, 1234]) {
      const { terrain, plots, scenery, size } = generateIsland(seed);
      expect(plots).toHaveLength(VILLAGE_PLOTS);
      expect(new Set(plots).size).toBe(VILLAGE_PLOTS);
      const blocked = new Set(scenery.map((s) => s.idx));
      plots.forEach((idx, i) => {
        expect(terrain[idx]).toBe(TERRAIN.GRASS);
        expect(blocked.has(idx)).toBe(false);
        if (i > 0) {
          expect(
            neighbours(idx, size).some((n) => plots.slice(0, i).includes(n)),
          ).toBe(true);
        }
      });
    }
  });

  it('leaves a way in: the first house has open ground beside it that is not a plot', () => {
    for (const seed of [DEFAULT_SEED, 1, 2, 3, 42, 1234, 99999]) {
      const { terrain, plots, scenery, size } = generateIsland(seed);
      const taken = new Set([...plots, ...scenery.map((s) => s.idx)]);
      const open = neighbours(plots[0], size).filter(
        (n) => terrain[n] !== TERRAIN.WATER && !taken.has(n),
      );
      expect(open.length).toBeGreaterThan(0);
    }
  });
});

/* ── the clock ────────────────────────────────────────────────────────────── */

describe('the sun', () => {
  it('is down at night, up by day, and highest at noon', () => {
    expect(sunFactor(0)).toBe(0);
    expect(sunFactor(6)).toBe(0);
    expect(sunFactor(18)).toBe(0);
    expect(sunFactor(23.9)).toBe(0);
    expect(sunFactor(12)).toBeCloseTo(1, 10);
    expect(sunFactor(9)).toBeCloseTo(sunFactor(15), 10);
    expect(sunFactor(9)).toBeGreaterThan(sunFactor(7));
    expect(sunFactor(24 + 12)).toBeCloseTo(1, 10);
  });

  it('counts days from dawn to dawn', () => {
    expect(dayOf(7)).toBe(1);
    expect(dayOf(29.9)).toBe(1);
    expect(dayOf(30)).toBe(2);
    expect(hourOf(30)).toBe(6);
    expect(sunArc(12)).toBeCloseTo(0.5);
    expect(moonArc(0)).toBeCloseTo(0.5);
    expect(moonArc(18)).toBeCloseTo(0);
  });

  it('writes the clock in fives', () => {
    expect(formatClock(7)).toBe('7:00 am');
    expect(formatClock(12.1)).toBe('12:05 pm');
    expect(formatClock(0.99)).toBe('12:55 am');
    expect(formatClock(24 + 18.5)).toBe('6:30 pm');
  });
});

/* ── building ─────────────────────────────────────────────────────────────── */

describe('building', () => {
  it('starts with a few houses, a purse, and nothing else built', () => {
    const game = createGame();
    expect(game.houses).toBe(START_HOUSES);
    expect(game.coins).toBe(START_COINS);
    expect(hourOf(game.time)).toBeGreaterThan(DAWN);
    const kinds = game.things.filter(Boolean).map((t) => t.kind);
    expect(kinds.filter((k) => k === 'house')).toHaveLength(START_HOUSES);
    expect(
      kinds.some((k) => k === 'panel' || k === 'battery' || k === 'cable'),
    ).toBe(false);
  });

  it('charges for what is put down and gives it all back when it is taken up', () => {
    const game = createGame();
    const [a, b] = clearPatch(game, 2);
    expect(place(game, 'panel', a).ok).toBe(true);
    expect(game.coins).toBe(START_COINS - KINDS.panel.cost);
    expect(place(game, 'cable', b).ok).toBe(true);
    expect(game.coins).toBe(START_COINS - KINDS.panel.cost - KINDS.cable.cost);
    expect(remove(game, a)).toMatchObject({
      ok: true,
      kind: 'panel',
      coins: KINDS.panel.cost,
    });
    expect(remove(game, b).ok).toBe(true);
    expect(game.coins).toBe(START_COINS);
    expect(game.things[a]).toBeNull();
  });

  it('refuses the sea, an occupied tile, a village plot, and an empty purse', () => {
    const game = createGame();
    const sea = game.terrain.findIndex((t) => t === TERRAIN.WATER);
    expect(canPlace(game, 'panel', sea)).toMatchObject({
      ok: false,
      reason: 'water',
    });
    expect(canPlace(game, 'panel', game.plots[0])).toMatchObject({
      ok: false,
      reason: 'occupied',
    });
    expect(canPlace(game, 'panel', game.plots[game.houses])).toMatchObject({
      ok: false,
      reason: 'reserved',
    });
    const tree = game.things.findIndex((t) => t?.kind === 'tree');
    expect(canPlace(game, 'panel', tree)).toMatchObject({
      ok: false,
      reason: 'blocked',
    });
    expect(canPlace(game, 'house', clearPatch(game, 1)[0]).ok).toBe(false);
    expect(canPlace(game, 'panel', -1).ok).toBe(false);
    game.coins = 10;
    expect(canPlace(game, 'panel', clearPatch(game, 1)[0])).toMatchObject({
      ok: false,
      reason: 'coins',
    });
    const before = serialize(game);
    expect(place(game, 'panel', sea).ok).toBe(false);
    expect(serialize(game)).toEqual(before);
  });

  it('clears scenery for a price and never removes a house', () => {
    const game = createGame();
    const tree = game.things.findIndex((t) => t?.kind === 'tree');
    expect(canRemove(game, tree)).toMatchObject({
      ok: true,
      coins: -KINDS.tree.clearCost,
    });
    expect(remove(game, tree).ok).toBe(true);
    expect(game.coins).toBe(START_COINS - KINDS.tree.clearCost);
    expect(canPlace(game, 'panel', tree).ok).toBe(true);
    expect(remove(game, game.plots[0])).toMatchObject({
      ok: false,
      reason: 'house',
    });
    expect(remove(game, tree)).toMatchObject({ ok: false, reason: 'empty' });
    game.coins = 0;
    const rock = game.things.findIndex((t) => t?.kind === 'rock');
    expect(remove(game, rock)).toMatchObject({ ok: false, reason: 'coins' });
  });
});

/* ── wiring ───────────────────────────────────────────────────────────────── */

describe('networks', () => {
  it('joins things that touch, and nothing across a gap or a diagonal', () => {
    const size = 4;
    const things = new Array(16).fill(null);
    things[0] = { kind: 'panel' };
    things[1] = { kind: 'cable' };
    things[2] = { kind: 'house', order: 0 };
    things[5 + 4] = { kind: 'battery', charge: 0 }; // (1,2): diagonal to nothing, below (1,1)
    things[15] = { kind: 'panel' };
    things[10] = { kind: 'tree' };
    const { netOf, nets } = findNetworks(things, size);
    expect(nets).toHaveLength(3);
    expect(netOf[0]).toBe(netOf[1]);
    expect(netOf[1]).toBe(netOf[2]);
    expect(netOf[9]).not.toBe(netOf[0]);
    expect(netOf[15]).not.toBe(netOf[9]);
    expect(netOf[10]).toBe(-1);
    expect(nets[netOf[0]]).toMatchObject({
      panels: [0],
      cables: [1],
      houses: [2],
    });
  });

  it('marks what can and cannot reach a house', () => {
    const game = openGame();
    const run = clearRun(game, 4);
    place(game, 'panel', run[3]);
    networks(game);
    expect(game.things[run[3]].live).toBe(false);
    place(game, 'cable', run[0]);
    place(game, 'cable', run[1]);
    networks(game);
    expect(game.things[run[3]].live).toBe(false);
    place(game, 'cable', run[2]);
    networks(game);
    expect(game.things[run[3]].live).toBe(true);
    remove(game, run[1]);
    networks(game);
    expect(game.things[run[3]].live).toBe(false);
    expect(game.things[run[0]].live).toBe(true);
  });
});

/* ── power ────────────────────────────────────────────────────────────────── */

describe('power', () => {
  it('lights the village at once when enough panels are wired in', () => {
    const game = openGame();
    const run = clearRun(game, 4);
    expect(game.flow.litHouses).toBe(0);
    place(game, 'cable', run[0]);
    for (const idx of run.slice(1)) place(game, 'panel', idx);
    // 7 am: three panels make a little under 0.8 kW, two houses' worth.
    expect(game.flow.demandKw).toBeCloseTo(START_HOUSES * KINDS.house.demandKw);
    expect(game.flow.litHouses).toBe(1);
    game.time = 12;
    step(game, 0.01);
    expect(game.flow.litHouses).toBe(START_HOUSES);
    expect(game.flow.deliveredKw).toBeCloseTo(game.flow.demandKw);
    expect(game.flow.wastedKw).toBeCloseTo(3 - game.flow.demandKw, 1);
  });

  it('pays for exactly what is delivered', () => {
    const game = openGame(0);
    const run = clearRun(game, 4);
    game.coins = 1000;
    place(game, 'cable', run[0]);
    for (const idx of run.slice(1)) place(game, 'panel', idx);
    const purse = game.coins;
    game.time = 11;
    step(game, 2);
    const demand = START_HOUSES * KINDS.house.demandKw;
    // The 'connect' and 'lit' goals pay out on the way; take them back off.
    const rewards = GOALS.filter((g) => game.goals[g.key]).reduce(
      (n, g) => n + g.reward,
      0,
    );
    expect(game.coins - purse - rewards).toBeCloseTo(
      demand * 2 * PRICE_PER_KWH,
      6,
    );
    expect(game.today.delivered).toBeCloseTo(demand * 2, 6);
    expect(game.today.earned).toBeCloseTo(demand * 2 * PRICE_PER_KWH, 6);
  });

  it('pays nothing for panels that reach no house', () => {
    const game = openGame();
    const run = clearRun(game, 4);
    place(game, 'panel', run[2]);
    place(game, 'panel', run[3]);
    const purse = game.coins;
    game.time = 10;
    step(game, 4);
    expect(game.coins).toBe(purse);
    expect(game.flow.generatingKw).toBeGreaterThan(0);
    expect(game.flow.deliveredKw).toBe(0);
    expect(game.flow.litHouses).toBe(0);
  });

  it('stores the spare by day and hands it back after dark', () => {
    const game = openGame();
    const run = clearRun(game, 6);
    place(game, 'cable', run[0]);
    place(game, 'battery', run[1]);
    for (const idx of run.slice(2)) place(game, 'panel', idx);
    game.time = 9;
    runHours(game, 6);
    const battery = game.things[run[1]];
    expect(battery.charge).toBeCloseTo(KINDS.battery.capacityKwh, 3);
    game.time = 19;
    step(game, 0.5);
    expect(game.flow.sun).toBe(0);
    expect(game.flow.litHouses).toBe(START_HOUSES);
    expect(game.flow.chargingKw).toBeLessThan(0);
    expect(battery.charge).toBeCloseTo(
      KINDS.battery.capacityKwh - 0.5 * START_HOUSES * KINDS.house.demandKw,
      3,
    );
    // 8 kWh lasts three houses 6 h 40 min; by the small hours it is flat.
    runHours(game, 8);
    expect(battery.charge).toBeCloseTo(0, 6);
    expect(game.flow.litHouses).toBe(0);
  });

  it('never charges or drains a battery faster than its rate, or past its ends', () => {
    const game = openGame();
    const run = clearRun(game, 8);
    place(game, 'battery', run[0]);
    for (const idx of run.slice(1)) place(game, 'panel', idx);
    const battery = game.things[run[0]];
    game.time = 12;
    step(game, 1);
    // Seven panels at noon is far more than the battery's 2 kW will take.
    expect(battery.charge).toBeLessThanOrEqual(KINDS.battery.rateKw * 1 + 1e-9);
    expect(game.flow.wastedKw).toBeGreaterThan(0);
    runHours(game, 5);
    expect(battery.charge).toBeLessThanOrEqual(
      KINDS.battery.capacityKwh + 1e-9,
    );
    game.time = 22;
    runHours(game, 30);
    expect(battery.charge).toBeGreaterThanOrEqual(0);
  });

  it('shares power out a whole house at a time, oldest first', () => {
    const game = openGame();
    const run = clearRun(game, 2);
    place(game, 'cable', run[0]);
    place(game, 'panel', run[1]);
    game.time = 12;
    step(game, 0.01);
    // One panel at noon: 1 kW for three houses wanting 0.4 each.
    expect(game.flow.litHouses).toBe(2);
    const lit = game.plots
      .slice(0, game.houses)
      .map((idx) => game.things[idx].lit);
    expect(lit).toEqual([true, true, false]);
  });

  it('gives the same day whether it is stepped in frames or in one go', () => {
    const build = () => {
      const game = openGame();
      const run = clearRun(game, 7);
      place(game, 'cable', run[0]);
      place(game, 'battery', run[1]);
      for (const idx of run.slice(2)) place(game, 'panel', idx);
      return game;
    };
    const a = build();
    const b = build();
    step(a, 24);
    for (let i = 0; i < 24 * 240; i += 1) step(b, 1 / 240);
    expect(a.time).toBeCloseTo(b.time, 6);
    expect(a.coins).toBeCloseTo(b.coins, 0);
    expect(a.houses).toBe(b.houses);
  });
});

/* ── days, growth and goals ───────────────────────────────────────────────── */

describe('days', () => {
  it('closes the books at dawn and says how the day went', () => {
    const game = openGame();
    const events = runHours(game, 24);
    const morning = events.find((e) => e.type === 'morning');
    expect(morning).toMatchObject({
      day: 1,
      share: 0,
      grew: false,
      houses: START_HOUSES,
    });
    expect(game.yesterday).toMatchObject({ day: 1, share: 0 });
    expect(game.today.demanded).toBeLessThan(
      START_HOUSES * KINDS.house.demandKw * 2,
    );
    expect(dayOf(game.time)).toBe(2);
  });

  it('grows the village by a house after a well powered day, and not after a dark one', () => {
    const game = openGame();
    const run = clearRun(game, 9);
    place(game, 'cable', run[0]);
    place(game, 'battery', run[1]);
    place(game, 'battery', run[2]);
    for (const idx of run.slice(3)) place(game, 'panel', idx);
    game.things[run[1]].charge = KINDS.battery.capacityKwh;
    game.things[run[2]].charge = KINDS.battery.capacityKwh;
    const events = runHours(game, 24);
    expect(events.find((e) => e.type === 'morning')).toMatchObject({
      grew: true,
    });
    expect(events.filter((e) => e.type === 'house')).toHaveLength(1);
    expect(game.houses).toBe(START_HOUSES + 1);
    expect(game.things[game.plots[START_HOUSES]]).toMatchObject({
      kind: 'house',
      order: START_HOUSES,
    });
    // The new house joined the village's network and its demand.
    expect(game.flow.demandKw).toBeCloseTo(
      (START_HOUSES + 1) * KINDS.house.demandKw,
    );

    const dark = openGame();
    runHours(dark, 48);
    expect(dark.houses).toBe(START_HOUSES);
  });

  it('stops growing when the plots run out', () => {
    const game = openGame();
    while (game.houses < game.plots.length) {
      game.today = {
        demanded: 10,
        delivered: 10,
        generated: 10,
        wasted: 0,
        earned: 0,
      };
      game.time = Math.floor(game.time / 24) * 24 + 29.99;
      step(game, 0.02);
    }
    expect(game.houses).toBe(VILLAGE_PLOTS);
    game.today = {
      demanded: 10,
      delivered: 10,
      generated: 10,
      wasted: 0,
      earned: 0,
    };
    game.time = Math.floor(game.time / 24) * 24 + 29.99;
    const events = step(game, 0.02);
    expect(events.find((e) => e.type === 'morning')).toMatchObject({
      grew: false,
    });
    expect(game.houses).toBe(VILLAGE_PLOTS);
  });

  it('pays each goal once, in whatever order they are reached', () => {
    const game = openGame(1000);
    expect(nextGoal(game).key).toBe('connect');
    const run = clearRun(game, 5);
    place(game, 'cable', run[0]);
    for (const idx of run.slice(1)) place(game, 'panel', idx);
    const purse = game.coins;
    game.time = 12;
    const events = step(game, 0.001);
    const reached = events.filter((e) => e.type === 'goal').map((e) => e.key);
    expect(reached).toEqual(['connect', 'lit']);
    const rewards = GOALS.filter((g) => reached.includes(g.key)).reduce(
      (n, g) => n + g.reward,
      0,
    );
    expect(game.coins).toBeCloseTo(purse + rewards, 0);
    expect(step(game, 0.001).filter((e) => e.type === 'goal')).toEqual([]);
    expect(nextGoal(game).key).toBe('night');
    for (const goal of GOALS) game.goals[goal.key] = true;
    expect(nextGoal(game)).toBeNull();
  });

  it('can be played from the opening purse to a village that grows', () => {
    // The opening the hints point at: a line to the village, a battery and
    // four panels, which is all the opening purse runs to; then a second
    // battery as soon as the takings cover it.
    const game = openGame(START_COINS);
    const run = clearRun(game, 7);
    place(game, 'cable', run[0]);
    place(game, 'battery', run[1]);
    for (const idx of run.slice(2, 6))
      expect(place(game, 'panel', idx).ok).toBe(true);
    expect(game.coins).toBeGreaterThanOrEqual(0);
    expect(canPlace(game, 'battery', run[6])).toMatchObject({
      ok: false,
      reason: 'coins',
    });
    let day = 0;
    while (game.houses === START_HOUSES && day < 6) {
      for (let h = 0; h < 24; h += 1) {
        runHours(game, 1);
        if (!game.things[run[6]]) place(game, 'battery', run[6]);
      }
      day += 1;
    }
    expect(game.houses).toBeGreaterThan(START_HOUSES);
    expect(day).toBeLessThanOrEqual(4);
  });
});

/* ── reading and saving ───────────────────────────────────────────────────── */

describe('describeTile', () => {
  it('says what is there', () => {
    const game = openGame();
    const run = clearRun(game, 3);
    place(game, 'panel', run[2]);
    expect(describeTile(game, run[2])).toMatchObject({ title: 'Solar panel' });
    expect(describeTile(game, run[2]).lines.join(' ')).toMatch(/Not wired/);
    expect(describeTile(game, game.plots[0]).title).toBe('House');
    expect(describeTile(game, game.plots[game.houses]).title).toBe(
      'Village plot',
    );
    expect(
      describeTile(
        game,
        game.terrain.findIndex((t) => t === TERRAIN.WATER),
      ).title,
    ).toBe('Sea');
    expect(describeTile(game, run[0]).lines).toEqual(['Room to build.']);
    expect(describeTile(game, -1)).toBeNull();
  });
});

describe('saving', () => {
  it('comes back as it was', () => {
    const game = createGame();
    const run = clearPatch(game, 5);
    place(game, 'cable', run[0]);
    place(game, 'battery', run[1]);
    for (const idx of run.slice(2)) place(game, 'panel', idx);
    expect(game.things.filter((t) => t?.kind === 'panel')).toHaveLength(3);
    runHours(game, 30);
    const saved = JSON.parse(JSON.stringify(serialize(game)));
    const back = deserialize(saved);
    expect(back).not.toBeNull();
    expect(serialize(back)).toEqual(saved);
    expect(back.houses).toBe(game.houses);
    expect(Array.from(back.terrain)).toEqual(Array.from(game.terrain));
    expect(back.things.map((t) => t?.kind)).toEqual(
      game.things.map((t) => t?.kind),
    );
    expect(back.things[run[1]].charge).toBeCloseTo(
      game.things[run[1]].charge,
      2,
    );
    // And it plays on from there the same.
    step(game, 5);
    step(back, 5);
    expect(back.coins).toBeCloseTo(game.coins, 0);
  });

  it('turns away anything that is not a save', () => {
    const good = serialize(createGame());
    expect(deserialize(good)).not.toBeNull();
    const sea = generateIsland(good.seed).terrain.findIndex(
      (t) => t === TERRAIN.WATER,
    );
    for (const bad of [
      null,
      undefined,
      'a string',
      42,
      {},
      { ...good, v: 99 },
      { ...good, seed: 'x' },
      { ...good, coins: Infinity },
      { ...good, things: 'none' },
      { ...good, things: [[sea, 'p']] },
      { ...good, things: [...good.things, [good.things[0][0], 'p']] },
      { ...good, things: [[5, 'z']] },
      { ...good, things: good.things.filter((t) => t[1] !== 'h') },
      {
        ...good,
        things: good.things.map((t) =>
          t[1] === 'h' && t[2] === 0 ? [t[0], 'c'] : t,
        ),
      },
    ]) {
      expect(deserialize(bad)).toBeNull();
    }
  });
});
