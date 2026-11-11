// The parts of the workbench that can be held to account without a GPU:
// the unit conversions, the packing of a recipe into numbers, the recipe
// itself, the stamps a gesture makes, and the libraries.
//
// What can't be tested here is whether a plate looks right. What can is
// everything that would make it quietly wrong: a shader waiting on a number
// nobody supplies, a culture whose numbers break the explicit schemes'
// stability bounds on some grid, a recipe naming a culture that is gone, a
// link carrying something that isn't a plate.

import { describe, it, expect } from 'vitest';
import {
  createGrid,
  DISH,
  dryingFactor,
  hexToAbsorbance,
  hexToLinear,
  temperatureFactor,
  wetnessForAgar,
} from './units.js';
import {
  clockUniforms,
  CULTURE_DEFAULTS,
  lightAt,
  packLook,
  packPlate,
  refillHours,
  resolveCulture,
  SLOTS,
} from './pack.js';
import { CULTURES, KINDS, cultureById } from './cultures.js';
import { MEDIA, mediumById } from './media.js';
import { ADDITIONS, ADDITION_KINDS, additionById } from './additions.js';
import { OPENING_BENCH, RECIPES, recipeById } from './recipes.js';
import {
  cleanDish,
  createDish,
  decodeDish,
  encodeDish,
  MAX_HOURS,
  packDish,
  resolveMedium,
  slotsOf,
} from './recipe.js';
import {
  CLUMP,
  DEFAULT_DROP,
  dropRadius,
  DROPS,
  FULL,
  slotFor,
  SPOT_RADIUS,
  stampsFor,
  unmixed,
  WET_HOURS,
  wetDropsUnder,
} from './tools.js';
import {
  act,
  advance,
  begin,
  behind,
  draw,
  record,
  setEnv,
  settle,
} from './incubate.js';
import { randomDish, suitedTo } from './chance.js';
import {
  benchLayout,
  fitDistance,
  orbit,
  pickPlane,
  project,
} from './camera.js';
import { describeEvent, describePour, formatHours } from './format.js';
import { CULTURE_FRAGMENT } from './shaders/culture.js';
import { AGAR_FRAGMENT } from './shaders/agar.js';
import { WRINKLE_A_FRAGMENT, WRINKLE_B_FRAGMENT } from './shaders/wrinkle.js';
import { COMPOSE_FRAGMENT } from './shaders/display.js';

const ENV = { temperature: 30, humidity: 0.85, light: 'cycle' };
const SIZES = [256, 384, 512];

describe('units', () => {
  it('puts the agar’s radius on the grid with a margin', () => {
    for (const size of SIZES) {
      const grid = createGrid(size);
      expect(grid.dx * grid.radiusTexels).toBeCloseTo(DISH.radius, 6);
      expect(grid.radiusTexels).toBeLessThan(size / 2);
      expect(grid.chemSize).toBe(size / 2);
      expect(grid.dt * grid.stepsPerHour).toBeCloseTo(1, 9);
    }
  });

  it('keeps the same diffusion number at every resolution', () => {
    // dt goes as dx², so a diffusivity in mm²/h is the same fraction per
    // step on any grid: a recipe grows alike at 256 and at 512.
    const numbers = SIZES.map((size) => createGrid(size).diffusion(0.3));
    expect(numbers[0]).toBeCloseTo(numbers[1], 9);
    expect(numbers[1]).toBeCloseTo(numbers[2], 9);
  });

  it('holds a sugar’s diffusion under the half-grid’s stability limit', () => {
    for (const size of SIZES) {
      expect(createGrid(size).chemDiffusion(1.8)).toBeLessThan(0.25);
    }
  });

  it('grows nothing outside a culture’s temperatures and best at its optimum', () => {
    const t = { tMin: 8, tOpt: 32, tMax: 42 };
    expect(temperatureFactor(8, t)).toBe(0);
    expect(temperatureFactor(42, t)).toBe(0);
    expect(temperatureFactor(50, t)).toBe(0);
    expect(temperatureFactor(32, t)).toBeCloseTo(1, 6);
    expect(temperatureFactor(20, t)).toBeGreaterThan(0);
    expect(temperatureFactor(20, t)).toBeLessThan(temperatureFactor(28, t));
    // Lopsided: the fall past the optimum is the steeper side.
    expect(temperatureFactor(38, t)).toBeLessThan(temperatureFactor(26, t));
  });

  it('makes a softer plate a wetter one, all the way down', () => {
    let last = Infinity;
    for (let agar = 0.2; agar <= 3.2; agar += 0.1) {
      const wet = wetnessForAgar(agar);
      expect(wet).toBeLessThanOrEqual(last);
      expect(wet).toBeGreaterThan(0);
      expect(wet).toBeLessThanOrEqual(1);
      last = wet;
    }
    expect(wetnessForAgar(0.5)).toBeGreaterThan(4 * wetnessForAgar(1.5));
  });

  it('dries a plate faster in dry air', () => {
    expect(dryingFactor(0, 0.5)).toBe(1);
    expect(dryingFactor(48, 0.3)).toBeLessThan(dryingFactor(48, 0.95));
    expect(dryingFactor(48, 0.95)).toBeGreaterThan(0.85);
  });

  it('reads colours as linear light and as what they absorb', () => {
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToLinear('#000')).toEqual([0, 0, 0]);
    const blue = hexToAbsorbance('#2040ff');
    // A blue dye lets blue through and takes the red out.
    expect(blue[0]).toBeGreaterThan(blue[2]);
    expect(hexToAbsorbance('#ffffff').every((a) => a === 0)).toBe(true);
  });
});

/** Every `uniform` a shader declares. */
const uniformsOf = (source) =>
  [...source.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)].map((m) => m[1]);

describe('shaders are given every number they wait on', () => {
  // A uniform nobody sets is zero, and a zero is a plausible value for most
  // of these: the plate would simply grow wrong.
  const grid = createGrid(384);
  const medium = mediumById('broth');
  const packed = packPlate({
    slots: CULTURES.slice(0, 4),
    medium,
    env: ENV,
    grid,
    seed: 1,
  });
  const supplied = new Set([
    ...Object.keys(packed.u),
    ...Object.keys(
      clockUniforms({ softness: packed.softness, medium, env: ENV, hours: 3 }),
    ),
    // Set by the simulation itself for each step (simulation.js).
    ...['uB', 'uD', 'uAux', 'uC0', 'uC1', 'uC2', 'uWr', 'uWrA'],
    ...['uHours', 'uStep', 'uChemSize', 'uWrDt', 'uWrHours'],
  ]);

  it.each([
    ['culture', CULTURE_FRAGMENT],
    ['agar', AGAR_FRAGMENT],
    ['wrinkle, first pass', WRINKLE_A_FRAGMENT],
    ['wrinkle, second pass', WRINKLE_B_FRAGMENT],
  ])('%s', (_label, source) => {
    const declared = uniformsOf(source);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((name) => !supplied.has(name))).toEqual([]);
  });

  it('compose', () => {
    const look = new Set([
      ...Object.keys(packLook({ cultures: packed.cultures, medium })),
      ...[
        'uB',
        'uD',
        'uAux',
        'uC0',
        'uC1',
        'uC2',
        'uWr',
        'uChemSize',
        'uLightMode',
      ],
    ]);
    expect(
      uniformsOf(COMPOSE_FRAGMENT).filter((name) => !look.has(name)),
    ).toEqual([]);
  });
});

