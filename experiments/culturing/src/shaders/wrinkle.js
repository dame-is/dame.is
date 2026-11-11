// The wrinkle passes.
//
// A biofilm is a film stuck to a softer gel and still growing. It can't
// spread as fast as it grows, so it goes into compression, and past a
// threshold a compressed film on a soft bed buckles into wrinkles of one
// preferred width (set by the film's thickness and by how much stiffer it is
// than the agar). The equation that has exactly that behaviour, a band of
// wavelengths that grows and everything else decaying, is Swift–Hohenberg:
//
//   du/dt = r u − (q² + ∇²)² u + g q u² − q² u³
//
// with r the compression past threshold and 2π/√q² the wavelength. Left to
// itself it draws a labyrinth, which is what the middle of a wrinkled colony
// looks like. Out toward the edge the film is squeezed around its
// circumference but free along the radius, and real colonies show radial
// spokes there; the extra term below smooths u along the direction the
// colony grew in, which lines the ridges up with it.
//
// The fourth derivative is taken as a Laplacian of a Laplacian over two
// passes, each with the isotropic nine-point stencil, so the ridges turn
// freely and do not lock to the grid.

import { HEADER, HASH, STENCIL } from './common.js';

/** Pass one: the Laplacian of u, and every term that needs only u's own
 *  neighbourhood. Writes (u, ∇²u, linear terms, 0). */
export const WRINKLE_A_FRAGMENT = `${HEADER}
uniform sampler2D uWr;
uniform sampler2D uAux;
uniform sampler2D uD;

uniform vec4 uWrDrive;   // how readily each culture's film buckles
uniform vec4 uWrQ2;      // (2π / wavelength in texels)², per culture
uniform vec4 uWrRadial;  // how strongly the ridges line up with growth
uniform vec4 uWrBump;    // > 0 turns ridges toward pustules
uniform vec4 uWrSport;   // a sport's wrinkling, relative to its parent's
uniform float uWrOnset;  // biofilm density where buckling starts
uniform float uWrFull;   // ... and where it is fully driven
uniform float uWrEnv;    // dry air, stiff agar and low oxygen all add to it

layout(location = 0) out vec4 o;

${STENCIL}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 aux = texelFetch(uAux, p, 0);
  float u = texelFetch(uWr, p, 0).r;
  if (aux.a < 0.5) {
    o = vec4(0.0);
    return;
  }

  float nb[8];
  float lap = 0.0;
  for (int j = 0; j < 8; j++) {
    nb[j] = texelFetch(uWr, p + OFF[j], 0).r;
    lap += WGT[j] * (nb[j] - u);
  }

  vec4 d = texelFetch(uD, p, 0);
  float rhoD = dot(d, ONE);
  vec4 share = d / max(rhoD, 1e-6);
  vec4 drive = uWrDrive * mix(ONE, uWrSport, aux.b);
  float film = smoothstep(uWrOnset, uWrFull, rhoD);
  float q2 = max(dot(share, uWrQ2), 0.05);
  // Positive where the film is past its buckling threshold; firmly negative
  // where there is no film, so a scraped patch goes flat again.
  float eps = film * dot(share, drive) * uWrEnv - (1.0 - film) * 0.6;
  float r = eps * q2 * q2;

  // The direction this patch of colony grew in: straight down the gradient
  // of the hour it arrived.
  float tE = texelFetch(uAux, p + ivec2(1, 0), 0).r;
  float tW = texelFetch(uAux, p - ivec2(1, 0), 0).r;
  float tN = texelFetch(uAux, p + ivec2(0, 1), 0).r;
  float tS = texelFetch(uAux, p - ivec2(0, 1), 0).r;
  vec2 g = vec2(0.0);
  if (aux.r >= 0.0 && min(min(tE, tW), min(tN, tS)) >= 0.0) g = vec2(tE - tW, tN - tS);
  float gl = length(g);
  float aniso = 0.0;
  if (gl > 1e-4) {
    vec2 dir = g / gl;
    // d²u/dr² from the 3×3 neighbourhood. OFF: E W N S NE NW SE SW.
    float uxx = nb[0] + nb[1] - 2.0 * u;
    float uyy = nb[2] + nb[3] - 2.0 * u;
    float uxy = 0.25 * (nb[4] - nb[5] - nb[6] + nb[7]);
    float urr = dir.x * dir.x * uxx + 2.0 * dir.x * dir.y * uxy + dir.y * dir.y * uyy;
    // Fades in with how well the direction is defined: none inside the
    // inoculum, where everything arrived at once.
    aniso = dot(share, uWrRadial) * q2 * smoothstep(0.0, 0.5, gl) * urr;
  }

  float bump = dot(share, uWrBump);
  float lin = (r - q2 * q2) * u - 2.0 * q2 * lap + aniso + bump * q2 * u * u;
  o = vec4(u, lap, lin, q2);
}
`;

/** Pass two: the Laplacian of the Laplacian, the cubic that stops the
 *  growth, and the step forward. Writes (u, 0, 0, 0). */
export const WRINKLE_B_FRAGMENT = `${HEADER}
uniform sampler2D uWrA;
uniform sampler2D uAux;
uniform float uWrDt;
uniform uint uStep;
uniform uint uSeed;

layout(location = 0) out vec4 o;

${HASH}
${STENCIL}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (texelFetch(uAux, p, 0).a < 0.5) {
    o = vec4(0.0);
    return;
  }
  vec4 c = texelFetch(uWrA, p, 0);
  float lapLap = 0.0;
  for (int j = 0; j < 8; j++) {
    lapLap += WGT[j] * (texelFetch(uWrA, p + OFF[j], 0).g - c.g);
  }
  float u = c.r;
  float q2 = c.a;
  float du = c.b - lapLap - q2 * q2 * u * u * u;
  // Something has to start a wrinkle; a film is never perfectly flat.
  float seed = (hash(p, uSeed ^ (uStep * 40503u)) - 0.5) * 2e-3;
  o = vec4(clamp(u + uWrDt * du + seed, -2.5, 2.5), 0.0, 0.0, 0.0);
}
`;
