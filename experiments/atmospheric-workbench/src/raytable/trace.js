// The ray table: one piece of glass, ice or water, flat on a bench, and the
// light through it.
//
// This is the halo tracer's physics on a sheet of paper. A ray meets a
// surface; Snell's law says how far it bends going through and Fresnel's
// equations how much of it bounces off instead; then each of those two rays
// goes on to the next surface. What comes out of the far side, and by how
// much it has been turned, is the whole of where a halo or a bow sits in the
// sky.

import { fresnel, glassIndex, iceIndex, waterIndex } from '../optics/media.js';
import { minimumDeviation } from '../optics/media.js';
import { bowAngle } from '../optics/rainbow.js';
import { spectrum } from '../optics/spectrum.js';

const DEG = Math.PI / 180;

// The same scatter every time it is asked for.
function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const regular = (sides, radius, phase = 0) =>
  Array.from({ length: sides }, (_, i) => {
    const a = phase + (i * 2 * Math.PI) / sides;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  });

/**
 * What can be put on the table. A shape is a convex outline (counter-
 * clockwise, about one unit across) or a circle of radius 1.
 *
 *   index  its refractive index by wavelength
 *   fold   turning it this many degrees brings it back to itself
 *   order  how many times the ray worth following bounces inside: none for
 *          a prism or a crystal, once for the ray that makes a rainbow
 *   wedge  the angle between the two faces that ray crosses
 */
export const SHAPES = {
  hex: {
    name: 'Ice crystal, end on',
    note: 'Looking down the length of the crystal. Light that goes in one side face and out the next but one has crossed a 60° wedge of ice. Turn the crystal and the ray swings, but never closer to its old path than 22°.',
    index: iceIndex,
    outline: regular(6, 1),
    fold: 60,
    order: 0,
    wedge: 60,
  },
  side: {
    name: 'Ice crystal, side on',
    note: 'The same crystal seen from the side. A side face and an end face meet at 90°, a steeper wedge, and the least it can turn light is 46°: the big, faint halo.',
    index: iceIndex,
    outline: [
      [-1.05, -0.7],
      [1.05, -0.7],
      [1.05, 0.7],
      [-1.05, 0.7],
    ],
    fold: 180,
    order: 0,
    wedge: 90,
  },
  prism: {
    name: 'Glass prism',
    note: 'A 60° wedge of flint glass, the same angle as the ice crystal’s. Glass slows light more than ice does, so everything is turned further, and the colours spread wider.',
    index: glassIndex,
    outline: regular(3, 1.1, Math.PI / 2),
    fold: 120,
    order: 0,
    wedge: 60,
  },
  drop: {
    name: 'Raindrop',
    note: 'Light goes in, bounces off the back and comes out again, turned most of the way round. However far off centre it goes in, it can’t come back at more than 42° to the way it came. Rays crowd at that edge, and that crowd is the rainbow.',
    index: waterIndex,
    circle: true,
    fold: 360,
    order: 1,
  },
};
export const SHAPE_KEYS = Object.keys(SHAPES);

/** Seven colours across the spectrum, each traced as a ray of its own. */
export const BANDS = spectrum(7);

/**
 * The angle a shape is known for, in degrees: the least a crystal or prism
 * turns light of this wavelength, or how far from straight back the rainbow
 * ray comes out of a drop.
 */
export function knownAngle(key, nm = 550) {
  const shape = SHAPES[key];
  const n = shape.index(nm);
  return shape.circle ? bowAngle(n, 1) : minimumDeviation(n, shape.wedge);
}

