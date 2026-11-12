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
// Three more things a real colony does, each one rule here:
//
//   A fold is a few times as wide as its film is thick, and a film goes on
//   thickening and stiffening for days. So the preferred width is not one
//   number: it grows with how long the film here has been a film
//   (uWrCoarsen; the hours are kept beside u, in the same texture). New
//   growth at the rim comes up in fine ridges, and the old middle can only
//   hold broad ones, so ridges merge on the way in. That is the tree of
//   veins a Pseudomonas colony shows on Congo red.
//
//   The drop a colony was started from is not squeezed the way the rest is:
//   its cells were all put down at once, with nothing to push against. How
//   much it buckles is its own number (uWrCore), and a culture that sets it
//   to nothing keeps a flat disc in its middle with the veins starting at
//   its rim.
//
//   The quadratic term breaks the symmetry between up and down. Positive,
//   ridges break into pustules; negative, into a honeycomb of raised walls
//   round sunken cells.
//
// The fourth derivative is taken as a Laplacian of a Laplacian over two
// passes, each with the isotropic nine-point stencil, so the ridges turn
// freely and do not lock to the grid.

import { HEADER, HASH, STENCIL } from './common.js';

/** Pass one: the Laplacian of u, and every term that needs only u's own
 *  neighbourhood. Writes (u, ∇²u, those terms, the film's age in hours). */
export const WRINKLE_A_FRAGMENT = `${HEADER}
uniform sampler2D uWr;
uniform sampler2D uAux;
uniform sampler2D uD;

uniform vec4 uWrDrive;   // how readily each culture's film buckles
uniform vec4 uWrQ2;      // (2π / wavelength in texels)², per culture
uniform vec4 uWrRadial;  // how strongly the ridges line up with growth (< 0: across it)
uniform vec4 uWrBump;    // > 0 turns ridges toward pustules
uniform vec4 uWrSport;   // a sport's wrinkling, relative to its parent's
uniform vec4 uWrCoarsen; // how much broader a fold gets as its film ages
uniform vec4 uWrAgeing;  // hours over which it does
uniform vec4 uWrCore;    // how readily the inoculum itself buckles, 0..1
uniform float uWrHours;  // hours this pass moves the plate on
uniform float uWrOnset;  // biofilm density where buckling starts
uniform float uWrFull;   // ... and where it is fully driven
uniform float uWrEnv;    // dry air, stiff agar and low oxygen all add to it

layout(location = 0) out vec4 o;

${STENCIL}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 aux = texelFetch(uAux, p, 0);
  vec4 wr = texelFetch(uWr, p, 0);
  float u = wr.r;
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
  float film = smoothstep(uWrOnset, uWrFull, rhoD);
  // The width a fold wants here: the culture's own, and broader with every
  // hour the film has had to thicken since it was thick enough to buckle.
  // (Counted from then and not from when the first cells arrived: a film
  // has to start at its finest, or it has nothing to coarsen from.)
  float seasoned = film > 0.0 ? wr.g + uWrHours * film : 0.0;
  float old = 1.0 - exp(-seasoned / max(dot(share, uWrAgeing), 1.0));
  float broaden = 1.0 + dot(share, uWrCoarsen) * old;
  float q2 = max(dot(share, uWrQ2), 0.05) / (broaden * broaden);

  // The direction this patch of colony grew in: straight down the gradient
  // of the hour it arrived.
  float tE = texelFetch(uAux, p + ivec2(1, 0), 0).r;
  float tW = texelFetch(uAux, p - ivec2(1, 0), 0).r;
  float tN = texelFetch(uAux, p + ivec2(0, 1), 0).r;
  float tS = texelFetch(uAux, p - ivec2(0, 1), 0).r;
  vec2 g = vec2(0.0);
  if (aux.r >= 0.0 && min(min(tE, tW), min(tN, tS)) >= 0.0) g = vec2(tE - tW, tN - tS);
  float gl = length(g);
  // How well that direction is defined: not at all inside the inoculum,
  // where everything arrived at once.
  float grown = smoothstep(0.0, 0.5, gl);
  float aniso = 0.0;
  if (gl > 1e-4) {
    vec2 dir = g / gl;
    // d²u/dr², the curvature along the direction of growth, from the 3×3
    // neighbourhood (OFF: E W N S NE NW SE SW). It is taken twice, in the
    // grid's own axes and in its diagonals, and the two are blended by
    // which the direction lies nearer. Either alone is exact for a ridge
    // running along its own axes and a little off for one in between, and
    // that little is enough to pull every spoke toward the nearest axis:
    // a colony of straight lines at the four points of the compass.
    float uxx = nb[0] + nb[1] - 2.0 * u;
    float uyy = nb[2] + nb[3] - 2.0 * u;
    float uxy = 0.25 * (nb[4] - nb[5] - nb[6] + nb[7]);
    float onAxes = dir.x * dir.x * uxx + 2.0 * dir.x * dir.y * uxy + dir.y * dir.y * uyy;
    float udd = 0.5 * (nb[4] + nb[7] - 2.0 * u);
    float uaa = 0.5 * (nb[5] + nb[6] - 2.0 * u);
    float uda = 0.5 * (uyy - uxx);
    float dd = (dir.x + dir.y) * 0.7071068;
    float da = (dir.y - dir.x) * 0.7071068;
    float onDiagonals = dd * dd * udd + 2.0 * dd * da * uda + da * da * uaa;
    float cos2 = dir.x * dir.x - dir.y * dir.y;
    float urr = mix(onDiagonals, onAxes, cos2 * cos2);
    // Smoothed along the way it grew, the ridges run out as spokes. A
    // brittle film does the other thing: it breaks across the way it grew,
    // into rings, and a negative number here smooths round the colony
    // instead (what is left of the Laplacian once the radial part is out).
    float radial = dot(share, uWrRadial);
    aniso = abs(radial) * q2 * grown * (radial >= 0.0 ? urr : uxx + uyy - urr);
  }

  vec4 drive = uWrDrive * mix(ONE, uWrSport, aux.b) * mix(uWrCore, ONE, grown);
  // Positive where the film is past its buckling threshold; firmly negative
  // where there is no film, so a scraped patch goes flat again.
  float eps = film * dot(share, drive) * uWrEnv - (1.0 - film) * 0.6;
  float r = eps * q2 * q2;

  float bump = dot(share, uWrBump);
  // Every term carries the same power of the wavenumber, so a fold keeps
  // its shape whatever its width.
  float lin = (r - q2 * q2) * u - 2.0 * q2 * lap + aniso + bump * q2 * q2 * u * u;
  // The cubic that stops the growth is local too, so it is taken here.
  o = vec4(u, lap, lin - q2 * q2 * u * u * u, seasoned);
}
`;

/** Pass two: the Laplacian of the Laplacian, and the step forward. Writes
 *  (u, the film's age, 0, 0). */
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
  float du = c.b - lapLap;
  // Something has to start a wrinkle; a film is never perfectly flat.
  float seed = (hash(p, uSeed ^ (uStep * 40503u)) - 0.5) * 2e-3;
  o = vec4(clamp(u + uWrDt * du + seed, -2.5, 2.5), c.a, 0.0, 0.0);
}
`;
