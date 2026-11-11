import { describe, expect, it } from 'vitest';
import {
  FUEL_PER_KWH,
  GROW_AT,
  INLAND_WIND,
  KINDS,
  LOCKED,
  SHADE_FACTOR,
  START_HOUSES,
  TERRAIN,
  TIERS,
  loadAt,
} from './catalog.js';
import {
  GOALS,
  UPGRADES_PER_DAWN,
  canPlace,
  canRemove,
  createGame,
  dawnPlan,
  describeTile,
  deserialize,
  generatorTile,
  isUnlocked,
  networks,
  nextGoal,
  place,
  remove,
  serialize,
  step,
  turbineFactor,
  villageComplete,
} from './game.js';
import { generateIsland, indexOf, neighbours, xOf, zOf } from './island.js';
import {
  FREE_BUILD,
  ISLANDS,
  TUTORIAL,
  homeIsland,
  isOpen,
  isTaught,
  markDone,
  newProgress,
  nextIsland,
  readProgress,
  specById,
  todaysIsland,
  withUnlocked,
} from './islands.js';
import {
  LESSON,
  advanceLesson,
  inLesson,
  lessonHolds,
  lessonNow,
  lessonSteps,
} from './lesson.js';
import { findNetworks } from './network.js';
import { isShaded, shadeHeight, sunMap } from './shade.js';
import {
  SEASONS,
  arcDirection,
  dayOf,
  formatClock,
  hourOf,
  moonArc,
  seasonOf,
  skyHour,
  sunArc,
  sunDirection,
  sunFactor,
  trackingFactor,
} from './sun.js';
import { CLIMATES, SKIES, forecast, skyOf, windAt } from './weather.js';

const TERN = ISLANDS[0];
const ALL_SPECS = [
  ...ISLANDS,
  FREE_BUILD,
  todaysIsland('2026-11-10'),
  todaysIsland('2027-03-02'),
];

/* ── helpers ──────────────────────────────────────────────────────────────── */

// A game with every tree and rock gone and a deep purse: room to build.
function openGame(spec = TERN, coins = 100000) {
  const game = createGame({ spec });
  game.things.forEach((thing, idx) => {
    if (thing && KINDS[thing.kind].scenery) game.things[idx] = null;
  });
  game.wiring = null;
  game.light = null;
  game.coins = coins;
  return game;
}

// The same, with the generator and its line gone too: an island that has
// only what the test puts on it.
function bareGame(spec = TERN) {
  const game = openGame(spec);
  game.things.forEach((thing, idx) => {
    if (thing && (thing.kind === 'generator' || thing.kind === 'cable'))
      game.things[idx] = null;
  });
  game.wiring = null;
  return game;
}

