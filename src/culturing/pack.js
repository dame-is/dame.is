// From a recipe to the numbers the shaders run on.
//
// A plate is up to four cultures on a medium in an incubator. Each of those
// is written in the libraries in lab units; the passes want one vec4 per
// parameter (a component per culture), in texels and steps. `packPlate` makes
// that translation once per change of recipe, and `clockUniforms` supplies
// the two or three values that drift with the hours.
//
// It is pure: no GL, no DOM. pack.test.js holds it to the stability bounds
// the explicit schemes need, so a culture added to the library with an
// over-eager number is clamped here instead of blowing up on someone's GPU.

import {
  dryingFactor,
  hexToAbsorbance,
  hexToLinear,
  temperatureFactor,
  wetnessForAgar,
} from './units.js';

/** Cultures a plate can hold: one per channel of an RGBA texel. */
export const SLOTS = 4;

/**
 * Every parameter a culture has, with the value it takes when the library
 * doesn't say. The defaults describe something unremarkable: a slow, round,
 * cream, non-motile colony.
 *
 * Rates are per hour, lengths in mm, diffusivities in mm²/h. Densities are in
 * units of "a fully grown layer" (1 ≈ this culture's mature thickness).
 */
export const CULTURE_DEFAULTS = {
  // ---- growth
  growth: 0.9, // settled biofilm, at its best
  motileGrowth: 0, // the motile layer (0 = it does not grow as such)
  kn: 0.05, // nutrient at half the best growth (1 = a rich medium)
  // Biomass made per unit of nutrient. A rich plate holds about four units
  // under every point of its surface (the top layer and the gel below), so
  // at 0.3 the middle of a colony can just reach full thickness on what is
  // under it, and anything leaner has to live off what diffuses in.
  yield: 0.3,
  cap: 1, // how dense the biofilm gets
  // The depth of film that is still growing, in the same units. Measured
  // active layers run from 7 to 44 µm under colonies a few hundred thick.
  active: 0.15,
  motileCap: 0.15,
  motileFloor: 0.02, // the least of the motile layer that can grow at all
  temp: { tMin: 8, tOpt: 32, tMax: 42 },
  ph: { opt: 0, tol: 3 },
  noise: 0.3,
  patchy: 0.3,

  // ---- spreading
  creep: 0.02, // biofilm pushed outward by its own growth
  creepIdle: 0.03, // the fraction of that which survives starvation
  osmotic: 0.2, // how much its matrix draws water: wider on soft agar
  motility: 0, // the motile layer's diffusivity on a wet surface
  raftExp: 0, // how strongly moving needs company (0 = not at all)
  raftAt: 0.05, // density at which a raft moves freely
  raftFloor: 0.03, // the fraction of that a lone cell manages
  swarmSpeed: 1.2, // mm/h: the fastest a raft is carried by a gradient
  wetNeed: 2, // how strongly moving needs a wet surface
  hinder: 6, // how far another culture's biofilm blocks it

  // ---- between the two states
  settle: 0.05,
  settleStarve: 0.6,
  settleThin: 0,
  settleDry: 1.5,
  raftMin: 0.02,
  launch: 0, // settled -> motile, inside the window below
  launchLo: 0.4,
  launchHi: 0.7,
  launchTop: 1e3, // biofilm denser than this makes no more swarmers

  // ---- steering (mm²/h per unit of potential; chirality in degrees)
  taxis: { nutrient: 0, surfactant: 0, toxin: 0, chirality: 0 },

  // ---- what it secretes, per hour per unit of biomass
  surfactant: 0,
  toxinX: 0,
  toxinY: 0,
  late: 1, // 1 = toxins only from pigmented (stationary-phase) biofilm
  signal: 0,
  acid: 0, // pH shift per unit of growth (+ acid)
  alkali: 0, // pH shift per hour from starved biofilm (toward alkaline)
  enzyme: 0,
  secretes: null, // { color: '#rrggbb', rate } — pigment that leaves the colony

  // ---- what hurts it
  sensX: 0, // 1 / (toxin X that halves its growth)
  sensY: 0,
  kill: 0, // lysis per hour once growth is mostly stopped
  kin: 0, // harm it does to other cultures sharing a texel, 0..1
  kinKill: 0,
  lyse: 0, // autolysis per hour of old starved biofilm
  lyseAfter: 48,

  // ---- sports
  sportRate: 0, // founders per mm² of newly colonised agar
  sportAdvantage: 0.15,

  // ---- pigment
  pigment: {
    hours: 14, // time to come up
    quorum: 0, // signal needed first (0 = none)
    tempMax: null, // °C above which none is made
    light: 0, // 1 = only young growth under light pigments (banding)
    starve: 0, // 1 = only once the food has run down
  },

  // ---- wrinkles
  wrinkle: {
    drive: 0, // 0 smooth … 1 deeply rugose
    wavelength: 1.4, // mm, ridge to ridge
    radial: 0, // 0 labyrinth … 1 spokes
    bump: 0, // > 0 turns ridges toward pustules
    sport: 1, // a sport's wrinkling relative to its parent's
  },

  // ---- how it looks
  look: {
    young: '#efe9d6', // new growth
    mature: '#e2d8b8', // once the pigment is up
    sport: null, // a sport's mature colour (null = same)
    opacity: 7, // per unit density; a thin layer shows the agar through
    height: 0.45, // mm of biofilm at density 1
    motileHeight: 0.04, // mm of motile layer at density 1
    wrinkleHeight: 0.35, // mm, ridge crest above the film
    gloss: 0.45, // 0 matte … 1 wet
    rough: 0.35, // highlight width, 0 mirror … 1 chalk
    grain: 0.2, // fine surface relief
    fuzz: 0, // aerial hyphae on young growth, 0..1
    fuzzLate: 0, // ... added as it matures
    sheen: 0, // metallic film on old growth
    stain: 0, // how readily it takes up a dye in the medium
    scatter: 0.3, // light bleeding through thin ridges and edges
    fluoresce: null, // colour under 365 nm
    glow: null, // bioluminescence
    droplets: null, // { color } — exudate beads on mature growth
  },
};