describe('packing', () => {
  it('gives one component per slot, and nothing to an empty one', () => {
    const grid = createGrid(384);
    const { u } = packPlate({
      slots: [cultureById('crimson')],
      medium: mediumById('broth'),
      env: ENV,
      grid,
      seed: 7,
    });
    for (const [name, value] of Object.entries(u)) {
      if (
        Array.isArray(value) &&
        name.startsWith('u') &&
        !/^uDiff|^uDecay/.test(name)
      ) {
        expect(value, name).toHaveLength(SLOTS);
      }
    }
    expect(u.uGrowD[0]).toBeGreaterThan(0);
    expect(u.uGrowD.slice(1)).toEqual([0, 0, 0]);
    expect(u.uGrowB.slice(1)).toEqual([0, 0, 0]);
    // Divisors stay away from zero for the empty slots.
    for (const name of [
      'uKn',
      'uCapB',
      'uCapD',
      'uPhTol',
      'uMotHalf',
      'uRaft',
    ]) {
      expect(
        u[name].every((x) => x > 0),
        name,
      ).toBe(true);
    }
  });

  it('keeps every culture on every medium inside the schemes’ limits, on every grid', () => {
    for (const size of SIZES) {
      const grid = createGrid(size);
      for (const medium of MEDIA) {
        for (const culture of CULTURES) {
          const { u } = packPlate({
            slots: [culture],
            medium,
            env: ENV,
            grid,
            seed: 1,
          });
          const tag = `${culture.id} on ${medium.id} at ${size}`;
          // Explicit diffusion over eight neighbours.
          expect(u.uMotB[0], tag).toBeLessThanOrEqual(0.2);
          // The upwind creep, at the culture's own thickness.
          expect(u.uCreep[0] * u.uCapD[0] ** 2, tag).toBeLessThanOrEqual(
            0.1 + 1e-9,
          );
          // Upwind drift with every face flowing out.
          expect(u.uTaxMax[0], tag).toBeLessThanOrEqual(0.26);
          // Rates are fractions per step.
          for (const name of [
            'uGrowB',
            'uGrowD',
            'uSettle',
            'uSettleStarve',
            'uSettleThin',
            'uLaunch',
            'uKill',
          ]) {
            expect(u[name][0], `${name} ${tag}`).toBeLessThanOrEqual(0.5);
            expect(u[name][0], `${name} ${tag}`).toBeGreaterThanOrEqual(0);
          }
          for (const d of [...u.uDiff0, ...u.uDiff1, ...u.uDiff2]) {
            expect(d, tag).toBeLessThan(0.25);
          }
          expect(u.uActive[0], tag).toBeLessThan(u.uCapD[0]);
          // A wrinkle is at least five texels across.
          expect(u.uWrQ2[0], tag).toBeLessThanOrEqual(
            ((2 * Math.PI) / 5) ** 2 + 1e-9,
          );
        }
      }
    }
  });

  it('holds a culture back on a medium that selects against it', () => {
    const grid = createGrid(384);
    const grow = (cultureId, mediumId) =>
      packPlate({
        slots: [cultureById(cultureId)],
        medium: mediumById(mediumId),
        env: ENV,
        grid,
        seed: 1,
      }).u.uGrowD[0];
    // Bile salts and the Gram-positives.
    expect(grow('gold', 'bile')).toBeLessThan(0.1 * grow('gold', 'broth'));
    expect(grow('crimson', 'bile')).toBeCloseTo(grow('crimson', 'broth'), 9);
    // 7.5 % salt: staphylococci shrug, most things stop.
    expect(grow('gold', 'mannitol')).toBeCloseTo(grow('gold', 'broth'), 9);
    expect(grow('crimson', 'mannitol')).toBeLessThan(
      0.1 * grow('crimson', 'broth'),
    );
    // And what came out of the sea does badly without it.
    expect(grow('lantern', 'broth')).toBeLessThan(0.5 * grow('lantern', 'sea'));
  });

  it('switches a pigment off above its temperature', () => {
    const grid = createGrid(384);
    const rate = (temperature) =>
      packPlate({
        slots: [cultureById('crimson')],
        medium: mediumById('broth'),
        env: { ...ENV, temperature },
        grid,
        seed: 1,
      }).u.uPigRate[0];
    expect(rate(28)).toBeGreaterThan(0);
    expect(rate(37)).toBe(0);
  });

  it('spreads a matrix producer wider on soft agar, and nothing else', () => {
    const grid = createGrid(384);
    const creep = (cultureId, agar) =>
      packPlate({
        slots: [{ ...cultureById(cultureId), creep: 0.01 }],
        medium: { ...mediumById('broth'), agar },
        env: ENV,
        grid,
        seed: 1,
      }).u.uCreep[0];
    expect(creep('corrugated', 0.6) / creep('corrugated', 1.5)).toBeGreaterThan(
      5,
    );
    const plain = { ...CULTURE_DEFAULTS, osmotic: 0, creep: 0.01 };
    const flat = (agar) =>
      packPlate({
        slots: [plain],
        medium: { ...mediumById('broth'), agar },
        env: ENV,
        grid,
        seed: 1,
      }).u.uCreep[0];
    expect(flat(0.6)).toBeCloseTo(flat(1.5), 9);
  });

  it('broadens a fold with age only for a culture that says so, and never narrows one', () => {
    const grid = createGrid(384);
    const pack = (id) =>
      packPlate({
        slots: [cultureById(id)],
        medium: mediumById('congo'),
        env: ENV,
        grid,
        seed: 1,
      }).u;
    // A plain colony has no folds to broaden.
    expect(pack('crimson').uWrCoarsen[0]).toBe(0);
    expect(pack('rosette').uWrCoarsen[0]).toBeGreaterThan(1);
    for (const culture of CULTURES) {
      const u = pack(culture.id);
      expect(u.uWrCoarsen[0], culture.id).toBeGreaterThanOrEqual(0);
      // Hours to divide by.
      expect(u.uWrAgeing[0], culture.id).toBeGreaterThanOrEqual(1);
      expect(u.uWrCore[0], culture.id).toBeGreaterThanOrEqual(0);
      expect(u.uWrCore[0], culture.id).toBeLessThanOrEqual(1);
      // An empty slot buckles like anything else would, and divides by one.
      expect(u.uWrAgeing.slice(1)).toEqual([1, 1, 1]);
      expect(u.uWrCore.slice(1)).toEqual([1, 1, 1]);
    }
    // Rosette keeps the drop it grew from flat.
    expect(pack('rosette').uWrCore[0]).toBe(0);
  });

  it('lets no culture share its ground for nothing', () => {
    const grid = createGrid(384);
    for (const culture of CULTURES) {
      const { u } = packPlate({
        slots: [culture],
        medium: mediumById('broth'),
        env: ENV,
        grid,
        seed: 1,
      });
      // Two cultures in one patch each slow the other: it is what sorts a
      // mixed drop into sectors, so none may opt out of it.
      expect(u.uKin[0], culture.id).toBeGreaterThan(0);
      expect(u.uKin[0], culture.id).toBeLessThanOrEqual(1);
    }
  });

  it('refills the surface in hours for a sugar and hardly at all on a lean plate', () => {
    expect(refillHours(1.8)).toBeGreaterThan(2);
    expect(refillHours(1.8)).toBeLessThan(6);
    expect(refillHours(0.2)).toBeGreaterThan(24);
  });

  it('dries the surface and tightens the films as the hours pass', () => {
    const medium = mediumById('broth');
    const at = (hours) =>
      clockUniforms({
        softness: 0.5,
        medium,
        env: { ...ENV, humidity: 0.4 },
        hours,
      });
    expect(at(72).uWet).toBeLessThan(at(0).uWet);
    expect(at(72).uWrEnv).toBeGreaterThan(at(0).uWrEnv);
  });

  it('keeps a twelve-hour day', () => {
    expect(lightAt('cycle', 3)).toBe(1);
    expect(lightAt('cycle', 15)).toBe(0);
    expect(lightAt('cycle', 27)).toBe(1);
    expect(lightAt('on', 15)).toBe(1);
    expect(lightAt('dark', 3)).toBe(0);
  });

  it('packs every look as colours between black and white', () => {
    for (const medium of MEDIA) {
      const cultures = CULTURES.slice(0, 4).map(resolveCulture);
      const look = packLook({ cultures, medium });
      for (const name of [
        'uAgarColor',
        'uAcidColor',
        'uAlkaliColor',
        'uClearColor',
        'uDyeColor',
      ]) {
        expect(look[name], name).toHaveLength(3);
        expect(
          look[name].every((x) => x >= 0 && x <= 1),
          name,
        ).toBe(true);
      }
      expect(look.uAgarOpacity).toBeGreaterThan(0);
      expect(look.uAgarOpacity).toBeLessThanOrEqual(1);
    }
  });
});

