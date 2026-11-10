// The little linear algebra a camera needs. Column-major 4×4 matrices as
// Float32Array(16), the layout WebGL takes; vectors as plain arrays.

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(eye, target, up = [0, 1, 0]) {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const out = new Float32Array(16);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;
  return out;
}

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** General 4×4 inverse (cofactors). Returns null for a singular matrix. */
export function invert(m) {
  const out = new Float32Array(16);
  const b00 = m[0] * m[5] - m[1] * m[4];
  const b01 = m[0] * m[6] - m[2] * m[4];
  const b02 = m[0] * m[7] - m[3] * m[4];
  const b03 = m[1] * m[6] - m[2] * m[5];
  const b04 = m[1] * m[7] - m[3] * m[5];
  const b05 = m[2] * m[7] - m[3] * m[6];
  const b06 = m[8] * m[13] - m[9] * m[12];
  const b07 = m[8] * m[14] - m[10] * m[12];
  const b08 = m[8] * m[15] - m[11] * m[12];
  const b09 = m[9] * m[14] - m[10] * m[13];
  const b10 = m[9] * m[15] - m[11] * m[13];
  const b11 = m[10] * m[15] - m[11] * m[14];
  const det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const k = 1 / det;
  out[0] = (m[5] * b11 - m[6] * b10 + m[7] * b09) * k;
  out[1] = (m[2] * b10 - m[1] * b11 - m[3] * b09) * k;
  out[2] = (m[13] * b05 - m[14] * b04 + m[15] * b03) * k;
  out[3] = (m[10] * b04 - m[9] * b05 - m[11] * b03) * k;
  out[4] = (m[6] * b08 - m[4] * b11 - m[7] * b07) * k;
  out[5] = (m[0] * b11 - m[2] * b08 + m[3] * b07) * k;
  out[6] = (m[14] * b02 - m[12] * b05 - m[15] * b01) * k;
  out[7] = (m[8] * b05 - m[10] * b02 + m[11] * b01) * k;
  out[8] = (m[4] * b10 - m[5] * b08 + m[7] * b06) * k;
  out[9] = (m[1] * b08 - m[0] * b10 - m[3] * b06) * k;
  out[10] = (m[12] * b04 - m[13] * b02 + m[15] * b00) * k;
  out[11] = (m[9] * b02 - m[8] * b04 - m[11] * b00) * k;
  out[12] = (m[5] * b07 - m[4] * b09 - m[6] * b06) * k;
  out[13] = (m[0] * b09 - m[1] * b07 + m[2] * b06) * k;
  out[14] = (m[13] * b01 - m[12] * b03 - m[14] * b00) * k;
  out[15] = (m[8] * b03 - m[9] * b01 + m[10] * b00) * k;
  return out;
}

/** A point through a matrix, with the perspective divide. */
export function transformPoint(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w, z / w];
}

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