/** A library entry with every unstated parameter filled in. */
export function resolveCulture(culture) {
  const d = CULTURE_DEFAULTS;
  return {
    ...d,
    ...culture,
    temp: { ...d.temp, ...culture.temp },
    ph: { ...d.ph, ...culture.ph },
    taxis: { ...d.taxis, ...culture.taxis },
    pigment: { ...d.pigment, ...culture.pigment },
    wrinkle: { ...d.wrinkle, ...culture.wrinkle },
    look: { ...d.look, ...culture.look },
  };
}

/**
 * How the agar chemistry moves. mm²/h and 1/h.
 *
 * The diffusivities are the measured ones where the grid allows. Sugars and
 * amino acids go through 1.5 % agar about as they go through water (glucose
 * 2.4 mm²/h; peptone has been measured in agar at 5.8), which is faster than
 * the half-resolution grid can carry in one step, so nutrient sits at the
 * grid's limit. Antibiotics are slower (0.2–0.4 in agar), a secreted protein
 * an order slower again.
 */
export const AGAR = {
  nutrient: 1.8,
  surfactant: 1.5,
  toxinX: 0.4,
  toxinY: 0.6,
  signal: 1.2,
  // Protons are soaked up by the medium's buffer as they go, so a change
  // in pH travels far more slowly than the acid that causes it.
  ph: 0.5,
  enzyme: 0.2,
  pigment: 0.5,
  // First-order losses.
  surfactantLoss: 0.25,
  toxinXLoss: 0.012,
  toxinYLoss: 0.03,
  signalLoss: 0.05,
  enzymeLoss: 0.02,
  // The gel under the surface holds this many times what the top layer
  // does. How fast it refills the top follows from the nutrient's own
  // diffusivity and the 4 mm it has to cross (see refillHours below).
  deepRatio: 3,
  depth: 4,
};

