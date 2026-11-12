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
// textures and on the half-resolution agar and reagent ones.

import { HEADER, HASH, LATTICE, VESSEL } from './common.js';

function stampFragment({ samplers, hardThird }) {
  const each = (fn) => samplers.map((_, i) => fn(i)).join('\n');
  return `${HEADER}
${each((i) => `uniform sampler2D ${samplers[i]};`)}
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
uniform float uClump;      // > 0: speckled in clumps this many mm across instead
uniform uint uSeed;
uniform bool uNeedsAgar;   // false only for the stamp that cuts or pours
// A strip soaked in a gradient: what is added falls along the path, by
// exp(uTaper) from its start to its end (0: the same all the way).
uniform float uTaper;
// Not a capsule but a ramp across the whole plate: none of it behind uFrom,
// all of it past uTo, and in proportion between. A gradient plate's wedge.
uniform bool uRamp;

${each(
  (i) => `uniform vec4 uClear${i};
uniform vec4 uAdd${i};`,
)}

${each((i) => `layout(location = ${i}) out vec4 o${i};`)}

${HASH}
${LATTICE}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
${each((i) => `  vec4 s${i} = texelFetch(${samplers[i]}, p, 0);`)}

  vec2 mm = (gl_FragCoord.xy / uTexels - 0.5) * uSpan;
  vec2 ab = uTo - uFrom;
  float t = dot(ab, ab) > 1e-8 ? clamp(dot(mm - uFrom, ab) / dot(ab, ab), 0.0, 1.0) : 0.0;
  float dist = length(mm - (uFrom + t * ab));

  float k = 1.0 - smoothstep(uRadius - uFeather, uRadius, dist);
  if (uRamp) k = t;
  // A drop dries from its edge, and the flow that feeds the edge carries
  // the cells there: more lands at the rim than in the middle.
  float rim = exp(-pow((dist - (uRadius - uFeather)) / max(uFeather * 1.5, 1e-3), 2.0));
  float kRing = k * (1.0 + uRing * rim) * exp(uTaper * t);
  if (uSpeckle < 1.0) {
    // Cell by cell, or in clumps: the strains of a mixed drop don't land
    // one cell here and one there, they settle out in patches, and a patch
    // at the rim of the drop is what a sector grows from. The clumps are
    // sized in millimetres, so a drop sorts the same on any grid.
    float chance = hash(p, uSeed);
    if (uClump > 0.0) {
      vec2 q = mm / uClump + 311.7;
      chance = 0.5 + 0.5 * (0.7 * lattice(q, uSeed)
        + 0.45 * lattice(mat2(0.8, -0.6, 0.6, 0.8) * q * 2.3, uSeed + 13u));
    }
    kRing *= step(chance, uSpeckle);
  }
  if (uNeedsAgar) {
    float agar = texelFetch(uMask, ivec2(vec2(p) * uMaskScale), 0).a;
    k *= step(0.5, agar);
    kRing *= step(0.5, agar);
  }

${each((i) =>
  hardThird && i === 2
    ? // The third surface texture holds the hour of arrival and the agar
      // mask, which are either one thing or another: no soft edge. And
      // it is decided for each 2×2 block of texels together, from the
      // block's centre, because the agar pass has one texel under each
      // block and the two have to agree about where the gel ends.
      `  vec2 blockMm = ((floor(gl_FragCoord.xy * 0.5) * 2.0 + 1.0) / uTexels - 0.5) * uSpan;
  float tb = dot(ab, ab) > 1e-8 ? clamp(dot(blockMm - uFrom, ab) / dot(ab, ab), 0.0, 1.0) : 0.0;
  float kh = step(length(blockMm - (uFrom + tb * ab)), uRadius - 0.5 * uFeather);
  if (uNeedsAgar) kh *= step(0.5, s2.a);
  o2 = s2 * (1.0 - kh * uClear2) + kh * uAdd2;`
    : `  o${i} = s${i} * (1.0 - min(k, 1.0) * uClear${i}) + kRing * uAdd${i};`,
)}
}
`;
}

export const STAMP_SURFACE_FRAGMENT = stampFragment({
  samplers: ['uB', 'uD', 'uAux'],
  hardThird: true,
});

export const STAMP_AGAR_FRAGMENT = stampFragment({
  samplers: ['uC0', 'uC1', 'uC2', 'uC3'],
  hardThird: false,
});

/** The reagents put on from the tray: stains, indicators, dyes. */
export const STAMP_REAGENT_FRAGMENT = stampFragment({
  samplers: ['uR0', 'uR1', 'uR2'],
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
uniform int uVessel;
uniform float uDivider;
uniform vec3 uWells[6];

layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;

${HASH}
${LATTICE}
${VESSEL}
void main() {
  vec2 mm = (gl_FragCoord.xy / uTexels - 0.5) * uSpan;
  // In or out is decided for each 2×2 block of texels together, from the
  // block's centre: the agar pass has one texel under each block, and the
  // two have to agree about where the gel ends.
  vec2 blockMm = ((floor(gl_FragCoord.xy * 0.5) * 2.0 + 1.0) / uTexels - 0.5) * uSpan;
  int part;
  float inside = step(0.0, insideVessel(blockMm, part));
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

/**
 * Pouring a plate, as far as the agar is concerned: each compartment filled
 * with its own medium's food and pH, and told which it is. Every texel gets
 * a compartment, the nearest, so that one just outside the gel still says
 * whose edge it is.
 */
export const POUR_AGAR_FRAGMENT = `${HEADER}
uniform float uTexels;
uniform float uSpan;
uniform float uRadius;
uniform int uVessel;
uniform float uDivider;
uniform vec3 uWells[6];
uniform float uNutrient[6];
uniform float uPh[6];

layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;

${VESSEL}
void main() {
  vec2 mm = (gl_FragCoord.xy / uTexels - 0.5) * uSpan;
  int part;
  insideVessel(mm, part);
  float n = uNutrient[part];
  float ph = uPh[part];
  o0 = vec4(n, 0.0, 0.0, 0.0);
  o1 = vec4(ph, 0.0, n, 0.0);
  o2 = vec4(0.0);
  o3 = vec4(float(part), ph, 0.0, 0.0);
}
`;