// Free tiles in a straight run out from one of the village's homes: run[0]
// touches a home, each tile after it touches only the one before.
function clearRun(game, length) {
  const purse = game.coins;
  game.coins = Infinity;
  const { size } = game;
  try {
    for (const start of game.plots.slice(0, game.houses)) {
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]) {
        const run = [];
        let x = xOf(start, size) + dx;
        let z = zOf(start, size) + dz;
        while (
          run.length < length &&
          x >= 0 &&
          z >= 0 &&
          x < size &&
          z < size
        ) {
          const idx = indexOf(x, z, size);
          if (!canPlace(game, 'cable', idx).ok) break;
          // Nothing else may touch the run but the tile before it.
          const strangers = neighbours(idx, size).filter(
            (n) => game.things[n] && !run.includes(n) && n !== start,
          );
          if (strangers.length) break;
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

// Free tiles in one patch against the network, nearest first.
function clearPatch(game, count) {
  const purse = game.coins;
  game.coins = Infinity;
  try {
    const seen = new Set(game.plots.slice(0, game.houses));
    const queue = [...seen];
    const patch = [];
    while (queue.length && patch.length < count) {
      for (const n of neighbours(queue.shift(), game.size)) {
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

const runHours = (game, hours, tick = 0.25) => {
  const events = [];
  for (let t = 0; t < hours - 1e-9; t += tick) events.push(...step(game, tick));
  return events;
};

const homes = (game) =>
  game.plots.slice(0, game.houses).map((idx) => game.things[idx]);
const setTime = (game, hour) => {
  game.time = Math.floor(game.time / 24) * 24 + hour;
  game.light = null;
};

/* ── the islands ──────────────────────────────────────────────────────────── */

describe('an island', () => {
  it('grows the same from the same spec, and differently from another', () => {
    const a = generateIsland(TERN);
    const b = generateIsland(TERN);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(a.scenery).toEqual(b.scenery);
    expect(a.plots).toEqual(b.plots);
    expect(a.line).toEqual(b.line);
    expect(Array.from(generateIsland(ISLANDS[1]).terrain)).not.toEqual(
      Array.from(a.terrain),
    );
  });

  it('is one piece of land with sea all the way round and a beach between', () => {
    for (const spec of ALL_SPECS) {
      const { terrain, size } = generateIsland(spec);
      for (let i = 0; i < size; i += 1) {
        expect(terrain[indexOf(i, 0, size)]).toBe(TERRAIN.WATER);
        expect(terrain[indexOf(i, size - 1, size)]).toBe(TERRAIN.WATER);
        expect(terrain[indexOf(0, i, size)]).toBe(TERRAIN.WATER);
        expect(terrain[indexOf(size - 1, i, size)]).toBe(TERRAIN.WATER);
      }
      const land = [];
      terrain.forEach((t, idx) => t !== TERRAIN.WATER && land.push(idx));
      expect(land.length).toBeGreaterThan(90);
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
      terrain.forEach((t, idx) => {
        if (t !== TERRAIN.GRASS) return;
        for (const n of neighbours(idx, size))
          expect(terrain[n]).not.toBe(TERRAIN.WATER);
      });
    }
  });

  it('keeps a block of grass plots for the village, each touching an earlier one', () => {
    for (const spec of ALL_SPECS) {
      const { terrain, plots, scenery, size } = generateIsland(spec);
      expect(plots).toHaveLength(spec.block[0] * spec.block[1]);
      expect(new Set(plots).size).toBe(plots.length);
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

  it('puts the generator on the beach by the sea, with a line that reaches the first homes', () => {
    for (const spec of ALL_SPECS) {
      const { terrain, plots, scenery, generator, line, pier, size } =
        generateIsland(spec);
      expect(generator).toBeGreaterThanOrEqual(0);
      expect(terrain[generator]).toBe(TERRAIN.SAND);
      expect(terrain[pier]).toBe(TERRAIN.WATER);
      expect(neighbours(generator, size)).toContain(pier);
      expect(line.length).toBeGreaterThan(0);
      const taken = new Set([...plots, ...scenery.map((s) => s.idx)]);
      for (const idx of [generator, ...line]) {
        expect(terrain[idx]).not.toBe(TERRAIN.WATER);
        expect(taken.has(idx)).toBe(false);
      }
      // The line is a chain: home, line…, generator.
      const firstHomes = plots.slice(0, START_HOUSES);
      expect(
        neighbours(line[0], size).some((n) => firstHomes.includes(n)),
      ).toBe(true);
      for (let i = 1; i < line.length; i += 1) {
        expect(neighbours(line[i], size)).toContain(line[i - 1]);
      }
      expect(neighbours(generator, size)).toContain(line[line.length - 1]);
    }
  });

  it('starts lit: every first home is on the generator’s network', () => {
    for (const spec of ALL_SPECS) {
      const game = createGame({ spec });
      expect(game.houses).toBe(START_HOUSES);
      expect(game.flow.litHouses).toBe(START_HOUSES);
      expect(game.flow.dieselKw).toBeCloseTo(START_HOUSES * loadAt(1, 7));
      const net = networks(game).nets.find((n) => n.generators.length);
      expect(net.houses).toHaveLength(START_HOUSES);
      // And there is open ground against that network to build on.
      expect(() => clearPatch(game, 4)).not.toThrow();
    }
  });

  it('is more wooded when the spec asks for woods', () => {
    const trees = (spec) =>
      generateIsland(spec).scenery.filter((s) => s.kind === 'tree').length;
    expect(trees(specById('pines'))).toBeGreaterThan(trees(TERN) * 2);
    expect(trees(specById('windward'))).toBeLessThan(trees(TERN));
  });
});

/* ── the clock, the sun and the seasons ───────────────────────────────────── */

describe('the sun', () => {
  it('is down at night, up by day, and highest at noon', () => {
    expect(sunFactor(0)).toBe(0);
    expect(sunFactor(6)).toBe(0);
    expect(sunFactor(18)).toBe(0);
    expect(sunFactor(12)).toBeCloseTo(1, 10);
    expect(sunFactor(9)).toBeCloseTo(sunFactor(15), 10);
    expect(sunFactor(24 + 12)).toBeCloseTo(1, 10);
  });

  it('counts days from daybreak to daybreak, and writes the clock in fives', () => {
    expect(dayOf(7)).toBe(1);
    expect(dayOf(29.9)).toBe(1);
    expect(dayOf(30)).toBe(2);
    expect(hourOf(30)).toBe(6);
    expect(sunArc(12)).toBeCloseTo(0.5);
    expect(moonArc(0)).toBeCloseTo(0.5);
    expect(formatClock(7)).toBe('7:00 am');
    expect(formatClock(12.1)).toBe('12:05 pm');
    expect(formatClock(24 + 18.5)).toBe('6:30 pm');
  });

  it('gives a panel that follows it more in the morning and nothing extra at noon', () => {
    expect(trackingFactor(12)).toBeCloseTo(sunFactor(12), 10);
    expect(trackingFactor(7.5)).toBeGreaterThan(sunFactor(7.5) * 1.4);
    expect(trackingFactor(3)).toBe(0);
    let fixed = 0;
    let tracked = 0;
    for (let h = 0; h < 24; h += 0.05) {
      fixed += sunFactor(h) * 0.05;
      tracked += trackingFactor(h) * 0.05;
    }
    expect(fixed).toBeCloseTo(7.64, 1);
    expect(tracked / fixed).toBeGreaterThan(1.15);
  });

  it('rises in the east, leans south at noon, sets in the west, and is a unit vector', () => {
    const dawn = arcDirection(0.02, 0.62);
    const noon = arcDirection(0.5, 0.62);
    const dusk = arcDirection(0.98, 0.62);
    expect(dawn.x).toBeGreaterThan(0.9);
    expect(dusk.x).toBeLessThan(-0.9);
    expect(noon.x).toBeCloseTo(0, 6);
    expect(noon.z).toBeGreaterThan(0.5);
    expect(noon.y).toBeGreaterThan(dawn.y);
    for (const d of [dawn, noon, dusk])
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    expect(sunDirection(2)).toBeNull();
    expect(sunDirection(12).y).toBeCloseTo(noon.y, 6);
  });
});

describe('the seasons', () => {
  it('leave an island without them in an endless spring', () => {
    for (const day of [1, 4, 9, 40])
      expect(seasonOf(TERN, day).key).toBe('spring');
  });

  it('turn every three days, starting where the island says', () => {
    const spec = { seasons: true, season: 2 };
    const keys = [];
    for (let day = 1; day <= 13; day += 1) keys.push(seasonOf(spec, day).key);
    expect(keys).toEqual([
      'autumn',
      'autumn',
      'autumn',
      'winter',
      'winter',
      'winter',
      'spring',
      'spring',
      'spring',
      'summer',
      'summer',
      'summer',
      'autumn',
    ]);
  });

  it('make a winter day short, weak and low, and a summer day long', () => {
    const [spring, summer, , winter] = SEASONS;
    const energy = (season) => {
      let kwh = 0;
      for (let h = 0; h < 24; h += 0.05) kwh += sunFactor(h, season) * 0.05;
      return kwh;
    };
    expect(energy(winter)).toBeLessThan(energy(spring) * 0.55);
    expect(energy(summer)).toBeGreaterThan(energy(spring) * 1.2);
    expect(sunFactor(7, winter)).toBe(0);
    expect(sunFactor(5, summer)).toBeGreaterThan(0);
    expect(sunDirection(12, winter).y).toBeLessThan(sunDirection(12, summer).y);
  });

  it('map any season’s day onto the sky’s own clock', () => {
    for (const season of SEASONS) {
      expect(skyHour(season.dawn, season)).toBeCloseTo(6);
      expect(skyHour(season.dusk, season)).toBeCloseTo(18);
      expect(skyHour((season.dawn + season.dusk) / 2, season)).toBeCloseTo(12);
      expect(skyHour(0, season)).toBe(0);
      let last = -1;
      for (let h = 0; h < 24; h += 0.25) {
        const sky = skyHour(h, season);
        expect(sky).toBeGreaterThan(last);
        last = sky;
      }
    }
  });
});

describe('the weather', () => {
  it('is the same every time for the same island and day, and clear on the first', () => {
    for (const spec of ISLANDS) {
      expect(skyOf(spec, 1)).toBe(SKIES.clear);
      for (let day = 2; day < 30; day += 1)
        expect(skyOf(spec, day)).toBe(skyOf(spec, day));
    }
    const a = Array.from(
      { length: 40 },
      (_, d) => skyOf(ISLANDS[0], d + 1).key,
    ).join();
    const b = Array.from(
      { length: 40 },
      (_, d) => skyOf(ISLANDS[2], d + 1).key,
    ).join();
    expect(a).not.toBe(b);
  });

  it('follows the island’s climate', () => {
    const light = (climate) => {
      let sum = 0;
      for (let day = 2; day < 402; day += 1)
        sum += skyOf({ seed: 9, climate }, day).sun;
      return sum / 400;
    };
    expect(light('sunny')).toBeGreaterThan(light('mixed'));
    expect(light('mixed')).toBeGreaterThan(light('grey'));
    expect(light('sunny')).toBeGreaterThan(0.8);
    expect(light('grey')).toBeLessThan(0.7);
    for (const odds of Object.values(CLIMATES)) {
      expect(odds[0] + odds[1] + odds[2]).toBeLessThanOrEqual(1);
    }
  });

  it('forecasts by looking up the days to come', () => {
    const spec = ISLANDS[2];
    const ahead = forecast(spec, 24 * 4 + 10, 3);
    expect(ahead).toHaveLength(4);
    expect(ahead[0]).toBe(skyOf(spec, 5));
    expect(ahead[3]).toBe(skyOf(spec, 8));
  });

  it('blows between nothing and full, harder on a windy island and under cloud', () => {
    let calm = 0;
    let windy = 0;
    for (let t = 6; t < 6 + 24 * 60; t += 0.5) {
      const a = windAt({ seed: 4, climate: 'sunny', wind: 1 }, t);
      const b = windAt({ seed: 4, climate: 'sunny', wind: 1.35 }, t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(a - 1e-9);
      calm += a;
      windy += b;
    }
    expect(windy).toBeGreaterThan(calm);
    expect(SKIES.storm.wind).toBeGreaterThan(SKIES.clear.wind);
    expect(turbineFactor(0)).toBe(0);
    expect(turbineFactor(1)).toBe(1);
    expect(turbineFactor(0.4)).toBeGreaterThan(0.3);
  });
});

/* ── shade ────────────────────────────────────────────────────────────────── */

describe('shade', () => {
  // A bare island, with one thing put beside a tile in its middle.
  const stage = (dx, dz, thing = { kind: 'tree', variant: 1 }) => {
    const game = bareGame();
    const at = game.terrain.findIndex(
      (t, idx) =>
        t === TERRAIN.GRASS &&
        !game.things[idx] &&
        !game.plots.includes(idx) &&
        [-2, -1, 1, 2].every(
          (d) =>
            game.terrain[idx + d] === TERRAIN.GRASS &&
            game.terrain[idx + d * game.size] === TERRAIN.GRASS &&
            !game.things[idx + d] &&
            !game.things[idx + d * game.size] &&
            !game.plots.includes(idx + d) &&
            !game.plots.includes(idx + d * game.size),
        ),
    );
    game.things[at + dx + dz * game.size] = thing;
    return { game, at };
  };

  it('falls from a tree to the east early in the morning and is gone by noon', () => {
    const { game, at } = stage(1, 0);
    expect(isShaded(game, at, sunDirection(7))).toBe(true);
    expect(isShaded(game, at, sunDirection(12))).toBe(false);
    expect(isShaded(game, at, sunDirection(17))).toBe(false);
    // The same tree to the west shades the evening instead.
    const west = stage(-1, 0);
    expect(isShaded(west.game, west.at, sunDirection(7))).toBe(false);
    expect(isShaded(west.game, west.at, sunDirection(17))).toBe(true);
  });

  it('reaches further when the sun is low: two tiles at dawn, and at noon in winter', () => {
    const far = stage(2, 0);
    expect(isShaded(far.game, far.at, sunDirection(6.5))).toBe(true);
    expect(isShaded(far.game, far.at, sunDirection(9))).toBe(false);
    const south = stage(0, 1);
    expect(isShaded(south.game, south.at, sunDirection(12, SEASONS[0]))).toBe(
      false,
    );
    expect(isShaded(south.game, south.at, sunDirection(12, SEASONS[3]))).toBe(
      true,
    );
    // Nothing to the north ever shades: the sun is never there.
    const north = stage(0, -1);
    for (let h = 6.25; h < 18; h += 0.5) {
      expect(isShaded(north.game, north.at, sunDirection(h))).toBe(false);
    }
  });

  it('is thrown by tall things and not by flat ones', () => {
    expect(shadeHeight({ kind: 'tree' })).toBeGreaterThan(1);
    expect(shadeHeight({ kind: 'house', tier: 3 })).toBeGreaterThan(
      shadeHeight({ kind: 'house', tier: 1 }),
    );
    for (const kind of [
      'panel',
      'tracker',
      'cable',
      'battery',
      'rock',
      'turbine',
    ]) {
      expect(shadeHeight({ kind })).toBe(0);
    }
    expect(shadeHeight(null)).toBe(0);
    const flat = stage(1, 0, { kind: 'panel' });
    expect(isShaded(flat.game, flat.at, sunDirection(7))).toBe(false);
  });

  it('costs a panel three quarters of what it would have made', () => {
    const { game, at } = stage(1, 0);
    game.things[at] = { kind: 'panel' };
    game.wiring = null;
    setTime(game, 7.5);
    step(game, 0.01);
    expect(game.things[at].shaded).toBe(true);
    expect(game.flow.shadedPanels).toBe(1);
    expect(game.flow.solarKw).toBeCloseTo(sunFactor(7.51) * SHADE_FACTOR, 2);
    setTime(game, 12);
    step(game, 0.01);
    expect(game.things[at].shaded).toBe(false);
    expect(game.flow.solarKw).toBeCloseTo(1, 2);
    expect(describeTile(game, at).lines.join(' ')).not.toMatch(/shade/);
  });

  it('draws a map of how much of the day’s light each tile would get', () => {
    const { game, at } = stage(1, 0);
    const map = sunMap(game);
    expect(map).toHaveLength(game.things.length);
    game.terrain.forEach((t, idx) => {
      if (t === TERRAIN.WATER) expect(map[idx]).toBe(-1);
      else {
        expect(map[idx]).toBeGreaterThanOrEqual(0);
        expect(map[idx]).toBeLessThanOrEqual(1);
      }
    });
    // Beside the tree is worse than out in the open, and the open is full sun.
    expect(map[at]).toBeLessThan(0.95);
    expect(map[at]).toBeGreaterThan(0.5);
    expect(map[at - 2 * game.size - 2]).toBeCloseTo(1, 5);
    // A winter map is darker around the same tree.
    const south = stage(0, 1);
    expect(sunMap(south.game, SEASONS[3])[south.at]).toBeLessThan(
      sunMap(south.game)[south.at],
    );
  });
});

/* ── building ─────────────────────────────────────────────────────────────── */

describe('building', () => {
  it('starts with a few cottages, a purse, a generator and its old line', () => {
    const game = createGame();
    expect(game.spec).toBe(TERN);
    expect(game.coins).toBe(TERN.coins);
    expect(homes(game).every((h) => h.tier === 1 && h.good === 0)).toBe(true);
    const kinds = game.things.filter(Boolean).map((t) => t.kind);
    expect(kinds.filter((k) => k === 'generator')).toHaveLength(1);
    expect(
      game.things.filter((t) => t?.kind === 'cable').every((t) => t.old),
    ).toBe(true);
    expect(kinds.some((k) => k === 'panel' || k === 'battery')).toBe(false);
    expect(game.unlocked).toEqual([]);
  });

  it('charges for what is put down and gives it all back when it is taken up', () => {
    const game = createGame();
    const [a, b] = clearPatch(game, 2);
    expect(place(game, 'panel', a).ok).toBe(true);
    expect(place(game, 'cable', b).ok).toBe(true);
    expect(game.coins).toBe(TERN.coins - KINDS.panel.cost - KINDS.cable.cost);
    expect(remove(game, a)).toMatchObject({
      ok: true,
      kind: 'panel',
      coins: KINDS.panel.cost,
    });
    expect(remove(game, b).ok).toBe(true);
    expect(game.coins).toBe(TERN.coins);
  });

  it('refuses the sea, an occupied tile, a village plot, an empty purse and a locked building', () => {
    const game = createGame();
    const sea = game.terrain.findIndex((t) => t === TERRAIN.WATER);
    const free = clearPatch(game, 1)[0];
    expect(canPlace(game, 'panel', sea)).toMatchObject({
      ok: false,
      reason: 'water',
    });
    expect(canPlace(game, 'panel', game.plots[0])).toMatchObject({
      ok: false,
      reason: 'occupied',
    });
    expect(canPlace(game, 'panel', game.plots[game.houses])).toMatchObject({
      reason: 'reserved',
    });
    const tree = game.things.findIndex((t) => t?.kind === 'tree');
    expect(canPlace(game, 'panel', tree)).toMatchObject({
      ok: false,
      reason: 'blocked',
    });
    expect(canPlace(game, 'house', free).ok).toBe(false);
    expect(canPlace(game, 'generator', free).ok).toBe(false);
    for (const kind of LOCKED) {
      expect(isUnlocked(game, kind)).toBe(false);
      expect(canPlace(game, kind, free)).toMatchObject({
        ok: false,
        reason: 'locked',
      });
      expect(canPlace(game, kind, free).message).toMatch(/^Not yet/);
    }
    game.coins = 10;
    expect(canPlace(game, 'panel', free)).toMatchObject({
      ok: false,
      reason: 'coins',
    });
    const before = serialize(game);
    expect(place(game, 'panel', sea).ok).toBe(false);
    expect(serialize(game)).toEqual(before);
  });

  it('brings along what was unlocked on other islands, and nothing that was not', () => {
    const game = createGame({
      spec: ISLANDS[1],
      unlocked: ['turbine', 'nonsense'],
    });
    expect(game.unlocked).toEqual(['turbine']);
    expect(canPlace(game, 'turbine', clearPatch(game, 1)[0]).ok).toBe(true);
    expect(isUnlocked(game, 'bank')).toBe(false);
  });

  it('clears scenery for a price, never removes a home, and gives nothing for the old line', () => {
    const game = createGame();
    const tree = game.things.findIndex((t) => t?.kind === 'tree');
    expect(canRemove(game, tree)).toMatchObject({
      ok: true,
      coins: -KINDS.tree.clearCost,
    });
    expect(remove(game, tree).ok).toBe(true);
    expect(remove(game, game.plots[0])).toMatchObject({
      ok: false,
      reason: 'house',
    });
    expect(remove(game, tree)).toMatchObject({ ok: false, reason: 'empty' });
    const old = game.things.findIndex((t) => t?.kind === 'cable');
    expect(canRemove(game, old)).toMatchObject({ ok: true, coins: 0 });
    game.coins = 0;
    const rock = game.things.findIndex((t) => t?.kind === 'rock');
    expect(remove(game, rock)).toMatchObject({ ok: false, reason: 'coins' });
  });

  it('keeps the generator until the village has gone a day without it', () => {
    const game = createGame();
    const at = generatorTile(game);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(canRemove(game, at)).toMatchObject({ ok: false, reason: 'needed' });
    game.goals.quiet = true;
    const purse = game.coins;
    expect(remove(game, at)).toMatchObject({
      ok: true,
      coins: KINDS.generator.scrap,
    });
    expect(game.coins).toBe(purse + KINDS.generator.scrap);
    expect(generatorTile(game)).toBe(-1);
    expect(game.flow.litHouses).toBe(0);
  });

  it('costs nothing and locks nothing in free build', () => {
    const game = createGame({ spec: FREE_BUILD });
    game.coins = 0;
    const [a, b, c] = clearPatch(game, 3);
    for (const [kind, idx] of [
      ['bank', a],
      ['turbine', b],
      ['tracker', c],
    ]) {
      expect(place(game, kind, idx).ok).toBe(true);
    }
    expect(game.coins).toBe(0);
    expect(canRemove(game, generatorTile(game)).ok).toBe(true);
    expect(nextGoal(game)).toBeNull();
    expect(runHours(game, 30).filter((e) => e.type === 'goal')).toEqual([]);
  });
});

/* ── wiring ───────────────────────────────────────────────────────────────── */

describe('networks', () => {
  it('joins things that touch, and nothing across a gap or a diagonal', () => {
    const things = new Array(16).fill(null);
    things[0] = { kind: 'panel' };
    things[1] = { kind: 'cable' };
    things[2] = { kind: 'house', order: 0, tier: 1 };
    things[3] = { kind: 'generator' };
    things[9] = { kind: 'bank', charge: 0 };
    things[15] = { kind: 'turbine' };
    things[14] = { kind: 'tracker' };
    things[10] = { kind: 'tree' };
    const { netOf, nets } = findNetworks(things, 4);
    expect(nets).toHaveLength(3);
    expect(netOf[10]).toBe(-1);
    expect(nets[netOf[0]]).toMatchObject({
      panels: [0],
      cables: [1],
      houses: [2],
      generators: [3],
    });
    expect(nets[netOf[9]]).toMatchObject({ stores: [9], houses: [] });
    expect(nets[netOf[15]].turbines).toEqual([15]);
    expect(nets[netOf[15]].panels).toEqual([14]);
  });

  it('marks what can and cannot reach a home', () => {
    const game = bareGame();
    const run = clearRun(game, 4);
    place(game, 'panel', run[3]);
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

describe('the generator', () => {
  it('covers whatever is short, up to what it can make, and burns fuel for it', () => {
    const game = openGame();
    const demand = START_HOUSES * loadAt(1, 0);
    const purse = game.coins;
    setTime(game, 20);
    step(game, 2);
    expect(game.flow.dieselKw).toBeCloseTo(demand);
    expect(game.flow.litHouses).toBe(START_HOUSES);
    expect(game.things[generatorTile(game)].running).toBe(true);
    expect(game.today.diesel).toBeCloseTo(demand * 2, 6);
    expect(game.today.fuel).toBeCloseTo(demand * 2 * FUEL_PER_KWH, 6);
    // The village pays for the power; the fuel comes out of that.
    expect(game.coins - purse).toBeCloseTo(
      demand * 2 * (TIERS[1].pays - FUEL_PER_KWH),
      6,
    );
    expect(game.coins).toBeGreaterThan(purse);
  });

  it('cannot carry a village bigger than it was built for', () => {
    const game = openGame();
    for (const home of homes(game)) home.tier = 2;
    setTime(game, 19);
    step(game, 0.01);
    // Three houses want 3.3 kW in the evening; the generator makes 2.
    expect(game.flow.demandKw).toBeCloseTo(3.3);
    expect(game.flow.dieselKw).toBeCloseTo(TERN.generatorKw);
    expect(game.flow.litHouses).toBe(1);
  });

  it('stands down as the sun comes in, and is silent when the sun covers it all', () => {
    const game = openGame();
    const run = clearPatch(game, 4);
    for (const idx of run) place(game, 'panel', idx);
    setTime(game, 12);
    step(game, 0.01);
    expect(game.flow.solarKw).toBeCloseTo(4, 1);
    step(game, 1);
    expect(game.flow.dieselKw).toBe(0);
    expect(game.things[generatorTile(game)].running).toBe(false);
    expect(game.today.diesel).toBe(0);
    expect(game.today.clean).toBeCloseTo(game.today.delivered, 6);
    expect(describeTile(game, generatorTile(game)).lines[0]).toBe('Silent.');
    setTime(game, 6.5);
    step(game, 0.01);
    // Early morning: the panels make a little, the generator the rest.
    expect(game.flow.solarKw).toBeGreaterThan(0);
    expect(game.flow.dieselKw).toBeCloseTo(
      game.flow.demandKw - game.flow.solarKw,
      6,
    );
    expect(describeTile(game, generatorTile(game)).lines[0]).toMatch(
      /^Running/,
    );
  });

  it('is asked only after the batteries', () => {
    const game = openGame();
    const [a] = clearPatch(game, 1);
    place(game, 'battery', a);
    game.things[a].charge = 4;
    setTime(game, 22);
    step(game, 1);
    expect(game.flow.dieselKw).toBe(0);
    expect(game.flow.chargingKw).toBeLessThan(0);
    expect(game.things[a].charge).toBeCloseTo(4 - 1.2, 6);
    runHours(game, 4);
    // Flat: now it is the generator's turn.
    expect(game.things[a].charge).toBeCloseTo(0, 6);
    expect(game.flow.dieselKw).toBeCloseTo(1.2);
    expect(game.flow.litHouses).toBe(START_HOUSES);
  });

  it('never charges a battery', () => {
    const game = openGame();
    const [a] = clearPatch(game, 1);
    place(game, 'battery', a);
    setTime(game, 20);
    runHours(game, 6);
    expect(game.things[a].charge).toBe(0);
  });
});

describe('power', () => {
  it('pays for exactly what is delivered, at the price of the homes it went to', () => {
    const game = bareGame();
    const run = clearRun(game, 5);
    place(game, 'cable', run[0]);
    for (const idx of run.slice(1)) place(game, 'panel', idx);
    game.goals = Object.fromEntries(GOALS.map((g) => [g.key, true]));
    let purse = game.coins;
    setTime(game, 11);
    step(game, 2);
    const demand = START_HOUSES * 0.4;
    expect(game.coins - purse).toBeCloseTo(demand * 2 * TIERS[1].pays, 6);
    expect(game.today.clean).toBeCloseTo(demand * 2, 6);

    // One of the three becomes a house: it pays more for what it takes.
    homes(game)[0].tier = 2;
    purse = game.coins;
    setTime(game, 11);
    step(game, 1);
    expect(game.coins - purse).toBeCloseTo(
      0.35 * TIERS[2].pays + 0.8 * TIERS[1].pays,
      6,
    );
  });

  it('pays nothing for panels that reach no home', () => {
    const game = bareGame();
    const run = clearRun(game, 4);
    place(game, 'panel', run[2]);
    place(game, 'panel', run[3]);
    const purse = game.coins;
    setTime(game, 10);
    step(game, 4);
    expect(game.coins).toBe(purse);
    expect(game.flow.solarKw).toBeGreaterThan(0);
    expect(game.flow.deliveredKw).toBe(0);
  });

  it('stores the spare by day and hands it back after dark', () => {
    const game = bareGame();
    const run = clearRun(game, 6);
    place(game, 'cable', run[0]);
    place(game, 'battery', run[1]);
    for (const idx of run.slice(2)) place(game, 'panel', idx);
    setTime(game, 9);
    runHours(game, 6);
    const battery = game.things[run[1]];
    expect(battery.charge).toBeCloseTo(KINDS.battery.capacityKwh, 3);
    setTime(game, 19);
    step(game, 0.5);
    expect(game.flow.litHouses).toBe(START_HOUSES);
    expect(battery.charge).toBeCloseTo(
      KINDS.battery.capacityKwh - 0.5 * 1.2,
      3,
    );
    runHours(game, 8);
    expect(battery.charge).toBeCloseTo(0, 6);
    expect(game.flow.litHouses).toBe(0);
  });

  it('fills a battery and a bank together, each no faster than its rate nor past its ends', () => {
    const game = bareGame();
    game.unlocked = [...LOCKED];
    const run = clearRun(game, 9);
    place(game, 'battery', run[0]);
    place(game, 'bank', run[1]);
    for (const idx of run.slice(2)) place(game, 'panel', idx);
    const battery = game.things[run[0]];
    const bank = game.things[run[1]];
    setTime(game, 12);
    step(game, 1);
    expect(battery.charge).toBeLessThanOrEqual(KINDS.battery.rateKw + 1e-9);
    expect(bank.charge).toBeLessThanOrEqual(KINDS.bank.rateKw + 1e-9);
    expect(bank.charge).toBeGreaterThan(battery.charge);
    runHours(game, 5);
    setTime(game, 9);
    runHours(game, 8);
    expect(battery.charge).toBeCloseTo(KINDS.battery.capacityKwh, 2);
    expect(bank.charge).toBeLessThanOrEqual(KINDS.bank.capacityKwh + 1e-9);
    expect(game.flow.capacityKwh).toBe(
      KINDS.battery.capacityKwh + KINDS.bank.capacityKwh,
    );
    setTime(game, 22);
    runHours(game, 60);
    expect(battery.charge).toBeGreaterThanOrEqual(0);
    expect(bank.charge).toBeGreaterThanOrEqual(0);
  });

  it('shares power out a whole home at a time, oldest first', () => {
    const game = bareGame();
    const run = clearRun(game, 2);
    place(game, 'cable', run[0]);
    place(game, 'panel', run[1]);
    setTime(game, 12);
    step(game, 0.01);
    expect(game.flow.litHouses).toBe(2);
    expect(homes(game).map((h) => h.lit)).toEqual([true, true, false]);
  });

  it('makes less under cloud, on the day the cloud is', () => {
    const spec = ISLANDS[2];
    let cloudy = 2;
    while (skyOf(spec, cloudy).key !== 'cloudy') cloudy += 1;
    let clear = 2;
    while (skyOf(spec, clear).key !== 'clear') clear += 1;
    const game = bareGame(spec);
    const run = clearRun(game, 3);
    place(game, 'cable', run[0]);
    place(game, 'panel', run[1]);
    place(game, 'panel', run[2]);
    game.time = (clear - 1) * 24 + 12;
    step(game, 0.01);
    expect(game.flow.sky).toBe('clear');
    expect(game.flow.solarKw).toBeCloseTo(2, 2);
    game.time = (cloudy - 1) * 24 + 12;
    step(game, 0.01);
    expect(game.flow.sky).toBe('cloudy');
    expect(game.flow.solarKw).toBeCloseTo(2 * SKIES.cloudy.sun, 2);
  });

  it('gets more from a tracking panel in the morning, and from a turbine at night', () => {
    const game = bareGame();
    game.unlocked = [...LOCKED];
    const run = clearRun(game, 3);
    place(game, 'cable', run[0]);
    place(game, 'tracker', run[1]);
    setTime(game, 8);
    step(game, 0.01);
    expect(game.flow.solarKw).toBeCloseTo(
      KINDS.tracker.peakKw * trackingFactor(8.01),
      2,
    );
    expect(game.flow.solarKw).toBeGreaterThan(sunFactor(8) * 1.5);
    expect(game.flow.peakKw).toBeCloseTo(KINDS.tracker.peakKw);
    remove(game, run[1]);
    place(game, 'turbine', run[1]);
    setTime(game, 2);
    step(game, 0.01);
    expect(game.flow.solarKw).toBe(0);
    expect(game.flow.windKw).toBeGreaterThan(0);
    expect(describeTile(game, run[1]).title).toBe('Wind turbine');
  });

  it('catches more wind on the beach than inland', () => {
    const game = bareGame();
    game.unlocked = [...LOCKED];
    const sand = game.terrain.findIndex(
      (t, idx) => t === TERRAIN.SAND && !game.things[idx],
    );
    const grass = game.terrain.findIndex(
      (t, idx) =>
        t === TERRAIN.GRASS && !game.things[idx] && !game.plots.includes(idx),
    );
    game.things[sand] = { kind: 'turbine' };
    game.wiring = null;
    setTime(game, 2);
    step(game, 0.01);
    const onBeach = game.flow.windKw;
    game.things[sand] = null;
    game.things[grass] = { kind: 'turbine' };
    game.wiring = null;
    step(game, 0.01);
    expect(game.flow.windKw).toBeCloseTo(onBeach * INLAND_WIND, 2);
    expect(describeTile(game, grass).lines.join(' ')).toMatch(/Inland/);
  });

  it('gives the same day whether it is stepped in frames or in one go', () => {
    const build = () => {
      const game = openGame();
      const run = clearPatch(game, 7);
      place(game, 'battery', run[0]);
      for (const idx of run.slice(1)) place(game, 'panel', idx);
      return game;
    };
    const a = build();
    const b = build();
    step(a, 24);
    for (let i = 0; i < 24 * 240; i += 1) step(b, 1 / 240);
    expect(a.time).toBeCloseTo(b.time, 6);
    expect(a.coins).toBeCloseTo(b.coins, 0);
    expect(a.houses).toBe(b.houses);
    expect(a.yesterday.clean).toBeCloseTo(b.yesterday.clean, 2);
  });
});

/* ── homes ────────────────────────────────────────────────────────────────── */

describe('homes', () => {
  it('want power at different times of day, tier by tier', () => {
    expect(loadAt(1, 3)).toBe(0.4);
    expect(loadAt(1, 19)).toBe(0.4);
    expect(loadAt(2, 12)).toBe(0.35);
    expect(loadAt(2, 17)).toBe(1.1);
    expect(loadAt(2, 21.9)).toBe(1.1);
    expect(loadAt(2, 22)).toBe(0.35);
    expect(loadAt(3, 2)).toBe(0.9);
    expect(loadAt(3, 12)).toBe(1.3);
    expect(loadAt(3, 19)).toBe(1.2);
    expect(loadAt(3, 23.5)).toBe(0.9);
    const energy = (tier) => {
      let kwh = 0;
      for (let h = 0; h < 24; h += 0.25) kwh += loadAt(tier, h) * 0.25;
      return kwh;
    };
    expect(energy(1)).toBeCloseTo(9.6);
    expect(energy(2)).toBeGreaterThan(energy(1));
    expect(energy(3)).toBeGreaterThan(energy(2) * 1.5);
    expect(TIERS[3].pays).toBeGreaterThan(TIERS[2].pays);
    expect(TIERS[2].pays).toBeGreaterThan(TIERS[1].pays);
  });

  it('say what they are and what they want', () => {
    const game = createGame();
    expect(describeTile(game, game.plots[0])).toMatchObject({
      title: 'Cottage',
    });
    homes(game)[0].tier = 2;
    const told = describeTile(game, game.plots[0]);
    expect(told.title).toBe('House');
    expect(told.lines.join(' ')).toMatch(/evening/);
    expect(describeTile(game, game.plots[game.houses]).title).toBe(
      'Village plot',
    );
    expect(describeTile(game, -1)).toBeNull();
  });
});

/* ── days, growth and goals ───────────────────────────────────────────────── */

// Close a day by hand: say how it went and step over daybreak.
function dawn(game, { served = 1, diesel = 0 } = {}) {
  game.today = {
    demanded: 10,
    delivered: 10 * served,
    clean: 10 * served - diesel,
    diesel,
    wasted: 0,
    earned: 0,
    fuel: 0,
  };
  // The sliver of real time that crosses daybreak adds next to nothing to
  // the day that was written in by hand.
  game.time = Math.floor((game.time - 6) / 24) * 24 + 29.9999;
  return step(game, 0.0002);
}

describe('days', () => {
  it('closes the books at daybreak and says how the day went', () => {
    const game = openGame();
    const events = runHours(game, 24);
    const morning = events.find((e) => e.type === 'morning');
    expect(morning).toMatchObject({
      day: 1,
      moved: true,
      houses: START_HOUSES + 1,
    });
    expect(morning.share).toBeCloseTo(1, 6);
    expect(morning.clean).toBe(0);
    expect(morning.fuel).toBeCloseTo(23 * 1.2 * FUEL_PER_KWH, 0);
    expect(game.yesterday).toMatchObject({
      day: 1,
      clean: 0,
      moved: true,
      upgraded: 0,
    });
    expect(dayOf(game.time)).toBe(2);
    expect(game.today.demanded).toBeLessThan(3);
  });

  it('grows on the generator alone only until the generator is outgrown', () => {
    const game = openGame();
    runHours(game, 24 * 12);
    // 2 kW carries five cottages. The sixth stretches it, and by then the
    // first of them are houses with an evening the generator can't cover.
    expect(game.houses).toBeGreaterThan(START_HOUSES);
    expect(game.houses).toBeLessThan(game.plots.length);
    expect(game.yesterday.share).toBeLessThan(GROW_AT);
    const before = game.houses;
    runHours(game, 24 * 3);
    expect(game.houses).toBe(before);
  });

  it('does not grow after a dark day, and does not count it toward moving up', () => {
    const game = openGame();
    const events = dawn(game, { served: 0.6 });
    expect(events.find((e) => e.type === 'morning')).toMatchObject({
      moved: false,
      upgraded: 0,
    });
    expect(game.houses).toBe(START_HOUSES);
    expect(homes(game).every((h) => h.good === 0)).toBe(true);
    dawn(game);
    expect(game.houses).toBe(START_HOUSES + 1);
    expect(homes(game).map((h) => h.good)).toEqual([1, 1, 1, 0]);
  });

  it('moves homes up after enough good days, oldest first, a few at a time', () => {
    const game = openGame();
    // Day 1: four homes. Day 2: five, which is enough for the first houses.
    dawn(game);
    expect(homes(game).map((h) => h.tier)).toEqual([1, 1, 1, 1]);
    const promised = dawnPlan(game);
    expect(promised.moves).toBe(true);
    expect(promised.upgrades).toHaveLength(UPGRADES_PER_DAWN);
    const first = game.things[game.plots[0]];
    const events = dawn(game);
    expect(events.filter((e) => e.type === 'upgrade')).toEqual(
      promised.upgrades.map((u) => ({ type: 'upgrade', ...u })),
    );
    expect(homes(game).map((h) => h.tier)).toEqual([2, 2, 1, 1, 1]);
    expect(homes(game)[0].good).toBe(0);
    expect(game.yesterday.upgraded).toBe(UPGRADES_PER_DAWN);
    // The home is a new object, so the picture knows to redraw it.
    expect(game.things[game.plots[0]]).not.toBe(first);
    // The next two in line have had their two good days by the next dawn.
    dawn(game);
    expect(homes(game).map((h) => h.tier)).toEqual([2, 2, 2, 2, 1, 1]);
  });

  it('stops at the island’s top tier, and makes nobody a townhouse until every plot is built', () => {
    const tern = openGame();
    for (let i = 0; i < 20; i += 1) dawn(tern);
    expect(tern.houses).toBe(tern.plots.length);
    expect(homes(tern).every((h) => h.tier === TERN.maxTier)).toBe(true);
    expect(villageComplete(tern)).toBe(true);
    expect(dawnPlan(tern)).toEqual({ moves: false, upgrades: [] });

    const pines = openGame(specById('pines'));
    let sawTownhouseEarly = false;
    for (let i = 0; i < 40 && !villageComplete(pines); i += 1) {
      dawn(pines);
      if (
        pines.houses < pines.plots.length &&
        homes(pines).some((h) => h.tier === 3)
      ) {
        sawTownhouseEarly = true;
      }
    }
    expect(sawTownhouseEarly).toBe(false);
    expect(villageComplete(pines)).toBe(true);
    expect(homes(pines).every((h) => h.tier === 3)).toBe(true);
  });

  it('unlocks a new building as the village reaches each milestone, once', () => {
    const game = openGame();
    const seen = [];
    for (let i = 0; i < 8; i += 1) {
      for (const e of dawn(game))
        if (e.type === 'unlock') seen.push([e.kind, game.houses]);
    }
    expect(seen.map(([kind]) => kind).sort()).toEqual([...LOCKED].sort());
    const at = Object.fromEntries(seen);
    expect(at.tracker).toBe(5);
    expect(at.bank).toBe(8);
    expect(homes(game).some((h) => h.tier >= 2)).toBe(true);
    expect(game.unlocked).toEqual(LOCKED);
    expect(canPlace(game, 'bank', clearPatch(game, 1)[0]).ok).toBe(true);
  });
});

describe('goals', () => {
  it('pays each once, in order as they are reached', () => {
    const game = openGame(TERN, 1000);
    expect(nextGoal(game).key).toBe('tap');
    const [a] = clearPatch(game, 1);
    place(game, 'panel', a);
    let events = step(game, 0.001);
    expect(events.filter((e) => e.type === 'goal').map((e) => e.key)).toEqual([
      'tap',
    ]);
    expect(step(game, 0.001).filter((e) => e.type === 'goal')).toEqual([]);
    expect(nextGoal(game).key).toBe('half');

    events = dawn(game, { diesel: 4 });
    expect(events.filter((e) => e.type === 'goal').map((e) => e.key)).toEqual([
      'half',
    ]);
    const purse = game.coins;
    events = dawn(game, { diesel: 0 });
    expect(events.filter((e) => e.type === 'goal').map((e) => e.key)).toEqual([
      'quiet',
    ]);
    expect(game.coins).toBeGreaterThanOrEqual(purse + 200);
    expect(canRemove(game, generatorTile(game)).ok).toBe(true);
  });

  it('does not count a dark day as a day without the generator', () => {
    const game = openGame();
    const events = dawn(game, { served: 0.5, diesel: 0 });
    expect(
      events.filter((e) => e.type === 'goal').map((e) => e.key),
    ).not.toContain('quiet');
  });

  it('finishes the island when every home is at its best and the generator has been silent a day', () => {
    const game = openGame();
    let done = null;
    for (let i = 0; i < 30 && !done; i += 1) {
      const events = dawn(game, { diesel: villageComplete(game) ? 0 : 3 });
      done = events.find((e) => e.type === 'done') || null;
      if (!done) expect(game.done).toBeNull();
    }
    expect(done).toMatchObject({ type: 'done' });
    expect(game.done.day).toBe(done.day);
    expect(game.goals.done).toBe(true);
    expect(GOALS[GOALS.length - 1].key).toBe('done');
    // It is said once.
    expect(dawn(game).filter((e) => e.type === 'done')).toEqual([]);
  });
});

/* ── a whole game ─────────────────────────────────────────────────────────── */

// A plain, sensible player: every hour it buys what the village is short of
// and puts it against the network, panels where the day's light is best.
function playThrough(spec, { days, unlocked = [] }) {
  const game = createGame({ spec, unlocked });
  const count = (kind) => game.things.filter((t) => t?.kind === kind).length;
  const site = (panel) => {
    const map = panel ? sunMap(game) : null;
    const seen = new Set();
    const queue = [];
    networks(game);
    game.things.forEach((t, idx) => {
      if (t && KINDS[t.kind].conducts && t.live) {
        seen.add(idx);
        queue.push(idx);
      }
    });
    let best = -1;
    while (queue.length) {
      for (const n of neighbours(queue.shift(), game.size)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (!canPlace(game, 'cable', n).ok) continue;
        if (!panel) return n;
        if (map[n] > 0.6 && (best < 0 || map[n] > map[best])) best = n;
      }
    }
    return best;
  };
  const buy = (kind) => {
    if (!isUnlocked(game, kind) || game.coins < KINDS[kind].cost) return false;
    const idx = site(kind === 'panel');
    return idx >= 0 && place(game, kind, idx).ok;
  };
  for (let hour = 0; hour < days * 24 && !game.done; hour += 1) {
    step(game, 1);
    let energy = 0;
    let night = 0;
    for (let h = 0; h < 24; h += 1) {
      const kw = homes(game).reduce(
        (sum, home) => sum + loadAt(home.tier, h),
        0,
      );
      energy += kw;
      if (h < 7 || h >= 17) night += kw;
    }
    for (let n = 0; n < 6; n += 1) {
      const panels = count('panel') / ((energy * 1.45) / 6.3);
      const storage =
        (count('battery') * 8 + count('bank') * 28) / (night * 1.05);
      if (panels >= 1 && storage >= 1) break;
      if (panels <= storage ? !buy('panel') : !(buy('bank') || buy('battery')))
        break;
    }
  }
  return game;
}

describe('a whole game', () => {
  it('can be played from the opening purse to an island that runs on the sun', () => {
    const game = playThrough(TERN, { days: 20 });
    expect(game.done).not.toBeNull();
    expect(game.done.day).toBeLessThanOrEqual(14);
    expect(villageComplete(game)).toBe(true);
    expect(game.yesterday.diesel).toBeLessThan(0.01);
    expect(game.unlocked).toEqual(LOCKED);
    // The sun did most of the work over the whole game, not just the last day.
    expect(game.totals.clean / game.totals.delivered).toBeGreaterThan(0.6);
  });

  it('is harder on the later islands, and still finishable', () => {
    const tern = playThrough(TERN, { days: 20 });
    for (const id of ['pines', 'windward', 'saltmarsh', 'northing']) {
      const game = playThrough(specById(id), { days: 60, unlocked: LOCKED });
      expect(game.done, id).not.toBeNull();
      expect(game.done.day, id).toBeGreaterThan(tern.done.day);
    }
  });
});

/* ── saving ───────────────────────────────────────────────────────────────── */

describe('saving', () => {
  it('comes back as it was, and plays on the same', () => {
    const game = playThrough(TERN, { days: 5 });
    const saved = JSON.parse(JSON.stringify(serialize(game)));
    expect(saved.island).toBe('tern');
    const back = deserialize(saved);
    expect(back).not.toBeNull();
    expect(serialize(back)).toEqual(saved);
    expect(back.spec).toBe(TERN);
    expect(back.houses).toBe(game.houses);
    expect(homes(back).map((h) => [h.tier, h.good])).toEqual(
      homes(game).map((h) => [h.tier, h.good]),
    );
    expect(back.things.map((t) => t?.kind)).toEqual(
      game.things.map((t) => t?.kind),
    );
    expect(back.things.filter((t) => t?.old).length).toBe(
      game.things.filter((t) => t?.old).length,
    );
    expect(back.unlocked).toEqual(game.unlocked);
    expect(back.goals).toEqual(game.goals);
    step(game, 30);
    step(back, 30);
    expect(back.coins).toBeCloseTo(game.coins, 0);
    expect(back.houses).toBe(game.houses);
  });

  it('remembers a finished island, and today’s island by its date', () => {
    const game = createGame();
    game.done = { day: 9 };
    expect(deserialize(serialize(game)).done).toEqual({ day: 9 });
    const today = createGame({ spec: todaysIsland('2026-11-10') });
    const saved = serialize(today);
    expect(saved).toMatchObject({ island: 'today', date: '2026-11-10' });
    const back = deserialize(saved);
    expect(back.spec.date).toBe('2026-11-10');
    expect(Array.from(back.terrain)).toEqual(Array.from(today.terrain));
  });

  it('turns away anything that is not a save', () => {
    const good = serialize(createGame());
    expect(deserialize(good)).not.toBeNull();
    const island = generateIsland(TERN);
    const sea = island.terrain.findIndex((t) => t === TERRAIN.WATER);
    const elsewhere = island.terrain.findIndex(
      (t, idx) =>
        t === TERRAIN.SAND &&
        idx !== island.generator &&
        !island.line.includes(idx),
    );
    for (const bad of [
      null,
      undefined,
      'a string',
      42,
      {},
      { ...good, v: 1 },
      { ...good, island: 'atlantis' },
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
      {
        ...good,
        things: [...good.things.filter((t) => t[1] !== 'g'), [elsewhere, 'g']],
      },
    ]) {
      expect(deserialize(bad)).toBeNull();
    }
    // A tier this island doesn't go to is brought back down, not believed.
    const tall = {
      ...good,
      things: good.things.map((t) =>
        t[1] === 'h' ? [t[0], 'h', t[2], t[3], 3, 0] : t,
      ),
    };
    expect(homes(deserialize(tall)).every((h) => h.tier === 1)).toBe(true);
  });
});

/* ── the archipelago ──────────────────────────────────────────────────────── */

describe('the archipelago', () => {
  it('opens nothing but the tutorial until the tutorial is done', () => {
    let progress = newProgress();
    expect(isTaught(progress)).toBe(false);
    expect(homeIsland(progress)).toBe(TUTORIAL);
    expect(isOpen(progress, TUTORIAL.id)).toBe(true);
    for (const id of [...ISLANDS.map((spec) => spec.id), 'free', 'today'])
      expect(isOpen(progress, id), id).toBe(false);
    // Not even for somebody who finished an island before there was one.
    const veteran = markDone(newProgress(), ISLANDS[0], 9);
    for (const id of [...ISLANDS.map((spec) => spec.id), 'free', 'today'])
      expect(isOpen(veteran, id), id).toBe(false);
    expect(homeIsland(veteran)).toBe(TUTORIAL);
    // What they did is kept, and is there again once the tutorial is done.
    const taught = markDone(veteran, TUTORIAL, 1);
    expect(isOpen(taught, ISLANDS[1].id)).toBe(true);
    expect(isOpen(taught, 'free')).toBe(true);

    progress = markDone(progress, TUTORIAL, 1);
    expect(isTaught(progress)).toBe(true);
    expect(homeIsland(progress)).toBe(ISLANDS[0]);
    expect(isOpen(progress, TUTORIAL.id)).toBe(true);
  });

  it('opens one island after another', () => {
    let progress = markDone(newProgress(), TUTORIAL, 1);
    expect(ISLANDS.map((spec) => isOpen(progress, spec.id))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(isOpen(progress, 'free')).toBe(false);
    expect(isOpen(progress, 'today')).toBe(false);
    progress = markDone(progress, ISLANDS[0], 9);
    expect(isOpen(progress, ISLANDS[1].id)).toBe(true);
    expect(isOpen(progress, ISLANDS[2].id)).toBe(false);
    expect(isOpen(progress, 'free')).toBe(true);
    expect(isOpen(progress, 'today')).toBe(true);
    expect(isOpen(progress, 'atlantis')).toBe(false);
    expect(nextIsland(ISLANDS[0].id)).toBe(ISLANDS[1]);
    expect(nextIsland(ISLANDS[ISLANDS.length - 1].id)).toBeNull();
    expect(nextIsland('free')).toBeNull();
  });

  it('keeps the best day for an island, and today’s only for today', () => {
    let progress = markDone(newProgress(), ISLANDS[0], 12);
    progress = markDone(progress, ISLANDS[0], 15);
    expect(progress.done.tern).toEqual({ day: 12 });
    progress = markDone(progress, ISLANDS[0], 8);
    expect(progress.done.tern).toEqual({ day: 8 });
    const monday = todaysIsland('2026-11-09');
    const tuesday = todaysIsland('2026-11-10');
    progress = markDone(progress, monday, 7);
    progress = markDone(progress, tuesday, 11);
    expect(progress.done.today).toEqual({ day: 11, date: '2026-11-10' });
    progress = markDone(progress, tuesday, 9);
    expect(progress.done.today).toEqual({ day: 9, date: '2026-11-10' });
  });

  it('carries unlocked buildings from island to island', () => {
    let progress = newProgress();
    progress = withUnlocked(progress, ['turbine']);
    progress = withUnlocked(progress, ['tracker', 'turbine', 'ray gun']);
    expect(progress.unlocked).toEqual(['tracker', 'turbine']);
    expect(withUnlocked(progress, ['tracker'])).toBe(progress);
  });

  it('reads progress back, dropping what is not progress', () => {
    expect(readProgress(null)).toEqual(newProgress());
    expect(readProgress('nonsense')).toEqual(newProgress());
    expect(
      readProgress({
        done: {
          tern: { day: 9.7 },
          pines: { day: 'soon' },
          today: { day: 5, date: '2026-11-10' },
          x: null,
        },
        unlocked: ['bank', 'bank', 'laser'],
      }),
    ).toEqual({
      done: { tern: { day: 9 }, today: { day: 5, date: '2026-11-10' } },
      unlocked: ['bank'],
    });
  });

  it('gives everyone the same island on the same day, and a different one the next', () => {
    const a = todaysIsland('2026-11-10');
    const b = todaysIsland('2026-11-10');
    const c = todaysIsland('2026-11-11');
    expect(a).toEqual(b);
    expect(a.seed).not.toBe(c.seed);
    expect(a).toMatchObject({
      id: 'today',
      date: '2026-11-10',
      daily: true,
      maxTier: 2,
    });
    expect(specById('today', '2026-11-10')).toEqual(a);
    expect(specById('free')).toBe(FREE_BUILD);
    expect(specById('tern')).toBe(TERN);
    expect(specById('atlantis')).toBeNull();
    const ids = ISLANDS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ── the tutorial ─────────────────────────────────────────────────────────── */

// What the running game would report having seen the player do.
const fresh = () => ({
  tool: 'look',
  selected: -1,
  looked: false,
  speed: 1,
  paused: false,
});

// The player the lesson hopes for: it does what each step points at, and
// nothing else. Returns the keys of the steps as they were passed.
function followLesson(game, seen = fresh(), upTo = Infinity) {
  const passed = [];
  for (let guard = 0; guard < 200 && inLesson(game); guard += 1) {
    passed.push(...advanceLesson(game, seen));
    const now = lessonNow(game, seen);
    if (!now || now.index >= upTo) break;
    if (now.key === 'look') seen.looked = true;
    else if (now.point?.tool) seen.tool = now.point.tool;
    else if (now.point?.speed) seen.speed = now.point.speed;
    else if (now.tiles.length) {
      const idx = now.tiles[0];
      if (seen.tool === 'look') seen.selected = idx;
      else if (seen.tool === 'remove') expect(remove(game, idx).ok).toBe(true);
      else expect(place(game, seen.tool, idx).ok).toBe(true);
    } else if (!now.hold) step(game, 0.5);
    else throw new Error(`the lesson points at nothing in "${now.key}"`);
  }
  passed.push(...advanceLesson(game, seen));
  return passed;
}

describe('the tutorial island', () => {
  it('is drawn by hand: two cottages, a generator on the beach, and its line', () => {
    const island = generateIsland(TUTORIAL);
    const { size } = island;
    expect(island.terrain).toHaveLength(size * size);
    expect(TUTORIAL.map).toHaveLength(size);
    for (const row of TUTORIAL.map) expect(row).toHaveLength(size);
    // Sea all the way round, and the generator on sand beside it.
    for (let i = 0; i < size; i += 1) {
      for (const idx of [
        indexOf(i, 0, size),
        indexOf(i, size - 1, size),
        indexOf(0, i, size),
        indexOf(size - 1, i, size),
      ])
        expect(island.terrain[idx]).toBe(TERRAIN.WATER);
    }
    expect(island.terrain[island.generator]).toBe(TERRAIN.SAND);
    expect(island.terrain[island.pier]).toBe(TERRAIN.WATER);
    expect(neighbours(island.generator, size)).toContain(island.pier);
    expect(island.plots).toHaveLength(2);
    for (const idx of island.plots)
      expect(island.terrain[idx]).toBe(TERRAIN.GRASS);
    // The same every time.
    expect(generateIsland(TUTORIAL)).toEqual(island);

    const game = createGame({ spec: TUTORIAL });
    expect(game.houses).toBe(2);
    expect(game.coins).toBe(TUTORIAL.coins);
    expect(hourOf(game.time)).toBe(TUTORIAL.startHour);
    // Lit from the first minute, by the generator.
    const { nets } = networks(game);
    const net = nets.find((n) => n.houses.length);
    expect(net.houses).toHaveLength(2);
    expect(net.generators).toEqual([island.generator]);
    expect(game.flow.dieselKw).toBeCloseTo(0.8, 5);
    expect(homes(game).every((home) => home.lit)).toBe(true);
    // And never a cloud.
    for (let day = 1; day <= 30; day += 1)
      expect(skyOf(TUTORIAL, day)).toBe(SKIES.clear);
  });

  it('marks the ground the lesson points at, and the marks are where it says', () => {
    const game = createGame({ spec: TUTORIAL });
    const { size, marks } = game;
    expect(Object.keys(marks).sort()).toEqual(['a', 'b', 'c', 'e', 'tree']);
    expect(marks.a).toHaveLength(1);
    expect(marks.b).toHaveLength(2);
    expect(marks.c).toHaveLength(1);
    expect(marks.e).toHaveLength(2);
    // Everything but the tree is room to build.
    for (const idx of [...marks.a, ...marks.b, ...marks.c, ...marks.e])
      expect(canPlace(game, 'cable', idx).ok).toBe(true);
    expect(game.things[marks.tree[0]].kind).toBe('tree');
    // The first panel stands apart from the line, with one tile between.
    const old = (idx) => game.things[idx]?.kind === 'cable';
    expect(neighbours(marks.a[0], size).some(old)).toBe(false);
    expect(neighbours(marks.c[0], size)).toContain(marks.a[0]);
    expect(neighbours(marks.c[0], size).some(old)).toBe(true);
    // The next two touch it, and the batteries touch the panels.
    for (const idx of marks.b)
      expect(neighbours(idx, size)).toContain(marks.a[0]);
    const panels = new Set([...marks.a, ...marks.b]);
    for (const idx of marks.e)
      expect(neighbours(idx, size).some((n) => panels.has(n))).toBe(true);
  });

  it('has the marked tree’s shadow on one panel at the hour the clock is held', () => {
    const game = createGame({ spec: TUTORIAL });
    const dir = sunDirection(game.time);
    const { marks } = game;
    const shaded = [...marks.a, ...marks.b].filter((idx) =>
      isShaded(game, idx, dir),
    );
    expect(shaded).toHaveLength(1);
    expect(marks.b).toContain(shaded[0]);
    // It is that tree and no other: take it away and the shadow goes.
    const before = sunMap(game)[shaded[0]];
    game.coins = 1000;
    remove(game, marks.tree[0]);
    expect(isShaded(game, shaded[0], dir)).toBe(false);
    expect(sunMap(game)[shaded[0]]).toBeGreaterThan(before + 0.1);
  });

  it('has a lesson in place of goals, and finishes like any other island', () => {
    const game = createGame({ spec: TUTORIAL });
    expect(nextGoal(game)).toBeNull();
    // Nothing is paid for the goals an island this small is born meeting.
    expect(step(game, 1).filter((e) => e.type === 'goal')).toEqual([]);
    expect(game.coins).toBeLessThan(TUTORIAL.coins + 10);
    expect(specById('first')).toBe(TUTORIAL);
    expect(isOpen(newProgress(), 'first')).toBe(true);
    // Finishing it is what opens the first island, and leads to it.
    expect(nextIsland('first')).toBe(ISLANDS[0]);
    expect(isOpen(newProgress(), ISLANDS[0].id)).toBe(false);
    const taught = markDone(newProgress(), TUTORIAL, 1);
    expect(isOpen(taught, ISLANDS[0].id)).toBe(true);
    expect(isOpen(taught, ISLANDS[1].id)).toBe(false);
  });
});

describe('the lesson', () => {
  it('is only on the tutorial island', () => {
    const game = createGame({ spec: TERN });
    expect(game.lesson).toBeNull();
    expect(inLesson(game)).toBe(false);
    expect(lessonHolds(game)).toBe(false);
    expect(lessonNow(game, fresh())).toBeNull();
    expect(advanceLesson(game, fresh())).toEqual([]);
    expect(lessonSteps(game)).toEqual([]);
  });

  it('says one short thing at a time', () => {
    const keys = LESSON.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of LESSON) {
      expect(s.title.length, s.key).toBeLessThanOrEqual(24);
      expect(s.say.length, s.key).toBeLessThanOrEqual(64);
      if (typeof s.more === 'string')
        expect(s.more.length, s.key).toBeLessThanOrEqual(64);
    }
    // Only the last lets the clock run.
    expect(LESSON.map((s) => Boolean(s.hold))).toEqual([
      ...LESSON.slice(1).map(() => true),
      false,
    ]);
  });

  it('points at the tool first and the ground second', () => {
    const game = createGame({ spec: TUTORIAL });
    const seen = fresh();
    expect(lessonNow(game, seen)).toMatchObject({
      index: 0,
      total: LESSON.length,
      key: 'look',
      hold: true,
      point: null,
      tiles: [],
    });
    // Nothing moves on until the thing has been done.
    expect(advanceLesson(game, seen)).toEqual([]);
    seen.looked = true;
    expect(advanceLesson(game, seen)).toEqual(['look']);
    expect(lessonNow(game, seen)).toMatchObject({
      key: 'generator',
      point: null,
      tiles: [generatorTile(game)],
    });
    // With something else in hand, the looking tool is pointed at instead.
    seen.tool = 'panel';
    expect(lessonNow(game, seen)).toMatchObject({
      point: { tool: 'look' },
      tiles: [],
    });
    seen.tool = 'look';
    seen.selected = generatorTile(game);
    expect(advanceLesson(game, seen)).toEqual(['generator']);
    expect(lessonNow(game, seen)).toMatchObject({
      key: 'panel',
      point: { tool: 'panel' },
      tiles: [],
    });
    seen.tool = 'panel';
    expect(lessonNow(game, seen)).toMatchObject({
      point: null,
      tiles: game.marks.a,
    });
    expect(lessonHolds(game)).toBe(true);
  });

  it('shows each thing it teaches happen', () => {
    const game = createGame({ spec: TUTORIAL });
    const seen = fresh();
    followLesson(game, seen, 3);
    // A panel on its own in the field: making power, and helping nobody.
    expect(lessonNow(game, seen).key).toBe('line');
    expect(game.things[game.marks.a[0]].kind).toBe('panel');
    expect(game.things[game.marks.a[0]].live).toBe(false);
    expect(game.flow.dieselKw).toBeCloseTo(0.8, 5);
    // Wired in, the generator eases off...
    followLesson(game, seen, 4);
    expect(game.things[game.marks.a[0]].live).toBe(true);
    expect(game.flow.dieselKw).toBeGreaterThan(0.05);
    expect(game.flow.dieselKw).toBeLessThan(0.4);
    // ...and with two more it is silent, though one of them is in shade.
    followLesson(game, seen, 5);
    expect(lessonNow(game, seen).key).toBe('shade');
    expect(game.flow.dieselKw).toBe(0);
    expect(game.flow.shadedPanels).toBe(1);
    const dim = game.flow.solarKw;
    followLesson(game, seen, 6);
    expect(game.flow.shadedPanels).toBe(0);
    expect(game.flow.solarKw).toBeGreaterThan(dim * 1.25);
    // The clock has not moved, and nothing was burned while it waited.
    expect(hourOf(game.time)).toBe(TUTORIAL.startHour);
    expect(game.totals.fuel).toBe(0);
  });

  it('can be followed to an island that runs on the sun by the first dawn', () => {
    const game = createGame({ spec: TUTORIAL });
    const seen = fresh();
    const passed = followLesson(game, seen);
    expect(passed).toEqual(LESSON.map((s) => s.key));
    expect(inLesson(game)).toBe(false);
    expect(lessonNow(game, seen)).toBeNull();
    expect(game.done).toEqual({ day: 1 });
    expect(dayOf(game.time)).toBe(2);
    expect(game.yesterday.diesel).toBeLessThan(0.01);
    expect(game.totals.fuel).toBe(0);
    // It was paid for out of the opening purse, with nothing to wait for.
    expect(lessonSteps(game).every((s) => s.done)).toBe(true);
    // The generator can go back on the boat.
    expect(canRemove(game, generatorTile(game)).ok).toBe(true);
  });

  it('takes the state for the deed: steps already done are passed over', () => {
    const game = createGame({ spec: TUTORIAL });
    const seen = { ...fresh(), looked: true, selected: generatorTile(game) };
    // A player who goes their own way: three panels straight against the
    // old line, nowhere near the marks.
    const patch = clearPatch(game, 3);
    for (const idx of patch) expect(place(game, 'panel', idx).ok).toBe(true);
    expect(advanceLesson(game, seen)).toEqual([
      'look',
      'generator',
      'panel',
      'line',
      'more',
    ]);
    expect(lessonNow(game, seen).key).toBe('shade');
    // Told again, differently, when a day goes by on diesel.
    game.lesson.step = LESSON.length - 1;
    const first = lessonNow(game, seen).more;
    for (const idx of patch) remove(game, idx);
    runHours(game, 24);
    expect(game.done).toBeNull();
    expect(lessonNow(game, seen).more).not.toBe(first);
    expect(lessonNow(game, seen).point).toEqual({ speed: 10 });
    expect(lessonNow(game, { ...seen, speed: 10 }).point).toBeNull();
    expect(lessonNow(game, { ...seen, speed: 10, paused: true }).point).toEqual(
      { speed: 10 },
    );
  });

  it('is saved with the island, part way through and finished', () => {
    const game = createGame({ spec: TUTORIAL });
    const seen = fresh();
    followLesson(game, seen, 5);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(game))));
    expect(back).not.toBeNull();
    expect(back.spec).toBe(TUTORIAL);
    expect(back.lesson).toEqual(game.lesson);
    expect(back.marks).toEqual(game.marks);
    expect(lessonNow(back, seen)).toEqual(lessonNow(game, seen));
    expect(hourOf(back.time)).toBe(TUTORIAL.startHour);
    // And it can be finished from there.
    followLesson(back, seen);
    expect(back.done).toEqual({ day: 1 });
    const done = deserialize(JSON.parse(JSON.stringify(serialize(back))));
    expect(inLesson(done)).toBe(false);
    expect(done.done).toEqual({ day: 1 });
    // A save that says nonsense about the lesson starts it over.
    const odd = { ...serialize(game), lesson: 'halfway' };
    expect(deserialize(odd).lesson).toEqual({ step: 0 });
  });
});
