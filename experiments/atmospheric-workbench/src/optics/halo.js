// Halos, one ray at a time.
//
// Nothing here knows what a sun dog is. A ray of sunlight meets an ice
// crystal that hangs in the air some way up, crosses into it, bounces about
// inside and leaves, and where it leaves to is a point of light in the sky.
// A few million of those are the picture. Which halos turn up depends only on
// the shape of the crystals and how they lie as they fall, which is how it
// goes in the sky too.
//
// This is the method of HaloSim (Les Cowley and Michael Schroeder) and of the
// tracers before and since: geometric optics, with the share of light that
// reflects at each face decided by Fresnel's equations and a roll of the
// dice. It leaves out diffraction, so nothing here is softened by the
// crystals being small, and it leaves out light scattered twice.

import { fresnel, iceIndex } from './media.js';
import { spectrum } from './spectrum.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** The sun is a disc, not a point: 0.53° across. Every halo is blurred by it. */
export const SUN_RADIUS = 0.266;

// A crystal is a hexagonal prism, in its own frame: the c axis is z, the six
// side faces stand one unit from it, and the two end faces (the basal faces)
// are `ratio` units above and below the middle. So `ratio` is the crystal's
// length over its width: a plate is well under 1, a column well over.
const SIDE = 2 * Math.tan(Math.PI / 6);
const HEX_AREA = 3 * SIDE;
const FACE_X = [];
const FACE_Y = [];
for (let k = 0; k < 6; k++) {
  FACE_X.push(Math.cos((k * Math.PI) / 3));
  FACE_Y.push(Math.sin((k * Math.PI) / 3));
}
// The hexagon's corners, for picking a point on an end face.
const CORNER_X = [];
const CORNER_Y = [];
for (let k = 0; k < 7; k++) {
  CORNER_X.push(SIDE * Math.cos(((k + 0.5) * Math.PI) / 3));
  CORNER_Y.push(SIDE * Math.sin(((k + 0.5) * Math.PI) / 3));
}

/**
 * How a crystal lies as it falls. These four are the ones behind nearly
 * every halo that gets photographed.
 *
 *   random  tumbling every which way (small or irregular crystals)
 *   plate   flat, like a leaf settling: c axis vertical
 *   column  on its side, free to roll: c axis horizontal
 *   parry   on its side and not rolling: two side faces level
 */
export const ORIENTATIONS = ['random', 'plate', 'column', 'parry'];

/** A seedable generator, so a test traces the same rays twice. */
export function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A tracer. `bands` is how many wavelengths sunlight is split into.
 *
 * `shoot(crystals, sunAltitude)` sends one ray and reports where in the sky
 * its light is seen, in `tracer.seen`: a unit vector (x toward the point on
 * the horizon under the sun, z up), a weight, and which band it was. It
 * returns false for a ray that never came out.
 */
