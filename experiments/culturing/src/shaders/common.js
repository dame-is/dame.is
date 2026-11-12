// GLSL shared by the simulation passes.
//
// The state of one plate, as the passes see it (each a float RGBA texture):
//
//   uB    surface   the motile fraction of each of the plate's four cultures:
//                   the thin, travelling layer at a colony's edge
//   uD    surface   the settled fraction: the biofilm itself, which stays put,
//                   thickens, and is what the eye reads as the colony
//   uAux  surface   r  the hour biomass first arrived here, -1 until it does
//                   g  how far the pigment has come up, 0 to 1
//                   b  1 where a variant ("sport") founded this patch
//                   a  1 where there is agar, 0 outside the dish or in a cut
//   uWr   surface   r  the wrinkle field, signed, about -1 to 1
//                   g  the hours the film here has been thick enough to buckle
//   uC0   agar      nutrient near the surface, surfactant, toxin X, signal
//   uC1   agar      pH shift (+ acid, - alkali), enzyme, deep nutrient, toxin Y
//   uC2   agar      pigment dissolved in the agar, as RGB absorbance
//
// The agar textures are half the surface's resolution: what diffuses through
// a gel is smooth, and on a coarser grid it can diffuse sixteen times as far
// per step for the same stability.

export const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/**
 * Hashing on integers, so the noise is the same on every GPU and a plate
 * grown twice from one recipe on one machine comes out the same. (PCG's
 * output permutation; Jarzynski & Olano, "Hash Functions for GPU Rendering",
 * 2020.)
 */
export const HASH = `
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float hash(ivec2 p, uint k) {
  uint h = pcg(uint(p.x) + pcg(uint(p.y) + pcg(k)));
  return float(h) * (1.0 / 4294967295.0);
}
`;

/**
 * Smooth noise on a lattice, -1 to 1 (needs HASH). Asked for in millimetres
 * it is the same at every resolution.
 */
export const LATTICE = `
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
`;

/**
 * The eight neighbours and their weights in the isotropic nine-point
 * Laplacian, (1/6)[4·edges + corners − 20·centre]. The usual five-point
 * stencil is cheaper and wrong for this: its error is fourfold, so a front
 * that should be round grows corners, and dendrites line up with the grid.
 */
export const STENCIL = `
const ivec2 OFF[8] = ivec2[8](
  ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1),
  ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1)
);
const float WGT[8] = float[8](
  0.6666667, 0.6666667, 0.6666667, 0.6666667,
  0.1666667, 0.1666667, 0.1666667, 0.1666667
);
const vec4 ONE = vec4(1.0);
`;