function turned(shape, turn) {
  const c = Math.cos(turn * DEG);
  const s = Math.sin(turn * DEG);
  return shape.outline.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

// Where a ray from (ox, oy) heading (dx, dy) next meets the shape: the
// distance, and the surface's outward normal there. `inside` says which way
// it is crossing.
function meet(shape, points, ox, oy, dx, dy, inside) {
  if (shape.circle) {
    const b = ox * dx + oy * dy;
    const disc = b * b - (ox * ox + oy * oy - 1);
    if (disc <= 0) return null;
    const t = inside ? -b + Math.sqrt(disc) : -b - Math.sqrt(disc);
    if (t < 1e-9) return null;
    return { t, nx: ox + dx * t, ny: oy + dy * t };
  }
  let best = null;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const ex = bx - ax;
    const ey = by - ay;
    // counter-clockwise outline: the outward normal is the edge turned right
    const len = Math.hypot(ex, ey);
    const nx = ey / len;
    const ny = -ex / len;
    const facing = dx * nx + dy * ny;
    if (inside ? facing <= 1e-12 : facing >= -1e-12) continue;
    const t = ((ax - ox) * nx + (ay - oy) * ny) / facing;
    if (t < 1e-9) continue;
    const along =
      ((ox + dx * t - ax) * ex + (oy + dy * t - ay) * ey) / (len * len);
    if (along < -1e-9 || along > 1 + 1e-9) continue;
    if (!best || t < best.t) best = { t, nx, ny };
  }
  return best;
}

/**
 * Follow one ray of one colour. It starts at (ox, oy), outside the shape,
 * heading along +x. Returns the pieces of its path and the rays that leave:
 *
 *   segments  { x0, y0, x1, y1, power, inside }; x1 is null for a ray that
 *             leaves the table (it goes on along dx, dy)
 *   exits     { x, y, dx, dy, power, order, deviation }: `order` is how many
 *             times it bounced inside (−1 for light that glanced off the
 *             outside), `deviation` how far it was turned, in degrees,
 *             positive anticlockwise
 */
export function traceRay(key, turn, oy, nm, { faintest = 0.003 } = {}) {
  const shape = SHAPES[key];
  const n = shape.index(nm);
  const points = shape.circle ? null : turned(shape, turn);
  const segments = [];
  const exits = [];
  const leave = (x, y, dx, dy, power, order) => {
    segments.push({
      x0: x,
      y0: y,
      x1: null,
      y1: null,
      dx,
      dy,
      power,
      inside: false,
    });
    exits.push({
      x,
      y,
      dx,
      dy,
      power,
      order,
      deviation: Math.atan2(dy, dx) / DEG,
    });
  };

  const ox = -6;
  const first = meet(shape, points, ox, oy, 1, 0, false);
  if (!first) {
    segments.push({
      x0: ox,
      y0: oy,
      x1: null,
      y1: null,
      dx: 1,
      dy: 0,
      power: 1,
      inside: false,
      missed: true,
    });
    return { segments, exits, missed: true };
  }
  const x = ox + first.t;
  segments.push({ x0: ox, y0: oy, x1: x, y1: oy, power: 1, inside: false });
  let cos = -first.nx;
  const off = fresnel(cos, 1, n);
  leave(x, oy, 1 + 2 * cos * first.nx, 2 * cos * first.ny, off, -1);

  // In, bent toward the normal.
  const eta = 1 / n;
  const k = eta * cos - Math.sqrt(1 - eta * eta * (1 - cos * cos));
  const stack = [
    {
      x,
      y: oy,
      dx: eta + k * first.nx,
      dy: k * first.ny,
      power: 1 - off,
      order: 0,
    },
  ];
  while (stack.length) {
    const ray = stack.pop();
    const hit = meet(shape, points, ray.x, ray.y, ray.dx, ray.dy, true);
    if (!hit) continue;
    const hx = ray.x + ray.dx * hit.t;
    const hy = ray.y + ray.dy * hit.t;
    segments.push({
      x0: ray.x,
      y0: ray.y,
      x1: hx,
      y1: hy,
      power: ray.power,
      inside: true,
    });
    cos = ray.dx * hit.nx + ray.dy * hit.ny;
    const back = fresnel(cos, n, 1);
    if (back < 1) {
      // Out, bent away from the normal.
      const ko = Math.sqrt(1 - n * n * (1 - cos * cos)) - n * cos;
      const power = ray.power * (1 - back);
      if (power > faintest) {
        leave(
          hx,
          hy,
          n * ray.dx + ko * hit.nx,
          n * ray.dy + ko * hit.ny,
          power,
          ray.order,
        );
      }
    }
    const power = ray.power * back;
    if (power > faintest && ray.order < 6) {
      stack.push({
        x: hx,
        y: hy,
        dx: ray.dx - 2 * cos * hit.nx,
        dy: ray.dy - 2 * cos * hit.ny,
        power,
        order: ray.order + 1,
      });
    }
  }
  return { segments, exits, missed: false };
}

