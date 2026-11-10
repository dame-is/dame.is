// Every number the game is balanced on, in one place.
//
// Units are the real ones, kept small enough to read at a glance: power in
// kilowatts, energy in kilowatt-hours, time in hours of the island's day. A
// panel is 1 kW at noon; a cottage wants 0.4 kW around the clock; a battery
// holds 8 kWh, which is one cottage's night and a bit.

export const TERRAIN = Object.freeze({ WATER: 0, SAND: 1, GRASS: 2 });

/** How high a tile's top stands. The grass is a step above the beach. */
export const GROUND = Object.freeze({ GRASS: 0.16, SAND: 0 });

export const HOURS_PER_DAY = 24;
/** The day's books close at this hour, whatever time the sun came up. */
export const DAYBREAK = 6;
/** A new island starts at this hour, with the sun already up. */
export const START_HOUR = 7;

/** Every litre the generator burns costs this, per kilowatt-hour it makes. */
export const FUEL_PER_KWH = 4;

/**
 * The village grows at dawn when it got at least this share of the power it
 * asked for over the day before, from whatever source.
 */
export const GROW_AT = 0.9;

/** A panel in something's shadow still gets the light of the sky. */
export const SHADE_FACTOR = 0.25;

/** The village starts with this many cottages, on the first of its plots. */
export const START_HOUSES = 3;

/* ── homes ────────────────────────────────────────────────────────────────── */

/**
 * The three kinds of home, in the order a household moves up through them.
 * What changes from one to the next is not only how much power it wants but
 * WHEN, which is the whole difficulty of running on the sun:
 *
 *   cottage     a little, all the time
 *   house       an evening peak, after the sun has gone
 *   townhouse   a working day, an evening, and charging through the night
 *
 * `load` is kW by hour as [fromHour, kW] steps; `pays` is coins per kWh
 * delivered; `after` is how many well-powered days a home spends in the tier
 * below before it moves up; `height` is how tall it stands (for shade).
 */
export const TIERS = Object.freeze([
  null,
  Object.freeze({
    tier: 1,
    name: 'Cottage',
    pays: 5,
    after: 0,
    height: 0.74,
    load: Object.freeze([[0, 0.4]]),
    wants: 'Wants 0.4 kW, day and night.',
  }),
  Object.freeze({
    tier: 2,
    name: 'House',
    pays: 6,
    after: 2,
    height: 0.9,
    load: Object.freeze([
      [0, 0.35],
      [17, 1.1],
      [22, 0.35],
    ]),
    wants: 'Wants little by day and 1.1 kW from 5 to 10 in the evening.',
  }),
  Object.freeze({
    tier: 3,
    name: 'Townhouse',
    pays: 7,
    after: 3,
    height: 1.12,
    load: Object.freeze([
      [0, 0.9],
      [5, 0.4],
      [9, 1.3],
      [16, 0.4],
      [17, 1.2],
      [22, 0.4],
      [23, 0.9],
    ]),
    wants: 'Works by day (1.3 kW), is busy all evening, and charges overnight.',
  }),
]);

/** A home of `tier` wants this many kW at `hour` on the clock. */
export function loadAt(tier, hour) {
  const steps = TIERS[tier].load;
  let kw = steps[0][1];
  for (const [from, value] of steps) {
    if (hour >= from) kw = value;
    else break;
  }
  return kw;
}

/** The first cottage becomes a house once the village has this many homes. */
export const HOUSES_FOR_TIER_2 = 5;

/* ── what can stand on a tile ─────────────────────────────────────────────── */

const TREE_CLEAR = 10;
const ROCK_CLEAR = 25;

/**
 * `conducts` things join the power network of any conducting neighbour they
 * touch (up, down, left, right), so a block of panels is already wired
 * together and a power line is only for the gaps. `shade` is how tall a thing
 * stands when the sun is behind it.
 */
export const KINDS = Object.freeze({
  panel: Object.freeze({
    key: 'panel',
    name: 'Solar panel',
    cost: 40,
    peakKw: 1,
    conducts: true,
    blurb: 'Makes up to 1 kW, most of it around noon.',
  }),
  tracker: Object.freeze({
    key: 'tracker',
    name: 'Tracking panel',
    cost: 85,
    peakKw: 1.2,
    conducts: true,
    unlock: 'At 5 homes',
    blurb:
      'Turns to follow the sun: 1.2 kW, and far more of it morning and evening.',
  }),
  turbine: Object.freeze({
    key: 'turbine',
    name: 'Wind turbine',
    cost: 160,
    peakKw: 1.5,
    conducts: true,
    unlock: 'When the first cottage becomes a house',
    blurb:
      'Up to 1.5 kW whenever the wind blows, night included. Best on the beach.',
  }),
  battery: Object.freeze({
    key: 'battery',
    name: 'Battery',
    cost: 100,
    capacityKwh: 8,
    rateKw: 2,
    conducts: true,
    stores: true,
    blurb: 'Keeps 8 kWh of spare power for later.',
  }),
  bank: Object.freeze({
    key: 'bank',
    name: 'Battery bank',
    cost: 300,
    capacityKwh: 28,
    rateKw: 6,
    conducts: true,
    stores: true,
    shade: 0.66,
    unlock: 'At 8 homes',
    blurb: 'Keeps 28 kWh on a single tile.',
  }),
  cable: Object.freeze({
    key: 'cable',
    name: 'Power line',
    cost: 4,
    conducts: true,
    blurb: 'Carries power across a gap.',
  }),
  house: Object.freeze({
    key: 'house',
    name: 'Home',
    conducts: true,
    blurb: '',
  }),
  generator: Object.freeze({
    key: 'generator',
    name: 'Diesel generator',
    conducts: true,
    shade: 0.62,
    scrap: 120,
    blurb:
      'Fills whatever the sun, the wind and the batteries can’t, and burns fuel to do it.',
  }),
  tree: Object.freeze({
    key: 'tree',
    name: 'Tree',
    clearCost: TREE_CLEAR,
    scenery: true,
    shade: 1.05,
    blurb: `Throws shade. Costs ${TREE_CLEAR} to clear.`,
  }),
  rock: Object.freeze({
    key: 'rock',
    name: 'Rock',
    clearCost: ROCK_CLEAR,
    scenery: true,
    blurb: `In the way. Costs ${ROCK_CLEAR} to clear.`,
  }),
});

/** What the player can put down, in the order the toolbar offers it. */
export const BUILDABLE = Object.freeze([
  'panel',
  'tracker',
  'turbine',
  'battery',
  'bank',
  'cable',
]);

/** Buildings that have to be earned; the rest are there from the start. */
export const LOCKED = Object.freeze(['tracker', 'turbine', 'bank']);

/** A turbine inland gets this much of the wind a turbine on the beach does. */
export const INLAND_WIND = 0.65;

/** The integration step never exceeds this, however long a frame took. */
export const MAX_STEP_HOURS = 0.05;