const HEX = /^#[0-9a-f]{6}$/i;

describe('the shelf', () => {
  it('names every culture once, and says what it is modelled on', () => {
    const ids = CULTURES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const kinds = new Set(KINDS.map((k) => k.kind));
    for (const culture of CULTURES) {
      expect(culture.name, culture.id).toBeTruthy();
      expect(culture.after, culture.id).toBeTruthy();
      expect(culture.blurb.length, culture.id).toBeGreaterThan(20);
      expect(kinds.has(culture.kind), culture.id).toBe(true);
      expect(cultureById(culture.id)).toBe(culture);
      if (culture.salt) expect(['needs', 'tolerates']).toContain(culture.salt);
      const look = resolveCulture(culture).look;
      for (const key of ['young', 'mature', 'sport', 'fluoresce', 'glow']) {
        if (look[key]) expect(look[key], `${culture.id}.${key}`).toMatch(HEX);
      }
      if (culture.secretes) expect(culture.secretes.color).toMatch(HEX);
    }
    for (const kind of kinds) {
      expect(
        CULTURES.some((c) => c.kind === kind),
        kind,
      ).toBe(true);
    }
  });

  it('only states parameters the model has', () => {
    // A misspelt key would be carried along and silently ignored.
    const known = new Set([
      ...Object.keys(CULTURE_DEFAULTS),
      ...['id', 'name', 'after', 'kind', 'blurb', 'notes', 'tags', 'salt'],
    ]);
    for (const culture of CULTURES) {
      for (const key of Object.keys(culture))
        expect(known.has(key), `${culture.id}.${key}`).toBe(true);
      for (const group of ['temp', 'ph', 'taxis', 'pigment', 'wrinkle']) {
        for (const key of Object.keys(culture[group] || {})) {
          expect(
            key in CULTURE_DEFAULTS[group],
            `${culture.id}.${group}.${key}`,
          ).toBe(true);
        }
      }
      for (const key of Object.keys(culture.look || {})) {
        expect(
          key in CULTURE_DEFAULTS.look || key === 'glowQuorum',
          `${culture.id}.look.${key}`,
        ).toBe(true);
      }
    }
  });

  it('names every medium and addition once', () => {
    for (const [list, lookup] of [
      [MEDIA, mediumById],
      [ADDITIONS, additionById],
    ]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const item of list) {
        expect(lookup(item.id)).toBe(item);
        expect(item.name).toBeTruthy();
        expect(item.after).toBeTruthy();
        expect(item.blurb.length).toBeGreaterThan(10);
      }
    }
    const kinds = new Set(ADDITION_KINDS.map((k) => k.kind));
    for (const item of ADDITIONS)
      expect(kinds.has(item.kind), item.id).toBe(true);
    for (const medium of MEDIA) {
      expect(medium.agar).toBeGreaterThanOrEqual(0.3);
      expect(medium.agar).toBeLessThanOrEqual(2.5);
      expect(medium.nutrient).toBeGreaterThan(0);
      expect(medium.look.color).toMatch(HEX);
    }
  });

  it('gives a source as a plain https link, or none', () => {
    const notes = [...CULTURES, ...MEDIA, ...ADDITIONS].flatMap(
      (x) => x.notes || [],
    );
    expect(notes.length).toBeGreaterThan(30);
    for (const note of notes) {
      expect(note.text.length).toBeGreaterThan(20);
      if (note.href) expect(note.href).toMatch(/^https:\/\/[^\s]+$/);
    }
  });

  it('has somewhere for everything to grow', () => {
    // Each culture does well on at least one medium on the shelf.
    const grid = createGrid(256);
    for (const culture of CULTURES) {
      const best = Math.max(
        ...MEDIA.map(
          (medium) =>
            packPlate({ slots: [culture], medium, env: ENV, grid, seed: 1 }).u
              .uGrowD[0] / grid.rate(resolveCulture(culture).growth),
        ),
      );
      expect(best, culture.id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('recipes', () => {
  it('pours a plate with nothing on it', () => {
    const dish = createDish('swarm');
    expect(dish.medium).toBe('swarm');
    expect(dish.events).toEqual([]);
    expect(dish.hours).toBe(0);
    expect(createDish('no-such-medium').medium).toBe('broth');
    expect(resolveMedium(dish).agar).toBe(mediumById('swarm').agar);
    expect(resolveMedium({ ...dish, agar: 1.1 }).agar).toBe(1.1);
  });

  it('lists a plate’s cultures in the order they arrived, four at most', () => {
    const dish = createDish('broth', {
      events: [
        { at: 0, do: 'spot', culture: 'crimson', x: 0, y: 0 },
        { at: 0, do: 'add', addition: 'sugar', x: 5, y: 5 },
        { at: 1, do: 'set', env: { temperature: 37 } },
        {
          at: 2,
          do: 'streak',
          culture: 'lemon',
          path: [
            [0, 0],
            [5, 5],
          ],
        },
        { at: 3, do: 'spot', culture: 'crimson', x: 9, y: 9 },
        { at: 4, do: 'lawn', culture: 'gold' },
        { at: 5, do: 'spot', culture: 'violet', x: 1, y: 1 },
        { at: 6, do: 'spot', culture: 'coral', x: 1, y: 1 },
      ],
    });
    expect(slotsOf(dish)).toEqual(['crimson', 'lemon', 'gold', 'violet']);
  });

  it('throws away what isn’t a plate and keeps what is', () => {
    const dish = cleanDish({
      medium: 'blood',
      agar: 99,
      nutrient: -4,
      hours: 1e9,
      seed: 42,
      env: { temperature: 400, humidity: 'damp', light: 'strobe' },
      events: [
        { at: 3, do: 'spot', culture: 'gold', x: 1.23456, y: -2 },
        { at: 1, do: 'spot', culture: 'not-a-culture', x: 0, y: 0 },
        { at: 2, do: 'add', addition: 'penicillin', x: 4, y: 4 },
        { at: 2, do: 'add', addition: 'napalm', x: 4, y: 4 },
        { at: 'soon', do: 'lawn', culture: 'lemon', density: 50 },
        { at: 5, do: 'streak', culture: 'lemon', x: 1, y: 1 },
        {
          at: 5,
          do: 'streak',
          culture: 'lemon',
          path: [
            [0, 0],
            ['a', 2],
            [3, 3],
          ],
        },
        { at: 6, do: 'set', env: { temperature: 37, nonsense: true } },
        { at: 7, do: 'set', env: {} },
        { at: 8, do: 'detonate' },
        null,
        'spot',
      ],
    });
    expect(dish.medium).toBe('blood');
    expect(dish.agar).toBe(2.5);
    expect(dish.nutrient).toBe(0.1);
    expect(dish.hours).toBe(MAX_HOURS);
    expect(dish.seed).toBe(42);
    expect(dish.env).toEqual({
      temperature: 45,
      humidity: 0.85,
      light: 'cycle',
    });
    expect(dish.events.map((e) => [e.at, e.do])).toEqual([
      [0, 'lawn'],
      [2, 'add'],
      [3, 'spot'],
      [5, 'streak'],
      [6, 'set'],
    ]);
    expect(dish.events[0].density).toBe(1);
    expect(dish.events[2].x).toBe(1.23);
    expect(dish.events[3].path).toEqual([
      [0, 0],
      [3, 3],
    ]);
    expect(dish.events[4].env).toEqual({ temperature: 37 });
  });

  it('never throws on rubbish', () => {
    for (const junk of [
      null,
      undefined,
      3,
      'plate',
      [],
      { events: 'many' },
      { medium: 7 },
    ]) {
      const dish = cleanDish(junk);
      expect(dish.medium).toBe('broth');
      expect(dish.events).toEqual([]);
    }
  });

  it('writes a plate down as only what departs from a fresh pour', () => {
    const fresh = createDish('broth');
    expect(Object.keys(packDish(fresh)).sort()).toEqual([
      'hours',
      'medium',
      'seed',
    ]);
    const changed = {
      ...fresh,
      agar: 0.8,
      held: true,
      env: { ...fresh.env, temperature: 37 },
    };
    expect(packDish(changed)).toMatchObject({
      agar: 0.8,
      held: true,
      env: { temperature: 37 },
    });
  });

  it('survives a trip through a link', () => {
    for (const recipe of RECIPES) {
      const dish = cleanDish({ ...recipe.dish, hours: recipe.start, seed: 99 });
      const text = encodeDish(dish);
      expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
      const back = decodeDish(text);
      expect(back.medium).toBe(dish.medium);
      expect(back.seed).toBe(99);
      expect(back.hours).toBe(dish.hours);
      expect(back.env).toEqual(dish.env);
      expect(back.events).toEqual(dish.events);
    }
  });

  it('reads anything else in a link as no plate at all', () => {
    for (const junk of [
      '',
      'hello',
      '%%%',
      btoa('[1,2,3]'),
      btoa('{"medium":"plutonium"}'),
    ]) {
      expect(decodeDish(junk)).toBeNull();
    }
  });
});

describe('the recipes on the shelf', () => {
  it('name things that exist, and keep to four cultures', () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const recipe of RECIPES) {
      expect(recipeById(recipe.id)).toBe(recipe);
      expect(recipe.name).toBeTruthy();
      expect(recipe.watch.length).toBeGreaterThan(30);
      expect(mediumById(recipe.dish.medium), recipe.id).toBeTruthy();
      const cleaned = cleanDish({ ...recipe.dish, hours: recipe.start });
      // Nothing in it was dropped as unknown or malformed.
      expect(cleaned.events, recipe.id).toHaveLength(recipe.dish.events.length);
      const cultures = new Set(
        recipe.dish.events.filter((e) => e.culture).map((e) => e.culture),
      );
      expect(cultures.size, recipe.id).toBeLessThanOrEqual(SLOTS);
      expect(cultures.size, recipe.id).toBeGreaterThan(0);
      expect(recipe.start, recipe.id).toBeGreaterThanOrEqual(0);
      if (recipe.light != null) expect([0, 1, 2, 3]).toContain(recipe.light);
    }
  });

  it('put everything on the gel', () => {
    for (const recipe of RECIPES) {
      for (const event of recipe.dish.events) {
        const points =
          event.path || (event.x != null ? [[event.x, event.y]] : []);
        for (const [x, y] of points) {
          expect(Math.hypot(x, y), `${recipe.id} ${event.do}`).toBeLessThan(
            DISH.radius - 4,
          );
        }
      }
    }
  });

  it('grow what they plant: each culture suits its plate', () => {
    const grid = createGrid(256);
    for (const recipe of RECIPES) {
      const dish = cleanDish(recipe.dish);
      const medium = resolveMedium(dish);
      for (const id of slotsOf(dish)) {
        const { u } = packPlate({
          slots: [cultureById(id)],
          medium,
          env: dish.env,
          grid,
          seed: 1,
        });
        const best = grid.rate(resolveCulture(cultureById(id)).growth);
        // At least a fifth of its best: enough to see within the hour count.
        expect(
          u.uGrowD[0] * u.uTemp[0],
          `${id} in ${recipe.id}`,
        ).toBeGreaterThan(0.2 * best);
      }
    }
  });

  it('open the bench with plates that exist', () => {
    expect(OPENING_BENCH.length).toBeGreaterThan(2);
    expect(OPENING_BENCH.length).toBeLessThanOrEqual(8);
    for (const entry of OPENING_BENCH) {
      if (entry.recipe)
        expect(recipeById(entry.recipe), entry.recipe).toBeTruthy();
      else expect(mediumById(entry.medium), entry.medium).toBeTruthy();
    }
  });
});

/** Math.random's shape, but the same numbers every time (mulberry32). */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('a plate nobody chose', () => {
  const dealt = Array.from({ length: 300 }, (_, i) =>
    randomDish(seeded(i + 1)),
  );

  it('is a recipe like any other: clean, at hour zero, with something on it', () => {
    for (const dish of dealt) {
      expect(mediumById(dish.medium)).toBeTruthy();
      expect(dish.hours).toBe(0);
      // Nothing in it is dropped or changed by a second cleaning, or by
      // going out in a link and coming back.
      expect(cleanDish(dish).events).toEqual(dish.events);
      expect(JSON.stringify(decodeDish(encodeDish(dish)).events)).toBe(
        JSON.stringify(dish.events),
      );
      const cultures = slotsOf(dish);
      expect(cultures.length).toBeGreaterThan(0);
      expect(cultures.length).toBeLessThanOrEqual(SLOTS);
      // Every culture in it got a slot: none is refused when it is grown.
      const named = new Set(
        dish.events.filter((e) => e.culture).map((e) => e.culture),
      );
      expect(named.size).toBe(cultures.length);
      for (const event of dish.events) expect(event.at).toBe(0);
    }
  });

  it('puts everything on the gel', () => {
    for (const dish of dealt) {
      for (const event of dish.events) {
        const points = event.path || [[event.x, event.y]];
        for (const [x, y] of points) {
          expect(Math.hypot(x, y), event.do).toBeLessThan(DISH.radius - 4);
        }
      }
    }
  });

  it('only plants what the medium lets grow', () => {
    for (const medium of MEDIA) {
      const suited = suitedTo(medium);
      expect(suited.length, medium.id).toBeGreaterThan(0);
      for (const culture of suited) {
        if (medium.salt) expect(culture.salt, culture.id).toBeTruthy();
        else expect(culture.salt, culture.id).not.toBe('needs');
      }
    }
    for (const dish of dealt) {
      const allowed = suitedTo(mediumById(dish.medium)).map((c) => c.id);
      for (const id of slotsOf(dish)) expect(allowed).toContain(id);
    }
  });

  it('deals some plates whose cultures share a middle, and mixes them there', () => {
    const middle = (e) => e.do === 'spot' && e.x === 0 && e.y === 0;
    const sharing = dealt.filter(
      (dish) => dish.events.filter((e) => middle(e) && e.mixed).length > 1,
    );
    expect(sharing.length).toBeGreaterThan(dealt.length / 10);
    for (const dish of dealt) {
      const mixed = dish.events.filter((e) => e.mixed);
      // A mixed drop is a drop of more than one thing, all in one place.
      if (mixed.length) {
        expect(mixed.length).toBeGreaterThan(1);
        expect(new Set(mixed.map((e) => e.culture)).size).toBe(mixed.length);
        expect(new Set(mixed.map((e) => `${e.x},${e.y}`)).size).toBe(1);
      }
    }
    // And some that give one culture the middle to itself.
    const alone = dealt.filter(
      (dish) => dish.events.filter(middle).length === 1,
    );
    expect(alone.length).toBeGreaterThan(dealt.length / 10);
  });

  it('is not the same plate twice, and is the same plate from the same numbers', () => {
    expect(new Set(dealt.map((d) => d.medium)).size).toBeGreaterThan(
      MEDIA.length / 2,
    );
    expect(new Set(dealt.map((d) => JSON.stringify(d.events))).size).toBe(
      dealt.length,
    );
    expect(randomDish(seeded(7))).toEqual(randomDish(seeded(7)));
  });
});

describe('stamps', () => {
  it('gives a culture the next free slot, and refuses a fifth', () => {
    const slots = [];
    expect(slotFor(slots, 'crimson')).toBe(0);
    expect(slotFor(slots, 'lemon')).toBe(1);
    expect(slotFor(slots, 'crimson')).toBe(0);
    slotFor(slots, 'gold');
    slotFor(slots, 'violet');
    expect(slotFor(slots, 'coral')).toBe(-1);
    expect(slots).toHaveLength(SLOTS);
    const { stamps, refused } = stampsFor(
      { do: 'spot', culture: 'coral', x: 0, y: 0 },
      slots,
    );
    expect(stamps).toEqual([]);
    expect(refused).toBe(FULL);
  });

  it('leaves a drop as settled growth in the culture’s own channel', () => {
    const slots = ['lemon'];
    const { stamps } = stampsFor(
      { do: 'spot', culture: 'crimson', x: 3, y: -4, seed: 9 },
      slots,
    );
    expect(slots).toEqual(['lemon', 'crimson']);
    expect(stamps).toHaveLength(1);
    const { surface } = stamps[0];
    expect(surface.from).toEqual([3, -4]);
    expect(surface.addD[1]).toBeGreaterThan(0);
    expect(surface.addD[0]).toBe(0);
    // Crimson doesn't travel, so nothing arrives in the motile layer.
    expect(surface.addB).toBeUndefined();
    // More at the rim: the drop dried from its edge.
    expect(surface.ring).toBeGreaterThan(0);
  });

  it('leaves drops of three sizes, the middle one by default', () => {
    const radii = DROPS.map((d) => d.radius);
    expect(radii[0]).toBe(SPOT_RADIUS);
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    }
    expect(DROPS.map((d) => d.value)).toContain(DEFAULT_DROP);
    expect(dropRadius('nothing of the kind')).toBe(SPOT_RADIUS);
    for (const drop of DROPS) {
      expect(drop.label).toBeTruthy();
      expect(drop.hint.length).toBeGreaterThan(10);
      // A recipe keeps the size it is given: none is clamped on the way in.
      const [event] = cleanDish({
        medium: 'broth',
        events: [
          { at: 0, do: 'spot', culture: 'hay', x: 0, y: 0, size: drop.radius },
        ],
      }).events;
      expect(event.size).toBe(drop.radius);
      const { surface } = stampsFor(event, []).stamps[0];
      expect(surface.radius).toBe(drop.radius);
    }
  });

  it('sorts a mixed drop into clumps, and leaves a plain one whole', () => {
    const drop = (extra) =>
      stampsFor(
        { do: 'spot', culture: 'crimson', x: 0, y: 0, seed: 4, ...extra },
        [],
      ).stamps[0].surface;
    expect(drop({}).speckle).toBe(1);
    expect(drop({}).clump).toBe(0);
    const mixed = drop({ mixed: true });
    expect(mixed.speckle).toBe(0.5);
    expect(mixed.clump).toBe(CLUMP);
    // Patches big enough for a grid to hold and small enough that a drop
    // holds several.
    expect(CLUMP).toBeGreaterThan(2 * createGrid(256).dx);
    expect(CLUMP).toBeLessThan(DROPS[1].radius);
  });

  it('finds the wet drops a new one would run into', () => {
    const first = { at: 2, do: 'spot', culture: 'hay', x: 0, y: 0, size: 6 };
    const far = { at: 2, do: 'spot', culture: 'lemon', x: 20, y: 0 };
    const events = [first, far];
    const landing = (extra) =>
      wetDropsUnder(events, {
        at: 2.2,
        do: 'spot',
        culture: 'crimson',
        x: 1,
        y: 1,
        ...extra,
      });
    expect(landing({})).toEqual([0]);
    // More of the same is only more of it.
    expect(landing({ culture: 'hay' })).toEqual([]);
    // Off to one side of the drop the two just sit side by side.
    expect(landing({ x: 5, y: 0 })).toEqual([]);
    // A drop that has dried is a colony, not a drop.
    expect(landing({ at: 2 + WET_HOURS + 0.1 })).toEqual([]);
    // Only drops mix: not a streak through one, and not a disc.
    expect(landing({ do: 'streak' })).toEqual([]);
    expect(
      wetDropsUnder([{ at: 2, do: 'add', addition: 'sugar', x: 0, y: 0 }], {
        at: 2,
        do: 'spot',
        culture: 'crimson',
        x: 0,
        y: 0,
      }),
    ).toEqual([]);
    // A big drop over a small one counts as well as the other way round.
    expect(
      wetDropsUnder([{ at: 0, do: 'spot', culture: 'lemon', x: 2, y: 0 }], {
        at: 0,
        do: 'spot',
        culture: 'hay',
        x: 0,
        y: 0,
        size: 6,
      }),
    ).toEqual([0]);
  });

  it('makes a drop whole again when what it was mixed with is taken back', () => {
    const hay = {
      at: 0,
      do: 'spot',
      culture: 'hay',
      x: 0,
      y: 0,
      size: 6,
      mixed: true,
    };
    const rosette = { ...hay, culture: 'rosette' };
    const apart = { ...hay, culture: 'crimson', x: 20 };
    // Together they stay as they are, and nothing is changed in place.
    const pair = [hay, rosette];
    expect(unmixed(pair)).toEqual(pair);
    // One alone is a drop; so is one whose partner is across the plate.
    expect(unmixed([hay])).toEqual([{ ...hay, mixed: undefined }]);
    expect(unmixed([hay])[0]).not.toHaveProperty('mixed');
    expect(hay.mixed).toBe(true);
    expect(unmixed([hay, apart]).some((e) => e.mixed)).toBe(false);
    // Nothing else in a record is touched.
    const lawn = { at: 0, do: 'lawn', culture: 'gold', seed: 1 };
    expect(unmixed([lawn, hay, rosette])).toEqual([lawn, hay, rosette]);
  });

  it('puts a swarmer down in both its states, unless it makes its own swarmers', () => {
    const travelling = stampsFor(
      { do: 'spot', culture: 'verdigris', x: 0, y: 0 },
      [],
    ).stamps[0];
    expect(travelling.surface.addB[0]).toBeGreaterThan(0);
    const launching = stampsFor(
      { do: 'spot', culture: 'bullseye', x: 0, y: 0 },
      [],
    ).stamps[0];
    expect(launching.surface.addB).toBeUndefined();
  });

  it('thins a streak as the loop empties', () => {
    const path = Array.from({ length: 30 }, (_, i) => [i * 3 - 40, 0]);
    const { stamps } = stampsFor(
      { do: 'streak', culture: 'crimson', path, seed: 1 },
      [],
    );
    expect(stamps).toHaveLength(path.length - 1);
    const speckle = stamps.map((s) => s.surface.speckle);
    expect(speckle[0]).toBe(1);
    for (let i = 1; i < speckle.length; i += 1) {
      expect(speckle[i]).toBeLessThanOrEqual(speckle[i - 1]);
    }
    expect(speckle[speckle.length - 1]).toBeLessThan(0.3);
    // Each segment has its own scatter, so a replay lands the same cells.
    expect(new Set(stamps.map((s) => s.surface.seed)).size).toBe(stamps.length);
  });

  it('stamps a streak the same whether drawn a segment at a time or replayed whole', () => {
    const event = {
      do: 'streak',
      culture: 'lemon',
      seed: 5,
      path: [
        [0, 0],
        [2, 1],
        [4, 1],
        [6, 3],
        [9, 3],
      ],
    };
    const whole = stampsFor(event, []).stamps;
    const piecemeal = [];
    for (let n = 2; n <= event.path.length; n += 1) {
      const partial = { ...event, path: event.path.slice(0, n) };
      piecemeal.push(...stampsFor(partial, ['lemon'], n - 2).stamps);
    }
    expect(piecemeal).toEqual(whole);
  });

  it('spreads a lawn over the whole plate, a few cells here and there', () => {
    const { stamps } = stampsFor(
      { do: 'lawn', culture: 'gold', density: 0.04, seed: 2 },
      [],
    );
    expect(stamps).toHaveLength(1);
    expect(stamps[0].surface.radius).toBe(DISH.radius);
    expect(stamps[0].surface.speckle).toBe(0.04);
  });

  it('spreads an even lawn unless told how thinly, with the same load', () => {
    const lawn = (density) =>
      stampsFor({ do: 'lawn', culture: 'gold', density, seed: 2 }, []).stamps[0]
        .surface;
    const thick = lawn(undefined);
    const thin = lawn(0.25);
    expect(thick.speckle).toBe(1);
    // Every texel with a few cells, or a quarter of them with four times as many.
    expect(thick.speckle * thick.addD[0]).toBeCloseTo(
      thin.speckle * thin.addD[0],
      6,
    );
    expect(thick.addD[0]).toBeLessThan(thin.addD[0]);
  });

  it('puts a disc into the agar as its drug and a piece of paper', () => {
    const { stamps } = stampsFor(
      { do: 'add', addition: 'penicillin', x: 5, y: 5 },
      [],
    );
    expect(stamps).toHaveLength(1);
    expect(stamps[0].surface).toBeUndefined();
    expect(stamps[0].agar.add0[2]).toBeGreaterThan(0); // toxin X
    expect(stamps[0].agar.add2[3]).toBe(1); // paper
  });

  it('adds a sugar to the top of the gel and to the depth of it', () => {
    const { agar } = stampsFor({ do: 'add', addition: 'sugar', x: 0, y: 0 }, [])
      .stamps[0];
    expect(agar.add0[0]).toBeGreaterThan(0);
    expect(agar.add1[2]).toBe(agar.add0[0]);
  });

  it('cuts the gel out along a path, and scrapes without cutting', () => {
    const path = [
      [0, 0],
      [5, 0],
      [10, 0],
    ];
    const cut = stampsFor({ do: 'add', addition: 'scalpel', path }, []).stamps;
    expect(cut).toHaveLength(2);
    // The agar mask goes, with everything on and in it.
    expect(cut[0].surface.clearAux).toEqual([1, 1, 1, 1]);
    expect(cut[0].surface.addAux[3]).toBe(0);
    expect(cut[0].agar.clear0).toEqual([1, 1, 1, 1]);
    const scrape = stampsFor(
      { do: 'add', addition: 'loop', x: 1, y: 1 },
      [],
    ).stamps;
    expect(scrape).toHaveLength(1);
    // The mask stays; the ground is open again.
    expect(scrape[0].surface.clearAux).toEqual([1, 1, 1, 0]);
    expect(scrape[0].surface.addAux[0]).toBe(-1);
    expect(scrape[0].agar).toBeUndefined();
  });
});

/** A simulation that only keeps count. */
function fakeSim(size = 256) {
  const calls = { pour: 0, step: 0, surface: [], agar: [] };
  const sim = {
    grid: createGrid(size),
    calls,
    createPlate: () => ({ hours: 0, steps: 0 }),
    pour(plate) {
      calls.pour += 1;
      plate.hours = 0;
      plate.steps = 0;
    },
    step(plate, u) {
      calls.step += 1;
      calls.last = u;
      plate.steps += 1;
      plate.hours += sim.grid.dt;
    },
    stampSurface: (_plate, stamp) => calls.surface.push(stamp),
    stampAgar: (_plate, stamp) => calls.agar.push(stamp),
  };
  return sim;
}

describe('incubating', () => {
  it('does nothing to an empty plate but move its clock', () => {
    const sim = fakeSim();
    const dish = createDish('broth', { hours: 40 });
    const live = begin(sim, sim.createPlate(), dish);
    expect(sim.calls.pour).toBe(1);
    expect(advance(sim, live, 1000)).toBe(0);
    expect(sim.calls.step).toBe(0);
    expect(live.plate.hours).toBeGreaterThan(39.9);
    expect(live.plate.hours).toBeLessThanOrEqual(40);
  });

  it('applies each event when its hour comes, then grows', () => {
    const sim = fakeSim();
    const dish = cleanDish({
      medium: 'broth',
      hours: 12,
      events: [
        { at: 0, do: 'spot', culture: 'crimson', x: 0, y: 0, seed: 1 },
        { at: 6, do: 'add', addition: 'penicillin', x: 9, y: 0 },
      ],
    });
    const live = begin(sim, sim.createPlate(), dish);
    const stepsTo6 = Math.ceil(6 / sim.grid.dt);
    advance(sim, live, stepsTo6 - 2);
    expect(sim.calls.surface).toHaveLength(1);
    expect(sim.calls.agar).toHaveLength(0);
    expect(live.slots).toEqual(['crimson']);
    advance(sim, live, 1e6);
    expect(sim.calls.agar).toHaveLength(1);
    expect(live.plate.hours).toBeGreaterThanOrEqual(12 - sim.grid.dt);
    expect(live.cursor).toBe(2);
    // The culture's numbers reached the shader.
    expect(sim.calls.last.uGrowD[0]).toBeGreaterThan(0);
    expect(sim.calls.last.uWet).toBeGreaterThan(0);
  });

  it('skips an empty plate ahead to the first thing that happens to it', () => {
    const sim = fakeSim();
    const dish = cleanDish({
      medium: 'broth',
      hours: 30,
      events: [{ at: 24, do: 'spot', culture: 'lemon', x: 0, y: 0, seed: 1 }],
    });
    const live = begin(sim, sim.createPlate(), dish);
    advance(sim, live, 1e6);
    // Only the six hours after the drop were simulated.
    expect(sim.calls.step).toBeLessThanOrEqual(Math.ceil(6 / sim.grid.dt) + 1);
    expect(sim.calls.step).toBeGreaterThan(Math.floor(5.5 / sim.grid.dt));
  });

  it('writes down what is done by hand at the hour the plate has reached', () => {
    const sim = fakeSim();
    const dish = cleanDish({ medium: 'broth', hours: 5, events: [] });
    const live = begin(sim, sim.createPlate(), dish);
    advance(sim, live, 1e6);
    expect(
      act(sim, live, { do: 'spot', culture: 'gold', x: 1, y: 2, seed: 3 }),
    ).toBeNull();
    expect(dish.events).toHaveLength(1);
    expect(dish.events[0].at).toBeLessThanOrEqual(live.plate.hours);
    expect(dish.events[0].at).toBeGreaterThan(4.9);
    expect(live.seeded).toBe(true);
    // A replay applies it by then.
    const again = begin(sim, sim.createPlate(), cleanDish(dish));
    advance(sim, again, 1e6);
    expect(again.cursor).toBe(1);
  });

  it('refuses a fifth culture and leaves the record alone', () => {
    const sim = fakeSim();
    const dish = cleanDish({
      medium: 'broth',
      events: ['crimson', 'lemon', 'gold', 'violet'].map((culture, i) => ({
        at: 0,
        do: 'spot',
        culture,
        x: i,
        y: 0,
      })),
    });
    const live = begin(sim, sim.createPlate(), dish);
    advance(sim, live, 1);
    expect(act(sim, live, { do: 'spot', culture: 'coral', x: 0, y: 5 })).toBe(
      FULL,
    );
    expect(dish.events).toHaveLength(4);
    expect(live.cursor).toBe(4);
  });

  it('records a streak drawn by hand once, after stamping it piece by piece', () => {
    const sim = fakeSim();
    const dish = createDish('broth');
    const live = begin(sim, sim.createPlate(), dish);
    const event = {
      do: 'streak',
      culture: 'crimson',
      seed: 4,
      path: [
        [0, 0],
        [2, 0],
      ],
    };
    let segments = draw(sim, live, event, 0).segments;
    event.path.push([4, 0]);
    segments = draw(sim, live, event, segments).segments;
    expect(segments).toBe(2);
    expect(sim.calls.surface).toHaveLength(2);
    record(live, event);
    expect(dish.events).toHaveLength(1);
    // Recording doesn't stamp it again.
    advance(sim, live, 0);
    expect(sim.calls.surface).toHaveLength(2);
  });

  it('keeps a dragged slider as one entry, and replays the incubator’s history', () => {
    const sim = fakeSim();
    const dish = cleanDish({
      medium: 'broth',
      hours: 10,
      events: [{ at: 0, do: 'spot', culture: 'crimson', x: 0, y: 0, seed: 1 }],
    });
    const live = begin(sim, sim.createPlate(), dish);
    advance(sim, live, 1e6);
    for (const temperature of [31, 33, 35, 37])
      setEnv(sim, live, { temperature });
    expect(dish.events.filter((e) => e.do === 'set')).toHaveLength(1);
    expect(dish.events[1].env).toEqual({ temperature: 37 });
    expect(live.env.temperature).toBe(37);
    // As poured, it was still at 30.
    expect(dish.env.temperature).toBe(30);
    const again = begin(
      sim,
      sim.createPlate(),
      cleanDish({ ...dish, hours: 12 }),
    );
    expect(again.env.temperature).toBe(30);
    advance(sim, again, 1e6);
    expect(again.env.temperature).toBe(37);
  });

  it('takes a setting changed before anything is planted as how the plate was set up', () => {
    const sim = fakeSim();
    const dish = createDish('broth');
    const live = begin(sim, sim.createPlate(), dish);
    setEnv(sim, live, { temperature: 22 });
    expect(dish.events).toEqual([]);
    expect(dish.env.temperature).toBe(22);
  });

  it('stops where it stands when the incubator does, not where its clock had got to', () => {
    const sim = fakeSim();
    const dish = cleanDish({
      medium: 'broth',
      hours: 10,
      events: [{ at: 0, do: 'spot', culture: 'crimson', x: 0, y: 0, seed: 1 }],
    });
    const live = begin(sim, sim.createPlate(), dish);
    advance(sim, live, 1e6);
    // A day a second: the clock gets most of a day ahead of the plate.
    dish.hours += 14;
    advance(sim, live, 3);
    expect(behind(live)).toBeGreaterThan(13);
    const reached = live.plate.hours;
    settle(live, 10);
    expect(dish.hours).toBe(reached);
    const steps = sim.calls.step;
    // However long it is left, it takes no further step.
    expect(advance(sim, live, 1e6)).toBe(0);
    expect(sim.calls.step).toBe(steps);
    expect(live.plate.hours).toBe(reached);
  });

  it('still gets back to where it was left, and no further, when stopped on the way', () => {
    const sim = fakeSim();
    const dish = cleanDish({
      medium: 'broth',
      hours: 40,
      events: [{ at: 0, do: 'spot', culture: 'lemon', x: 0, y: 0, seed: 1 }],
    });
    const live = begin(sim, sim.createPlate(), dish);
    advance(sim, live, 20);
    // The clock had begun to run on past the hour it was left at.
    dish.hours = 43;
    settle(live, 40);
    expect(dish.hours).toBe(40);
    advance(sim, live, 1e6);
    expect(live.plate.hours).toBeGreaterThan(40 - sim.grid.dt);
    expect(live.plate.hours).toBeLessThanOrEqual(40 + sim.grid.dt);
  });

  it('never moves a plate on by settling it', () => {
    const sim = fakeSim();
    const dish = createDish('broth', { hours: 6 });
    const live = begin(sim, sim.createPlate(), dish);
    advance(sim, live, 1e6);
    settle(live, 30);
    expect(dish.hours).toBe(6);
  });
});

describe('the camera', () => {
  it('lays the dishes out in a grid that suits the view', () => {
    const wide = benchLayout(6, 16 / 9);
    expect([wide.cols, wide.rows]).toEqual([3, 2]);
    const tall = benchLayout(6, 9 / 16);
    expect([tall.cols, tall.rows]).toEqual([2, 3]);
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const layout = benchLayout(count, 4 / 3);
      expect(layout.centres).toHaveLength(count);
      // No two dishes overlap.
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          const [a, b] = [layout.centres[i], layout.centres[j]];
          expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(
            2 * DISH.radius + 4,
          );
        }
      }
    }
  });

  it('finds on the bench the point it was shown', () => {
    const camera = orbit({
      target: [20, 5, -10],
      azimuth: 0.4,
      elevation: 0.9,
      distance: fitDistance(45, 45, 0.9, 4 / 3),
      aspect: 4 / 3,
    });
    for (const [x, z] of [
      [20, -10],
      [0, 0],
      [45, 12],
      [-30, -40],
    ]) {
      const [nx, ny] = project(camera, [x, 5, z]);
      const [px, pz] = pickPlane(camera, nx, ny, 5);
      expect(px).toBeCloseTo(x, 2);
      expect(pz).toBeCloseTo(z, 2);
    }
  });

  it('stands back far enough to see the whole dish, from any height', () => {
    for (const elevation of [0.25, 0.6, 0.9, 1.5]) {
      for (const aspect of [0.6, 1, 4 / 3, 2]) {
        const distance = fitDistance(45, 45, elevation, aspect, 1);
        const camera = orbit({
          target: [0, 5, 0],
          azimuth: 0,
          elevation,
          distance,
          aspect,
        });
        for (let a = 0; a < 8; a += 1) {
          const t = (a / 8) * Math.PI * 2;
          const [nx, ny] = project(camera, [
            Math.cos(t) * 45,
            5,
            Math.sin(t) * 45,
          ]);
          expect(Math.abs(nx), `${elevation} ${aspect}`).toBeLessThanOrEqual(
            1.001,
          );
          expect(Math.abs(ny), `${elevation} ${aspect}`).toBeLessThanOrEqual(
            1.001,
          );
        }
      }
    }
  });
});

