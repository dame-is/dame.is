// The stamp pass: whatever the hand does to a plate.
//
// A loop touching the agar, a streak dragged across it, a paper disc set
// down, a drop of dye, a scalpel cut: each is the same shape (a capsule, the
// path swept by something round) applied to a group of three textures. For
// every channel a stamp can add an amount, or first clear what is there.
//
//   new = old · (1 − k · clear) + k · add
//
// with k the stamp's coverage of this texel. Positions are in millimetres
// from the centre of the dish, so one gesture lands the same on the surface
// textures and on the half-resolution agar ones.

import { HEADER, HASH } from './common.js';

function stampFragment({ samplers, hardThird }) {
  return `${HEADER}
uniform sampler2D ${samplers[0]};
uniform sampler2D ${samplers[1]};
uniform sampler2D ${samplers[2]};
uniform sampler2D uMask;   // the surface's uAux, for where there is agar

uniform float uTexels;     // this target's size
uniform float uMaskScale;  // surface texels per texel of this target
uniform float uSpan;       // mm the texture covers
uniform vec2 uFrom;        // mm from the dish centre
uniform vec2 uTo;
uniform float uRadius;     // mm
uniform float uFeather;    // mm of soft edge
uniform float uRing;       // extra at the rim: the drying drop's coffee ring
uniform float uSpeckle;    // 1 = solid; less = that fraction of texels, at random
uniform uint uSeed;
uniform bool uNeedsAgar;   // false only for the stamp that cuts or pours

uniform vec4 uClear0;
uniform vec4 uAdd0;
uniform vec4 uClear1;
uniform vec4 uAdd1;
uniform vec4 uClear2;
uniform vec4 uAdd2;

layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;

${HASH}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s0 = texelFetch(${samplers[0]}, p, 0);
  vec4 s1 = texelFetch(${samplers[1]}, p, 0);
  vec4 s2 = texelFetch(${samplers[2]}, p, 0);

  vec2 mm = (gl_FragCoord.xy / uTexels - 0.5) * uSpan;
  vec2 ab = uTo - uFrom;
  float t = dot(ab, ab) > 1e-8 ? clamp(dot(mm - uFrom, ab) / dot(ab, ab), 0.0, 1.0) : 0.0;
  float dist = length(mm - (uFrom + t * ab));

  float k = 1.0 - smoothstep(uRadius - uFeather, uRadius, dist);
  // A drop dries from its edge, and the flow that feeds the edge carries
  // the cells there: more lands at the rim than in the middle.
  float rim = exp(-pow((dist - (uRadius - uFeather)) / max(uFeather * 1.5, 1e-3), 2.0));
  float kRing = k * (1.0 + uRing * rim);
  if (uSpeckle < 1.0) {
    kRing *= step(hash(p, uSeed), uSpeckle);
  }
  if (uNeedsAgar) {
    float agar = texelFetch(uMask, ivec2(vec2(p) * uMaskScale), 0).a;
    k *= step(0.5, agar);
    kRing *= step(0.5, agar);
  }

  o0 = s0 * (1.0 - min(k, 1.0) * uClear0) + kRing * uAdd0;
  o1 = s1 * (1.0 - min(k, 1.0) * uClear1) + kRing * uAdd1;
  ${
    hardThird
      ? // The third surface texture holds the hour of arrival and the agar
        // mask, which are either one thing or another: no soft edge. And
        // it is decided for each 2×2 block of texels together, from the
        // block's centre, because the agar pass has one texel under each
        // block and the two have to agree about where the gel ends.
        `vec2 blockMm = ((floor(gl_FragCoord.xy * 0.5) * 2.0 + 1.0) / uTexels - 0.5) * uSpan;
  float tb = dot(ab, ab) > 1e-8 ? clamp(dot(blockMm - uFrom, ab) / dot(ab, ab), 0.0, 1.0) : 0.0;
  float kh = step(length(blockMm - (uFrom + tb * ab)), uRadius - 0.5 * uFeather);
  if (uNeedsAgar) kh *= step(0.5, s2.a);
  o2 = s2 * (1.0 - kh * uClear2) + kh * uAdd2;`
      : `o2 = s2 * (1.0 - min(k, 1.0) * uClear2) + kRing * uAdd2;`
  }
}
`;
}

export const STAMP_SURFACE_FRAGMENT = stampFragment({
  samplers: ['uB', 'uD', 'uAux'],
  hardThird: true,
});

export const STAMP_AGAR_FRAGMENT = stampFragment({
  samplers: ['uC0', 'uC1', 'uC2'],
  hardThird: false,
});

/**
 * Pouring a plate, as far as the surface is concerned: nothing growing, no
 * memory, and agar out to the wall. The agar channel is 1 where there is
 * agar, give or take 0.4: the gel is never perfectly even, and the biology
 * pass reads that unevenness back as a little more or less give underfoot.
 * It is smooth noise on a millimetre scale, set in millimetres so the same
 * plate is as uneven at any resolution.
 */
export const POUR_SURFACE_FRAGMENT = `${HEADER}
uniform float uTexels;
uniform float uSpan;
uniform float uRadius;
uniform uint uSeed;

layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;

${HASH}

float lattice(vec2 x, uint k) {
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i, k);
  float b = hash(i + ivec2(1, 0), k);
  float c = hash(i + ivec2(0, 1), k);
  float d = hash(i + ivec2(1, 1), k);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * 2.0 - 1.0;
}

void main() {
  vec2 mm = (gl_FragCoord.xy / uTexels - 0.5) * uSpan;
  // In or out is decided for each 2×2 block of texels together, from the
  // block's centre: the agar pass has one texel under each block, and the
  // two have to agree about where the gel ends.
  vec2 blockMm = ((floor(gl_FragCoord.xy * 0.5) * 2.0 + 1.0) / uTexels - 0.5) * uSpan;
  float inside = step(length(blockMm), uRadius);
  // Offset well away from the lattice origin, and rotated between octaves,
  // so no axis of the noise lines up with the grid's.
  vec2 q = mm + 517.3;
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  float g = 0.55 * lattice(q / 0.7, uSeed)
    + 0.3 * lattice(turn * q / 1.9, uSeed + 17u)
    + 0.25 * lattice(q / 0.33, uSeed + 31u);
  o0 = vec4(0.0);
  o1 = vec4(0.0);
  o2 = vec4(-1.0, 0.0, 0.0, inside * (1.0 + 0.4 * clamp(g, -1.0, 1.0)));
}
`;
