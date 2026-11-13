// Where the eye is. The camera orbits a point on the bench: all the plates
// from above, or one of them up close.

import {
  invert,
  lookAt,
  multiply,
  normalize,
  perspective,
  sub,
  transformPoint,
} from './math.js';

/** Vertical field of view. Long, like a copy-stand lens, so a dish seen
 *  from above is a circle and not a keystone. */
export const FOV_Y = (26 * Math.PI) / 180;

/**
 * The matrices for an orbit: `azimuth` around the vertical (0 = from the
 * front of the bench), `elevation` above the horizon (π/2 = straight down),
 * `distance` from the target in mm. `shift` moves the middle of the picture
 * off the middle of the canvas, in normalised device units, so the target
 * can sit in the middle of whatever part of the canvas the page leaves
 * uncovered (see `framing`) without the lens tilting to find it.
 */
export function orbit({
  target,
  azimuth,
  elevation,
  distance,
  aspect,
  shift = [0, 0],
}) {
  // Straight down is degenerate for a look-at with a vertical "up".
  const el = Math.min(elevation, Math.PI / 2 - 0.001);
  const eye = [
    target[0] + distance * Math.cos(el) * Math.sin(azimuth),
    target[1] + distance * Math.sin(el),
    target[2] + distance * Math.cos(el) * Math.cos(azimuth),
  ];
  const view = lookAt(eye, target);
  const proj = perspective(
    FOV_Y,
    aspect,
    Math.max(4, distance * 0.05),
    distance * 6 + 2000,
  );
  // An off-axis lens: x and y in clip space each gain shift × w, so after
  // the divide every point moves by `shift`, and nothing else changes.
  proj[8] = -shift[0];
  proj[9] = -shift[1];
  const viewProj = multiply(proj, view);
  return { eye, viewProj, inverse: invert(viewProj) };
}

/**
 * The distance from which a rectangle on the bench, `halfW` by `halfD` mm
 * about the target, just fits the view when seen from `elevation`. Seen
 * from above it has to fit both ways; seen from low down its depth
 * foreshortens, but its near edge comes toward the eye, and that has to
 * fit too. `aspect` is the shape of the part of the canvas it has to fit
 * in, and `fill` how much of the canvas's height that part is.
 */
export function fitDistance(
  halfW,
  halfD,
  elevation,
  aspect,
  margin = 1.08,
  fill = 1,
) {
  const tanV = Math.tan(FOV_Y / 2) * fill;
  const tanH = tanV * aspect;
  const acrossWidth = halfW / tanH + halfD * Math.cos(elevation);
  const acrossDepth =
    (halfD * Math.sin(elevation)) / tanV + halfD * Math.cos(elevation);
  return Math.max(acrossWidth, acrossDepth) * margin;
}

/**
 * Where a point on the canvas lands on a horizontal plane at height `y`:
 * `[x, z]` on the bench, or null if the ray never comes down to it.
 * `nx`, `ny` are in normalised device coordinates (−1…1, y up).
 */
export function pickPlane(camera, nx, ny, y) {
  if (!camera.inverse) return null;
  const a = transformPoint(camera.inverse, [nx, ny, -1]);
  const b = transformPoint(camera.inverse, [nx, ny, 1]);
  const dir = normalize(sub(b, a));
  if (Math.abs(dir[1]) < 1e-6) return null;
  const t = (y - a[1]) / dir[1];
  if (t <= 0) return null;
  return [a[0] + dir[0] * t, a[2] + dir[2] * t];
}

/**
 * The part of a canvas `width` by `height` CSS px left uncovered by
 * `insets` (the page's bars and sheets, in CSS px from each edge): its
 * shape, how much of the canvas's height it is, and how far its middle is
 * from the canvas's, in normalised device units. Never less than a fifth
 * of either side, however much is laid over it.
 */
export function framing(width, height, insets = {}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const { top = 0, right = 0, bottom = 0, left = 0 } = insets;
  const fw = Math.max(0.2, (w - left - right) / w);
  const fh = Math.max(0.2, (h - top - bottom) / h);
  return {
    aspect: (w * fw) / (h * fh),
    fill: fh,
    shift: [(left - right) / w, (bottom - top) / h],
  };
}

/** A point on the bench, in normalised device coordinates. */
export function project(camera, point) {
  return transformPoint(camera.viewProj, point);
}

/**
 * Where `count` dishes sit on the bench: a grid as close to the viewport's
 * own shape as it can be, centred on the origin. Returns `[x, z]` for each
 * and the radius of the circle that holds them all.
 */
export function benchLayout(count, aspect, pitch = 104) {
  let best = { cols: count, rows: 1, score: Infinity };
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    // How badly the grid's shape misses the viewport's, plus a little
    // for every empty place in it.
    const score =
      Math.abs(Math.log(cols / rows / aspect)) + 0.15 * (cols * rows - count);
    if (score < best.score) best = { cols, rows, score };
  }
  const { cols, rows } = best;
  const centres = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    centres.push([
      (col - (cols - 1) / 2) * pitch,
      (row - (rows - 1) / 2) * pitch,
    ]);
  }
  const halfW = ((cols - 1) / 2) * pitch + pitch / 2;
  const halfH = ((rows - 1) / 2) * pitch + pitch / 2;
  return { centres, cols, rows, halfW, halfH };
}