/**
 * The ray worth talking about, for a ray of green light: the brightest one
 * that left after bouncing inside as many times as the shape is known for.
 * Null if the ray missed, or none got out that way.
 */
export function mainExit(key, turn, oy) {
  const { exits } = traceRay(key, turn, oy, 550);
  const want = SHAPES[key].order;
  let best = null;
  for (const e of exits) {
    if (e.order === want && (!best || e.power > best.power)) best = e;
  }
  return best;
}

/** How far across the beam the shape reaches, either side of its middle. */
export function reachOf(key) {
  const shape = SHAPES[key];
  if (shape.circle) return 1;
  return Math.max(...shape.outline.map(([x, y]) => Math.hypot(x, y)));
}

/**
 * Where the light goes if the shape is turned every way and lit all over: a
 * count of leaving light by how far it was turned, in half-degree steps from
 * −180° to 180°, three channels each, its brightest step at 1. This is the
 * sky's own experiment, done on the bench: a cloud is a great many crystals
 * at every angle, and a halo is where their light piles up.
 */
export function ringOf(key, { turns = 240, rays = 72 } = {}) {
  const shape = SHAPES[key];
  const bins = 720;
  const raw = new Float32Array(bins * 3);
  const reach = reachOf(key);
  const steps = shape.circle ? 1 : turns;
  const across = shape.circle ? rays * 12 : rays;
  // Evenly spaced turns land their light in evenly spaced stripes. A little
  // scatter in each step (the same scatter every time) breaks them up.
  const scatter = mulberry(1637);
  for (let t = 0; t < steps; t++) {
    for (let r = 0; r < across; r++) {
      const turn = ((t + scatter()) / steps) * shape.fold;
      const oy = (((r + scatter()) / across) * 2 - 1) * reach;
      for (const band of BANDS) {
        const { exits } = traceRay(key, turn, oy, band.nm, { faintest: 0.002 });
        for (const e of exits) {
          // A sphere bounces a little light round and round; past the second
          // bow it is too faint to see and only muddies the picture.
          if (e.order > 2) continue;
          const bin = Math.min(bins - 1, Math.floor((e.deviation + 180) * 2));
          raw[bin * 3] += e.power * band.rgb[0];
          raw[bin * 3 + 1] += e.power * band.rgb[1];
          raw[bin * 3 + 2] += e.power * band.rgb[2];
        }
      }
    }
  }
  // Smoothed over a degree and a half, about what the sun's width does.
  const ring = new Float32Array(bins * 3);
  for (let b = 0; b < bins; b++) {
    for (let c = 0; c < 3; c++) {
      const at = (o) => raw[((b + o + bins) % bins) * 3 + c];
      ring[b * 3 + c] = (at(-1) + 2 * at(0) + at(1)) / 4;
    }
  }
  // Light that went straight through, or nearly, is the sun itself. It
  // would drown the rest, so the scale is set by what is away from it.
  // A drop sends most of its light on forward; the bow is in what comes
  // back, so for a drop the scale is set by the back half.
  const from = shape.circle ? 90 : 6;
  let peak = 0;
  for (let b = 0; b < bins; b++) {
    const deg = Math.abs(b / 2 - 180);
    if (deg < from) continue;
    peak = Math.max(peak, ring[b * 3], ring[b * 3 + 1], ring[b * 3 + 2]);
  }
  for (let i = 0; i < ring.length; i++) ring[i] = Math.min(1, ring[i] / peak);
  return ring;
}
