// Every number the game is balanced on, in one place.
//
// Units are the real ones, kept small enough to read at a glance: power in
// kilowatts, energy in kilowatt-hours, time in hours of the island's day. A
// panel is 1 kW at noon; a house wants 0.4 kW around the clock; a battery
// holds 8 kWh, which is one house's night and a bit.

/** The island is a square grid of this many tiles a side. */
export const GRID = 20;

export const TERRAIN = Object.freeze({ WATER: 0, SAND: 1, GRASS: 2 });

/** The sun is up from DAWN to DUSK, and the day's books close at dawn. */
export const DAWN = 6;
export const DUSK = 18;
export const HOURS_PER_DAY = 24;

/** A new island starts at this hour, with the sun already up. */
export const START_HOUR = 7;
export const START_COINS = 300;

/** What the village pays for each kilowatt-hour it is actually sent. */
export const PRICE_PER_KWH = 5;

/**
 * A new family moves in at dawn when the village got at least this share of
 * the power it asked for over the day before.
 */
export const GROW_AT = 0.9;

/** The village starts with this many houses, on the first of its plots. */
export const START_HOUSES = 3;
export const VILLAGE_PLOTS = 12;

/** What it costs to clear the scenery that is in the way. */
const TREE_CLEAR = 10;
const ROCK_CLEAR = 25;

/**
 * What can stand on a tile. `conducts` things join the power network of any
 * conducting neighbour they touch (up, down, left, right), so a block of
 * panels is already wired together and a power line is only for the gaps.
 */
export const KINDS = Object.freeze({
  panel: Object.freeze({
    key: 'panel',
    name: 'Solar panel',
    cost: 40,
    peakKw: 1,
    conducts: true,
    blurb: 'Makes up to 1 kW while the sun is up.',
  }),
  battery: Object.freeze({
    key: 'battery',
    name: 'Battery',
    cost: 100,
    capacityKwh: 8,
    rateKw: 2,
    conducts: true,
    blurb: 'Keeps 8 kWh of spare power for the night.',
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
    name: 'House',
    demandKw: 0.4,
    conducts: true,
    blurb: 'Wants 0.4 kW, day and night.',
  }),
  tree: Object.freeze({
    key: 'tree',
    name: 'Tree',
    clearCost: TREE_CLEAR,
    scenery: true,
    blurb: `In the way. Costs ${TREE_CLEAR} to clear.`,
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
export const BUILDABLE = Object.freeze(['panel', 'battery', 'cable']);

/** The integration step never exceeds this, however long a frame took. */
export const MAX_STEP_HOURS = 0.05;