describe('words', () => {
  it('counts hours, then days', () => {
    expect(formatHours(0)).toBe('0 h');
    expect(formatHours(41.4)).toBe('41 h');
    expect(formatHours(48)).toBe('2 d');
    expect(formatHours(76)).toBe('3 d 4 h');
  });

  it('says what was done to a plate', () => {
    expect(describeEvent({ do: 'spot', culture: 'crimson' })).toBe(
      'Crimson, as a drop',
    );
    expect(
      describeEvent({ do: 'spot', culture: 'cyan-tag', mixed: true }),
    ).toBe('Tagged, cyan, in a mixed drop');
    expect(describeEvent({ do: 'streak', culture: 'lemon' })).toBe(
      'Lemon, streaked',
    );
    expect(describeEvent({ do: 'lawn', culture: 'gold' })).toBe(
      'Gold, spread as a lawn',
    );
    expect(describeEvent({ do: 'add', addition: 'penicillin' })).toBe(
      'Antibiotic disc',
    );
    expect(
      describeEvent({
        do: 'add',
        addition: 'scalpel',
        path: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBe('A cut with the scalpel');
    expect(
      describeEvent({ do: 'set', env: { temperature: 37, light: 'dark' } }),
    ).toBe('Incubator set to 37 °C, kept dark');
    expect(describePour({ medium: 'swarm', agar: 0.5 })).toBe(
      'Poured: Swarm agar, 0.5 % agar',
    );
  });
});
