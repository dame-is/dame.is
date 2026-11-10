// Building blocks for the models: boxes, blobs and prisms that carry their
// colour on their vertices, and a way to merge a pile of them into one
// geometry. Every model in the game is a few of these stuck together.

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const scratch = new Color();
const matrix = new Matrix4();
const quaternion = new Quaternion();
const UP = new Vector3(0, 1, 0);

// Every part ends up with exactly position, normal and colour, unindexed, so
// any of them can be merged with any other.
function finish(geometry, color, at, rotation, scale) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  g.deleteAttribute('uv');
  if (scale || rotation || at) {
    quaternion.setFromEuler(new Euler(...(rotation || [0, 0, 0])));
    matrix.compose(
      new Vector3(...(at || [0, 0, 0])),
      quaternion,
      new Vector3(...(scale || [1, 1, 1])),
    );
    g.applyMatrix4(matrix);
  }
  return paint(g, color);
}

/** Give a geometry one flat colour, as a vertex attribute. */
export function paint(geometry, color) {
  scratch.set(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** A box of `size` [w, h, d] centred on `at`. */
export function box(size, color, at, rotation) {
  return finish(
    new BoxGeometry(size[0], size[1], size[2]),
    color,
    at,
    rotation,
  );
}

/** A round blob: a subdivided icosahedron with smooth normals. */
export function blob(radius, color, at, scale, detail = 1) {
  return finish(
    new IcosahedronGeometry(radius, detail),
    color,
    at,
    null,
    scale,
  );
}

/** A faceted lump: the same icosahedron, left with its flat faces. */
export function lump(radius, color, at, scale, rotation) {
  return finish(new IcosahedronGeometry(radius, 0), color, at, rotation, scale);
}

/** An upright cylinder (or a cone, with a different radius at each end). */
export function cylinder(top, bottom, height, color, at, sides = 6) {
  return finish(new CylinderGeometry(top, bottom, height, sides), color, at);
}

/**
 * A pitched roof: a triangular prism `length` along x, `width` across z and
 * `height` tall, sitting with its eaves at y = 0, its ridge along x.
 */
export function roof(length, width, height, color, at, rotation) {
  const l = length / 2;
  const w = width / 2;
  // prettier-ignore
  const corners = {
    a: [-l, 0, -w], b: [l, 0, -w], c: [l, 0, w], d: [-l, 0, w],
    e: [-l, height, 0], f: [l, height, 0],
  };
  const { a, b, c, d, e, f } = corners;
  // prettier-ignore
  const triangles = [
    d, c, f,  d, f, e,   // the slope facing +z
    b, a, e,  b, e, f,   // the slope facing -z
    a, d, e,             // the gable at -x
    c, b, f,             // the gable at +x
    a, b, c,  a, c, d,   // the underside
  ];
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(triangles.flat()), 3),
  );
  g.computeVertexNormals();
  return finish(g, color, at, rotation);
}

/**
 * A thin square bar from point `from` to point `to`: a wire, a strut, a
 * strip along the ground.
 */
export function bar(from, to, thickness, color) {
  const start = new Vector3(...from);
  const end = new Vector3(...to);
  const length = start.distanceTo(end);
  const g = new BoxGeometry(thickness, length, thickness).toNonIndexed();
  g.deleteAttribute('uv');
  quaternion.setFromUnitVectors(UP, end.clone().sub(start).normalize());
  matrix.compose(
    start.clone().add(end).multiplyScalar(0.5),
    quaternion,
    new Vector3(1, 1, 1),
  );
  g.applyMatrix4(matrix);
  return paint(g, color);
}

/** Merge parts into one geometry, and dispose of the parts. */
export function merge(parts) {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}