/**
 * Hours for the top of the agar to refill from below: the diffusion time
 * across a slab, 4h²/(π²D). About 3.6 h for a sugar in 4 mm of gel, which is
 * why a fast swarm outruns its food and a slow colony never notices.
 */
export function refillHours(diffusivity) {
  return (4 * AGAR.depth * AGAR.depth) / (Math.PI * Math.PI * diffusivity);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * The packed uniform set for a plate.
 *
 * @param {object}   opts
 * @param {object[]} opts.slots   up to four resolved cultures (null = empty)
 * @param {object}   opts.medium  a media.js entry, with any slider overrides
 * @param {object}   opts.env     { temperature, humidity, light }
 * @param {object}   opts.grid    createGrid()
 * @param {number}   opts.seed
 */
export function packPlate({ slots, medium, env, grid, seed }) {
  const cultures = Array.from({ length: SLOTS }, (_, i) =>
    slots[i] ? resolveCulture(slots[i]) : null,
  );
  // What limits growth on a lean plate is not a sugar. The published models
  // only draw branches at the width real plates show if the limiting
  // nutrient diffuses about a hundred times more slowly than glucose does
  // (Golding et al. 1998 work in units that imply 0.04 mm²/h), and nobody
  // has a better account. A medium can say so with `diffusion`; this
  // workbench takes the same liberty the literature does, in the open.
  const nutrientD = Math.min(medium.diffusion ?? AGAR.nutrient, AGAR.nutrient);
  const each = (fn, empty = 0) => cultures.map((c) => (c ? fn(c) : empty));
  const softness = wetnessForAgar(medium.agar);

  // A medium can suit a culture or hold it back. `selects` maps a
  // culture's tags to a growth factor (bile salts and the Gram-positives,
  // an acid plate and the moulds). Salt is its own rule: on a salty plate
  // only what needs or tolerates salt does well, and what needs it does
  // badly anywhere else.
  const suits = (c) => {
    let f = 1;
    for (const tag of c.tags || []) {
      if (medium.selects && tag in medium.selects) f *= medium.selects[tag];
    }
    if (medium.salt && !c.salt) f *= 0.06;
    if (!medium.salt && c.salt === 'needs') f *= 0.2;
    return f;
  };
  const warmth = (c) => temperatureFactor(env.temperature, c.temp);
  const rate = (r) => clamp(grid.rate(r), 0, 0.5);

  const pigmentGate = (c) => {
    if (c.pigment.tempMax == null) return 1;
    // Fades out over the few degrees below the cutoff.
    return clamp((c.pigment.tempMax - env.temperature) / 3, 0, 1);
  };
  const absorbance = (c) =>
    c.secretes
      ? hexToAbsorbance(c.secretes.color, rate(c.secretes.rate))
      : [0, 0, 0];

  const chiral = each((c) => (c.taxis.chirality * Math.PI) / 180);
  const hasTaxis = cultures.some(
    (c) =>
      c &&
      c.motility > 0 &&
      (c.taxis.nutrient || c.taxis.surfactant || c.taxis.toxin),
  );
  const wrinkles = cultures.some((c) => c && c.wrinkle.drive > 0);

  const u = {
    uSeed: seed >>> 0,
    uArriveAt: 0.02,
    uYoungHours: 3,
    uSurfWet: 0.2,
    uTaxK: 0.04,
    uHasTaxis: hasTaxis ? 1 : 0,

    uGrowB: each((c) => rate(c.motileGrowth * suits(c))),
    uGrowD: each((c) => rate(c.growth * suits(c))),
    uKn: each((c) => c.kn, 1),
    uCapB: each((c) => c.motileCap, 1),
    uCutoff: each((c) => c.motileFloor, 1),
    uCapD: each((c) => c.cap, 1),
    uActive: each((c) => Math.min(c.active, c.cap * 0.9), 0.1),
    uTemp: each(warmth),
    uPhOpt: each((c) => c.ph.opt),
    uPhTol: each((c) => c.ph.tol, 1),
    uNoise: each((c) => c.noise),
    uPatchy: each((c) => c.patchy),

    uMotB: each((c) => clamp(grid.diffusion(c.motility), 0, 0.2)),
    uMotExp: each((c) => c.raftExp),
    uMotHalf: each((c) => c.raftAt, 1),
    uMotFloor: each((c) => c.raftFloor),
    // Bounded by what the upwind scheme will carry in a step with every
    // face flowing outward. That bound is a speed in texels, so in mm/h it
    // is lowest on the coarsest grid (1.6 mm/h at 256); cultures stay under
    // it so a swarm is the same speed everywhere.
    uTaxMax: each((c) => clamp(grid.speed(c.swarmSpeed), 0, 0.26)),
    uWetNeed: each((c) => c.wetNeed),
    uHinder: each((c) => c.hinder),
    // A matrix producer swells by drawing water out of the gel, and a
    // softer gel gives it up more easily: a rugose Vibrio colony is about
    // three times as wide on 0.6 % agar as on 1.5 %, while its matrix-less
    // mutant is the same size on both (Yan et al. 2017). The bound keeps
    // the upwind scheme stable at the culture's own cap.
    uCreep: each((c) =>
      clamp(
        grid.diffusion(c.creep) * (1 + 32 * c.osmotic * softness * softness),
        0,
        0.1 / (c.cap * c.cap),
      ),
    ),
    uCreepIdle: each((c) => c.creepIdle),

    uSettle: each((c) => rate(c.settle)),
    uSettleStarve: each((c) => rate(c.settleStarve)),
    uSettleThin: each((c) => rate(c.settleThin)),
    uSettleDry: each((c) => rate(c.settleDry)),
    uRaft: each((c) => c.raftMin, 1),
    uLaunch: each((c) => rate(c.launch)),
    uLaunchLo: each((c) => c.launchLo),
    uLaunchHi: each((c) => c.launchHi, 1),
    uLaunchTop: each((c) => c.launchTop, 1e3),

    uTaxN: each((c) => grid.diffusion(c.taxis.nutrient)),
    uTaxS: each((c) => grid.diffusion(c.taxis.surfactant)),
    uTaxX: each((c) => grid.diffusion(c.taxis.toxin)),
    uChiralCos: chiral.map(Math.cos),
    uChiralSin: chiral.map(Math.sin),

    uSensX: each((c) => c.sensX),
    uSensY: each((c) => c.sensY),
    uKill: each((c) => rate(c.kill)),
    uKin: each((c) => c.kin),
    uKinKill: each((c) => rate(c.kinKill)),
    uLyse: each((c) => rate(c.lyse)),
    uLyseAfter: each((c) => c.lyseAfter, 1e6),

    uMutRate: each((c) => c.sportRate * grid.dx * grid.dx),
    uMutAdv: each((c) => c.sportAdvantage),

    uPigRate: each((c) => rate(1 / c.pigment.hours) * pigmentGate(c)),
    uPigQ: each((c) => c.pigment.quorum),
    uPigLight: each((c) => c.pigment.light),
    uPigStarve: each((c) => c.pigment.starve),

    // ---- agar
    uDiff0: [
      grid.chemDiffusion(nutrientD),
      grid.chemDiffusion(AGAR.surfactant),
      grid.chemDiffusion(AGAR.toxinX),
      grid.chemDiffusion(AGAR.signal),
    ].map((x) => clamp(x, 0, 0.24)),
    uDiff1: [
      grid.chemDiffusion(AGAR.ph),
      grid.chemDiffusion(AGAR.enzyme),
      grid.chemDiffusion(nutrientD),
      grid.chemDiffusion(AGAR.toxinY),
    ].map((x) => clamp(x, 0, 0.24)),
    uDiff2: [
      grid.chemDiffusion(AGAR.pigment),
      grid.chemDiffusion(AGAR.pigment),
      grid.chemDiffusion(AGAR.pigment),
      0,
    ],
    uDecay0: [
      0,
      rate(AGAR.surfactantLoss),
      rate(AGAR.toxinXLoss),
      rate(AGAR.signalLoss),
    ],
    uDecay1: [
      rate(medium.buffer ?? 0.04),
      rate(AGAR.enzymeLoss),
      0,
      rate(AGAR.toxinYLoss),
    ],
    uDecay2: [0, 0, 0, 0],
    uExchange: rate(1 / refillHours(nutrientD)),
    uDeepRatio: medium.deep ?? AGAR.deepRatio,
    uUptake: each((c) => 1 / c.yield),

    uSurf: each((c) => rate(c.surfactant)),
    uProdX: each((c) => rate(c.toxinX)),
    uProdY: each((c) => rate(c.toxinY)),
    uProdLate: each((c) => c.late),
    uSignal: each((c) => rate(c.signal)),
    uAcid: each((c) => c.acid),
    uAlkali: each((c) => rate(c.alkali)),
    uEnzyme: each((c) => rate(c.enzyme)),
    uPigR: each((c) => absorbance(c)[0]),
    uPigG: each((c) => absorbance(c)[1]),
    uPigB: each((c) => absorbance(c)[2]),

    // ---- wrinkles
    uWrDrive: each((c) => c.wrinkle.drive),
    uWrQ2: each((c) => {
      // A film on a soft bed buckles at a wavelength of its thickness times
      // the cube root of how much stiffer it is than the bed (Yan et al.
      // 2019), and agar stiffens steeply with concentration: finer wrinkles
      // on a hard plate, broad folds on a soft one. Under five texels a
      // ridge can't be drawn without the grid showing.
      const stiffness = clamp((1.5 / medium.agar) ** 0.8, 0.6, 2.2);
      const texels = Math.max(5, grid.length(c.wrinkle.wavelength * stiffness));
      return ((2 * Math.PI) / texels) ** 2;
    }, 1),
    uWrRadial: each((c) => c.wrinkle.radial),
    uWrBump: each((c) => c.wrinkle.bump),
    uWrSport: each((c) => c.wrinkle.sport, 1),
    uWrOnset: 0.3,
    uWrFull: 0.75,

    // Not uniforms: read by the simulation to skip work.
    wrinkles,
  };

  return { u, cultures, softness };
}

/**
 * The values that change as a plate ages: how wet its surface still is,
 * whether the incubator's lights are on, and how hard its films are being
 * squeezed. Merged over the packed set before each step.
 */
export function clockUniforms({ softness, medium, env, hours }) {
  const drying = dryingFactor(hours, env.humidity);
  const hardness = clamp((medium.agar - 0.5) / 2, 0, 1);
  return {
    uWet: softness * drying,
    uLight: lightAt(env.light, hours),
    // A film buckles more on a stiffer, drier bed.
    uWrEnv: 0.75 + 0.35 * hardness + 0.5 * (1 - drying),
  };
}

/** Every parameter a medium's look has, with what it takes unstated. */
export const MEDIUM_LOOK_DEFAULTS = {
  color: '#e0d093', // what the gel scatters back
  opacity: 0.14, // 0 clear … 1 opaque
  acid: null, // an indicator's colours; null = the medium has none
  alkali: null,
  phRange: 1.2, // pH shift at which the indicator has fully turned
  clear: null, // the gel's colour where an enzyme has cleared it
  clearOpacity: 0.15,
  clearGain: 3, // how readily enzyme clears it
  dye: null, // a dye colonies can take up (Congo red)
  fluoresce: null, // the gel's own faint glow under ultraviolet
};

/**
 * The uniforms the compose pass needs to turn a plate's state into
 * something to look at: each culture's colours and surface, and the
 * medium's. Colours go in as linear light.
 */
export function packLook({ cultures, medium }) {
  const each = (fn, empty = 0) => cultures.map((c) => (c ? fn(c) : empty));
  const channel = (pickHex, i, empty = 0) =>
    each((c) => {
      const hex = pickHex(c);
      return hex ? hexToLinear(hex)[i] : empty;
    }, empty);
  const m = { ...MEDIUM_LOOK_DEFAULTS, ...medium.look };
  const lin = (hex, fallback) => hexToLinear(hex || fallback);
  // What has leaked into the gel glows, under ultraviolet, the colour of
  // whichever culture's pigment it is. One colour for the plate: the
  // dissolved pigment is kept as what it absorbs, not as whose it is.
  const halo = [0, 0, 0];
  for (const c of cultures) {
    if (c && c.secretes && c.secretes.fluoresce) {
      const f = hexToLinear(c.secretes.fluoresce);
      for (let i = 0; i < 3; i += 1) halo[i] = Math.max(halo[i], f[i]);
    }
  }
  return {
    uYoungR: channel((c) => c.look.young, 0),
    uYoungG: channel((c) => c.look.young, 1),
    uYoungB: channel((c) => c.look.young, 2),
    uMatureR: channel((c) => c.look.mature, 0),
    uMatureG: channel((c) => c.look.mature, 1),
    uMatureB: channel((c) => c.look.mature, 2),
    uSportR: channel((c) => c.look.sport || c.look.mature, 0),
    uSportG: channel((c) => c.look.sport || c.look.mature, 1),
    uSportB: channel((c) => c.look.sport || c.look.mature, 2),
    uOpacity: each((c) => c.look.opacity),
    uHeightD: each((c) => c.look.height),
    uHeightB: each((c) => c.look.motileHeight),
    uWrHeight: each((c) => c.look.wrinkleHeight),
    uWrSport: each((c) => c.wrinkle.sport, 1),
    uGloss: each((c) => c.look.gloss),
    uRough: each((c) => c.look.rough),
    uFuzz: each((c) => c.look.fuzz),
    uFuzzLate: each((c) => c.look.fuzzLate),
    uSheen: each((c) => c.look.sheen),
    uStain: each((c) => c.look.stain),
    uFluorR: channel((c) => c.look.fluoresce, 0),
    uFluorG: channel((c) => c.look.fluoresce, 1),
    uFluorB: channel((c) => c.look.fluoresce, 2),
    uGlowR: channel((c) => c.look.glow, 0),
    uGlowG: channel((c) => c.look.glow, 1),
    uGlowB: channel((c) => c.look.glow, 2),
    uGlowQ: each((c) => c.look.glowQuorum ?? c.pigment.quorum, 0),
    uKn: each((c) => c.kn, 1),
    uWrOnset: 0.3,
    uWrFull: 0.75,

    uAgarColor: lin(m.color),
    uAgarOpacity: m.opacity,
    uAcidColor: lin(m.acid, m.color),
    uAlkaliColor: lin(m.alkali, m.color),
    uIndicator: m.acid || m.alkali ? 1 : 0,
    uPhRange: m.phRange,
    uClearColor: lin(m.clear, m.color),
    uClearOpacity: m.clear ? m.clearOpacity : m.opacity,
    uClearGain: m.clear ? m.clearGain : 0,
    uDyeColor: lin(m.dye, '#ffffff'),
    uDye: m.dye ? 1 : 0,
    uAgarFluor: m.fluoresce
      ? hexToLinear(m.fluoresce).map((x) => x * 0.05)
      : [0.004, 0.005, 0.012],
    uHaloFluor: halo,
  };
}

/** Lights on (1) or off (0) at an hour: 'on', 'dark', or a 12:12 'cycle'. */
export function lightAt(mode, hours) {
  if (mode === 'on') return 1;
  if (mode === 'dark') return 0;
  return hours % 24 < 12 ? 1 : 0;
}

export { hexToLinear };