export function createTracer({ random = Math.random, bands = 48 } = {}) {
  const colours = spectrum(bands);
  const index = colours.map((band) => iceIndex(band.nm));
  const seen = { x: 0, y: 0, z: 0, weight: 0, band: 0 };

  // The crystal's turn in the air: world = m · crystal.
  let m00 = 1,
    m01 = 0,
    m02 = 0;
  let m10 = 0,
    m11 = 1,
    m12 = 0;
  let m20 = 0,
    m21 = 0,
    m22 = 1;

  function gauss() {
    return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
  }

  // Turn about z by `spin`, tip the c axis `tip` from the vertical, then
  // swing the whole thing to the compass bearing `bearing`.
  function orient(bearing, cosTip, sinTip, spin) {
    const ca = Math.cos(bearing),
      sa = Math.sin(bearing);
    const cg = Math.cos(spin),
      sg = Math.sin(spin);
    m00 = ca * cosTip * cg - sa * sg;
    m01 = -ca * cosTip * sg - sa * cg;
    m02 = ca * sinTip;
    m10 = sa * cosTip * cg + ca * sg;
    m11 = -sa * cosTip * sg + ca * cg;
    m12 = sa * sinTip;
    m20 = -sinTip * cg;
    m21 = sinTip * sg;
    m22 = cosTip;
  }

  function settle(kind, wobble) {
    const bearing = TAU * random();
    if (kind === 'random') {
      const c = 2 * random() - 1;
      orient(bearing, c, Math.sqrt(1 - c * c), TAU * random());
      return;
    }
    if (kind === 'plate') {
      // A wobble in two directions at once: how far it tips is the length of
      // a two-dimensional bell curve.
      const tip = wobble * DEG * Math.sqrt(-2 * Math.log(1 - random()));
      orient(bearing, Math.cos(tip), Math.sin(tip), TAU * random());
      return;
    }
    const tip = Math.PI / 2 + wobble * DEG * gauss();
    const spin = kind === 'parry' ? wobble * DEG * gauss() : TAU * random();
    orient(bearing, Math.cos(tip), Math.sin(tip), spin);
  }

  function shoot(crystal, sunAltitude) {
    const { kind, ratio, wobble = 0 } = crystal;
    const half = ratio;
    settle(kind, wobble);

    // Toward a point on the sun's disc.
    const alt = sunAltitude * DEG;
    const rho = SUN_RADIUS * DEG * Math.sqrt(random());
    const psi = TAU * random();
    const ou = rho * Math.cos(psi),
      ov = rho * Math.sin(psi);
    let sx = Math.cos(alt) - Math.sin(alt) * ou;
    let sy = ov;
    let sz = Math.sin(alt) + Math.cos(alt) * ou;
    const sl = Math.hypot(sx, sy, sz);
    sx /= sl;
    sy /= sl;
    sz /= sl;

    // The light's heading, in the crystal's frame.
    let dx = -(m00 * sx + m10 * sy + m20 * sz);
    let dy = -(m01 * sx + m11 * sy + m21 * sz);
    let dz = -(m02 * sx + m12 * sy + m22 * sz);

    // Which face it lands on: each in proportion to how much of it the sun
    // can see. Faces 0 to 5 are the sides, 6 the top, 7 the bottom.
    const sideArea = SIDE * 2 * half;
    let total = 0;
    const lit = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 6; k++) {
      const facing = -(FACE_X[k] * dx + FACE_Y[k] * dy);
      if (facing > 0) total += lit[k] = sideArea * facing;
    }
    if (dz < 0) total += lit[6] = HEX_AREA * -dz;
    else total += lit[7] = HEX_AREA * dz;
    let pick = random() * total;
    let face = 0;
    for (; face < 7; face++) {
      pick -= lit[face];
      if (pick <= 0 && lit[face] > 0) break;
    }
    if (lit[face] <= 0) return false;

    // A crystal that shows the sun a bigger outline catches more light. The
    // average outline of any tumbling solid is a quarter of its surface.
    seen.weight = total / ((6 * sideArea + 2 * HEX_AREA) / 4);
    const band = (random() * bands) | 0;
    seen.band = band;
    const n = index[band];

    let px, py, pz, nx, ny, nz;
    if (face < 6) {
      const u = (2 * random() - 1) * (SIDE / 2);
      nx = FACE_X[face];
      ny = FACE_Y[face];
      nz = 0;
      px = nx - ny * u;
      py = ny + nx * u;
      pz = (2 * random() - 1) * half;
    } else {
      const k = (random() * 6) | 0;
      const r1 = Math.sqrt(random()),
        r2 = random();
      px = r1 * ((1 - r2) * CORNER_X[k] + r2 * CORNER_X[k + 1]);
      py = r1 * ((1 - r2) * CORNER_Y[k] + r2 * CORNER_Y[k + 1]);
      nx = 0;
      ny = 0;
      nz = face === 6 ? 1 : -1;
      pz = nz * half;
    }

    // At the surface: some of it glances off, the rest goes in, bent.
    let cos = -(nx * dx + ny * dy + nz * dz);
    if (random() < fresnel(cos, 1, n)) {
      dx += 2 * cos * nx;
      dy += 2 * cos * ny;
      dz += 2 * cos * nz;
    } else {
      let eta = 1 / n;
      let k = eta * cos - Math.sqrt(1 - eta * eta * (1 - cos * cos));
      dx = eta * dx + k * nx;
      dy = eta * dy + k * ny;
      dz = eta * dz + k * nz;

      // Inside: on to the next face, and out through it or back off it.
      let out = false;
      for (let bounce = 0; bounce < 24 && !out; bounce++) {
        let t = Infinity;
        let hit = -1;
        for (let j = 0; j < 6; j++) {
          const along = FACE_X[j] * dx + FACE_Y[j] * dy;
          if (along <= 1e-12) continue;
          const tj = (1 - FACE_X[j] * px - FACE_Y[j] * py) / along;
          if (tj < t) {
            t = tj;
            hit = j;
          }
        }
        if (dz > 1e-12) {
          const tj = (half - pz) / dz;
          if (tj < t) {
            t = tj;
            hit = 6;
          }
        } else if (dz < -1e-12) {
          const tj = (-half - pz) / dz;
          if (tj < t) {
            t = tj;
            hit = 7;
          }
        }
        if (hit < 0) return false;
        if (t > 0) {
          px += dx * t;
          py += dy * t;
          pz += dz * t;
        }
        if (hit < 6) {
          nx = FACE_X[hit];
          ny = FACE_Y[hit];
          nz = 0;
        } else {
          nx = 0;
          ny = 0;
          nz = hit === 6 ? 1 : -1;
        }
        cos = nx * dx + ny * dy + nz * dz;
        const back = fresnel(cos, n, 1);
        if (back < 1 && random() >= back) {
          eta = n;
          k = Math.sqrt(1 - eta * eta * (1 - cos * cos)) - eta * cos;
          dx = eta * dx + k * nx;
          dy = eta * dy + k * ny;
          dz = eta * dz + k * nz;
          out = true;
        } else {
          dx -= 2 * cos * nx;
          dy -= 2 * cos * ny;
          dz -= 2 * cos * nz;
        }
      }
      if (!out) return false;
    }

    // Back in the world. Light going that way is seen by looking the other.
    seen.x = -(m00 * dx + m01 * dy + m02 * dz);
    seen.y = -(m10 * dx + m11 * dy + m12 * dz);
    seen.z = -(m20 * dx + m21 * dy + m22 * dz);
    return true;
  }

  return { shoot, seen, colours };
}

