// A small seeded random number generator (mulberry32). The island is drawn
// from one of these, so a seed is an island: the same number always grows the
// same coast, the same trees, the same village.

export function createRng(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable hash of two integers to [0, 1): per-tile variety without a stream. */
export function hash2(x, y, seed = 0) {
  let h =
    (Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul(seed | 0, 2246822519)) >>>
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
