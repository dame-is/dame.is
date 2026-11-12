// Millimetres and hours on one side, texels and steps on the other.
//
// Every number in the libraries (cultures.js, media.js) is written the way a
// lab notebook would write it: a colony creeps at so many mm²/h, a pigment
// takes so many hours to come up, a wrinkle is so many millimetres across.
// The simulation runs on a grid in steps. This file is the only place the two
// meet, so the same recipe grows the same plate at 256, 384 or 512 texels and
// a culture's numbers can be read against a paper's.
//
// The model is for looking at, not for measuring with: the numbers are in
// real units so that they can be kept plausible, and that is all.

/** A standard 90 mm dish: about 86 mm of agar across, poured 4 mm deep. */
export const DISH = {
  /** Radius of the agar, mm. */
  radius: 43,
  /** Inner wall height above the bench, mm. */
  wallHeight: 14.5,
  /** Polystyrene wall thickness, mm. */
  wallThickness: 1.1,
  /** Poured depth of the agar, mm. */
  agarDepth: 4,
};

/** Texels kept clear between the agar's edge and the texture's. */
const MARGIN = 2;

/**
 * Hours per step, per mm² of texel. The agar chemistry runs on a grid of half
 * the resolution, where a 5-point diffusion stays stable while D·dt/dx² is
 * under a quarter; this constant puts a small sugar (about 1.8 mm²/h in agar)
 * at 0.216 there, which is as fast as the grid allows with a little to spare.
 */
const HOURS_PER_MM2 = 0.48;

/**
 * The grid for an N×N simulation: how big a texel is, how long a step is,
 * and the conversions that follow.
 */
export function createGrid(size) {
  const n = Math.max(64, Math.round(size / 2) * 2);
  const radiusTexels = n / 2 - MARGIN;
  const dx = DISH.radius / radiusTexels;
  const dt = HOURS_PER_MM2 * dx * dx;
  return {
    size: n,
    chemSize: n / 2,
    /** mm per texel. */
    dx,
    /** hours per step. */
    dt,
    stepsPerHour: 1 / dt,
    radiusTexels,
    /** Side of the square the texture covers, mm. */
    span: n * dx,
    /** A rate in 1/h, as a fraction per step. */
    rate: (perHour) => perHour * dt,
    /** A diffusivity in mm²/h, on the surface grid. */
    diffusion: (mm2PerHour) => (mm2PerHour * dt) / (dx * dx),
    /** A diffusivity in mm²/h, on the half-resolution chemistry grid. */
    chemDiffusion: (mm2PerHour) => (mm2PerHour * dt) / (4 * dx * dx),
    /** A length in mm, in texels. */
    length: (mm) => mm / dx,
    /** A speed in mm/h, in texels per step. */
    speed: (mmPerHour) => (mmPerHour * dt) / dx,
  };
}

/** How finely a plate can be worked out. */
export const DETAILS = [
  { value: 'standard', label: 'Standard' },
  { value: 'fine', label: 'Fine' },
];

/**
 * How many texels across a plate is, for a level of detail on a kind of
 * device. A phone (`modest`) grows its plates at 256, which is a sixth of
 * the work per incubator hour of 384 and looks nearly the same on a small
 * screen. Fine is one size up from whatever standard is: about three times
 * the work for every hour grown, for folds and edges half again as fine.
 */
export function gridSize(detail, modest) {
  if (detail === 'fine') return modest ? 384 : 512;
  return modest ? 256 : 384;
}

/**
 * How fast a culture grows at a temperature, as a fraction of its best: the
 * cardinal temperature model with inflection (Rosso et al., 1993), which is
 * what predictive microbiology fits to growth curves. Zero at and beyond the
 * minimum and maximum, one at the optimum, and lopsided the way real curves
 * are: a slow climb from the cold side and a steep fall past the optimum.
 */
export function temperatureFactor(celsius, { tMin, tOpt, tMax }) {
  if (celsius <= tMin || celsius >= tMax) return 0;
  const a = (celsius - tMax) * (celsius - tMin) ** 2;
  const b =
    (tOpt - tMin) *
    ((tOpt - tMin) * (celsius - tOpt) -
      (tOpt - tMax) * (tOpt + tMin - 2 * celsius));
  if (b === 0) return 0;
  return Math.min(1, Math.max(0, a / b));
}

/**
 * How wet the surface of an agar is, 0 to 1, from its concentration in
 * percent. Swimming and swarming plates are poured at 0.3 to 0.7 %, where the
 * gel holds water loosely enough for cells to move through or across it; the
 * standard 1.5 % plate is firm and nearly dry to the touch, and motile
 * species sit still on it. Read off the points below and interpolated.
 */
const WETNESS_BY_AGAR = [
  [0.25, 1.0],
  [0.4, 0.92],
  [0.5, 0.8],
  [0.7, 0.58],
  [1.0, 0.34],
  [1.5, 0.16],
  [2.0, 0.08],
  [3.0, 0.03],
];

export function wetnessForAgar(percent) {
  const points = WETNESS_BY_AGAR;
  if (percent <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    if (percent <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (percent - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * A plate loses water from the hour it is poured. In a humid incubator it
 * takes a week to matter; on an open bench the surface is noticeably drier by
 * the second day, which is why swarm plates are used fresh. Returns the
 * fraction of the surface's wetness left after `hours` at a relative
 * humidity of 0 to 1.
 */
export function dryingFactor(hours, humidity) {
  const halfLife = 18 + 260 * Math.max(0, Math.min(1, humidity)) ** 2;
  return Math.exp((-Math.LN2 * Math.max(0, hours)) / halfLife);
}

/** "#rrggbb" as linear-light RGB, each 0 to 1. */
export function hexToLinear(hex) {
  const h = String(hex).replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const s = parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    out[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }
  return out;
}

/**
 * A colour as the light it absorbs, per millimetre of agar it is dissolved
 * in: the Beer–Lambert coefficients that, at unit concentration, tint a
 * white backlight to the colour given. Pigments diffusing through the agar
 * are kept as these, because absorbances add where colours don't: a blue
 * halo meeting a yellow one goes green on its own.
 */
export function hexToAbsorbance(hex, strength = 1) {
  return hexToLinear(hex).map((c) => -Math.log(Math.max(c, 0.012)) * strength);
}