/**
 * The sky as a square picture: the zenith in the middle, the horizon a
 * circle near the edge, and equal steps outward for equal steps down the
 * sky (an all-sky camera's view). `reach` is how far down from the zenith it
 * goes, in degrees: a little past the horizon, so the horizon isn't an edge.
 */
export const SKY_REACH = 96;

export function createSkyMap(size) {
  return { size, light: new Float32Array(size * size * 3), rays: 0 };
}

export function clearSkyMap(map) {
  map.light.fill(0);
  map.rays = 0;
}

/**
 * Trace `count` rays through a mix of crystals and add what comes out to the
 * map. `crystals` is a list of `{ kind, ratio, wobble, share }`; a ray goes
 * to each in proportion to its share.
 */
export function expose(tracer, map, crystals, sunAltitude, count, random) {
  const { size, light } = map;
  const { seen, colours } = tracer;
  const half = size / 2;
  const reach = SKY_REACH * DEG;
  let whole = 0;
  for (const c of crystals) whole += c.share;
  if (!(whole > 0)) return;
  for (let i = 0; i < count; i++) {
    let pick = random() * whole;
    let crystal = crystals[0];
    for (const c of crystals) {
      pick -= c.share;
      if (pick <= 0) {
        crystal = c;
        break;
      }
    }
    if (!tracer.shoot(crystal, sunAltitude)) continue;
    const down = Math.acos(Math.max(-1, Math.min(1, seen.z)));
    if (down >= reach) continue;
    const flat = Math.hypot(seen.x, seen.y);
    const r = (down / reach) * half;
    const x = (half + (flat > 1e-9 ? (r * seen.x) / flat : 0)) | 0;
    const y = (half + (flat > 1e-9 ? (r * seen.y) / flat : 0)) | 0;
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    // A pixel near the horizon covers less sky than one overhead.
    const w = seen.weight * (down > 1e-4 ? down / Math.sin(down) : 1);
    const rgb = colours[seen.band].rgb;
    const at = (y * size + x) * 3;
    light[at] += w * rgb[0];
    light[at + 1] += w * rgb[1];
    light[at + 2] += w * rgb[2];
  }
  map.rays += count;
}

/**
 * The map as a picture: 8 bits a channel, brightness rolled off so a sun dog
 * burns out the way it does in a photograph, and stored as a square root so
 * the faint halos keep their steps. `gain` is the exposure.
 *
 * A picture made of few rays is mostly gaps, so it is developed coarse:
 * `factor` map pixels a side go into each pixel of the picture. Returns
 * `{ image, size }`.
 */
export function develop(map, gain, factor = 1) {
  const { size, light, rays } = map;
  const side = Math.floor(size / factor);
  const image = new Uint8Array(side * side * 4);
  // If the light were spread evenly over the sky, every pixel would read 1.
  const scale =
    rays > 0 ? (gain * size * size * 0.68) / (rays * factor * factor) : 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let v = 0; v < factor; v++) {
        let at = ((y * factor + v) * size + x * factor) * 3;
        for (let u = 0; u < factor; u++, at += 3) {
          r += light[at];
          g += light[at + 1];
          b += light[at + 2];
        }
      }
      const to = (y * side + x) * 4;
      image[to] = 255 * Math.sqrt(1 - Math.exp(-r * scale));
      image[to + 1] = 255 * Math.sqrt(1 - Math.exp(-g * scale));
      image[to + 2] = 255 * Math.sqrt(1 - Math.exp(-b * scale));
      image[to + 3] = 255;
    }
  }
  return { image, size: side };
}

/** How coarse to develop a map that has had `rays` rays. */
export function coarseness(map) {
  const perPixel = map.rays / (map.size * map.size);
  if (perPixel < 0.25) return 8;
  if (perPixel < 1) return 4;
  if (perPixel < 4) return 2;
  return 1;
}
