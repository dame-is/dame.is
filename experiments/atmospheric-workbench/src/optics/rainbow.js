// The rainbow, from one raindrop.
//
// A drop is a sphere, so everything about it is settled by how far off
// centre a ray hits it. Follow rays across the whole face of the drop, let
// each cross in, bounce once or twice inside and cross out, and count where
// they go: they crowd toward one angle and stop there. That crowd is the bow
// (Descartes worked it this way in 1637). One bounce makes the primary, 42°
// from the point opposite the sun; two make the secondary, 51° from it and
// the other way up. No ray of either kind lands between them, which is
// Alexander's dark band.
//
// This is geometric optics, so it leaves out what the wave nature of light
// adds: the faint extra bands inside the primary (supernumeraries) and the
// way small drops wash the colours out into a fogbow.

import { fresnelParts, waterIndex } from './media.js';
import { spectrum } from './spectrum.js';
import { SUN_RADIUS } from './halo.js';

/** How far from the point opposite the sun the table goes, in degrees. */
export const BOW_REACH = 72;

/**
 * Where light of index `n` piles up after `bounces` reflections inside a
 * drop, in degrees from the point opposite the sun.
 */
export function bowAngle(n, bounces) {
  const k = bounces + 1;
  const cosI = Math.sqrt((n * n - 1) / (k * k - 1));
  const i = Math.acos(cosI);
  const r = Math.asin(Math.sin(i) / n);
  const turned = 2 * (i - r) + bounces * (Math.PI - 2 * r);
  const from = Math.abs(Math.PI - (turned % (2 * Math.PI)));
  return (from * 180) / Math.PI;
}

/**
 * The brightness and colour of the sky by angle from the point opposite the
 * sun: `bins` steps from 0 to BOW_REACH, three channels each, with its
 * brightest value at 1.
 */
export function rainbowTable({ bins = 1024, bands = 64, rays = 4000 } = {}) {
  const table = new Float32Array(bins * 3);
  const perDegree = bins / BOW_REACH;
  for (const { nm, rgb } of spectrum(bands)) {
    const n = waterIndex(nm);
    for (let j = 0; j < rays; j++) {
      // Evenly over the drop's face: the square root spreads them by area.
      const b = Math.sqrt((j + 0.5) / rays);
      const i = Math.asin(b);
      const r = Math.asin(b / n);
      const [rs, rp] = fresnelParts(Math.cos(i), 1, n);
      for (let bounces = 1; bounces <= 2; bounces++) {
        const turned = 2 * (i - r) + bounces * (Math.PI - 2 * r);
        const from =
          (Math.abs(Math.PI - (turned % (2 * Math.PI))) * 180) / Math.PI;
        const bin = Math.floor(from * perDegree);
        if (bin < 0 || bin >= bins) continue;
        // In, off the back `bounces` times, and out, for each polarisation.
        const power =
          ((1 - rs) ** 2 * rs ** bounces + (1 - rp) ** 2 * rp ** bounces) / 2;
        // The same light on a smaller ring of sky is brighter.
        const ring = Math.sin(((bin + 0.5) / perDegree / 180) * Math.PI);
        const w = power / Math.max(ring, 0.02);
        table[bin * 3] += w * rgb[0];
        table[bin * 3 + 1] += w * rgb[1];
        table[bin * 3 + 2] += w * rgb[2];
      }
    }
  }
  // Blur by the width of the sun, and scale to 1.
  const reach = Math.max(1, Math.round(SUN_RADIUS * perDegree));
  const out = new Float32Array(bins * 3);
  let peak = 0;
  for (let b = 0; b < bins; b++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      let count = 0;
      for (let o = -reach; o <= reach; o++) {
        const at = b + o;
        if (at < 0 || at >= bins) continue;
        sum += table[at * 3 + c];
        count++;
      }
      out[b * 3 + c] = sum / count;
      peak = Math.max(peak, out[b * 3 + c]);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}
