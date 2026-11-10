// The chemistry pass: one step of everything dissolved in the agar.
//
// Twelve quantities diffuse through the gel, each at its own rate, each fed
// or drawn down by what is growing above it:
//
//   nutrient     eaten by growth; the shortage of it is what shapes a colony
//   deep nutrient  the rest of the 4 mm of agar under the surface, which
//                refills the top slowly. A fast swarm outruns it and has to
//                branch; a slow colony never notices
//   surfactant   made by swarmers; wets the surface and pushes them apart
//   toxin X, Y   antibiotics, from a disc or from a neighbour
//   signal       the quorum-sensing autoinducer: "there are many of us"
//   pH shift     acid from fermenting, alkali from old starved growth
//   enzyme       whatever a culture secretes that clears the medium
//   pigment      colour that leaves the colony and stains the agar
//
// It runs at half the surface's resolution (see common.js).

import { HEADER, STENCIL } from './common.js';

export const AGAR_FRAGMENT = `${HEADER}
uniform sampler2D uB;
uniform sampler2D uD;
uniform sampler2D uAux;
uniform sampler2D uC0;
uniform sampler2D uC1;
uniform sampler2D uC2;

uniform vec4 uDiff0;   // diffusion per step, on this grid
uniform vec4 uDiff1;
uniform vec4 uDiff2;
uniform vec4 uDecay0;  // first-order loss per step
uniform vec4 uDecay1;
uniform vec4 uDecay2;
uniform float uExchange;  // surface <-> deep nutrient, per step
uniform float uDeepRatio; // how much more the deep layer holds

uniform vec4 uGrowB;
uniform vec4 uGrowD;
uniform vec4 uKn;
uniform vec4 uCapB;
uniform vec4 uCutoff;
uniform vec4 uCapD;
uniform vec4 uActive;
uniform vec4 uTemp;
uniform vec4 uUptake;   // nutrient eaten per unit of growth

uniform vec4 uSurf;     // surfactant per unit of motile biomass
uniform vec4 uProdX;    // toxin X per unit of biofilm
uniform vec4 uProdY;
uniform vec4 uProdLate; // 1 = only pigmented (stationary) biofilm makes it
uniform vec4 uSignal;
uniform vec4 uAcid;     // pH shift per unit of growth
uniform vec4 uAlkali;   // ... and back the other way from starved biofilm
uniform vec4 uEnzyme;
uniform vec4 uPigR;     // absorbance secreted per unit of pigmented biofilm
uniform vec4 uPigG;
uniform vec4 uPigB;

layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;

${STENCIL}

void main() {
  ivec2 pc = ivec2(gl_FragCoord.xy);
  ivec2 pf = pc * 2;

  // The four surface texels over this one. Whether there is agar here is
  // decided by the first of them alone, and a neighbour is judged the same
  // way below. The two have to agree: a texel that held nothing while its
  // neighbours took it for open gel was a hole the plate drained through.
  vec4 x00 = texelFetch(uAux, pf, 0);
  vec4 x10 = texelFetch(uAux, pf + ivec2(1, 0), 0);
  vec4 x01 = texelFetch(uAux, pf + ivec2(0, 1), 0);
  vec4 x11 = texelFetch(uAux, pf + ivec2(1, 1), 0);
  if (x00.a < 0.5) {
    // Outside the gel nothing diffuses, but the surface pass interpolates
    // across the edge, so a texel just outside holds the mean of whatever
    // gel it touches rather than a zero that would read as a shortage.
    vec4 s0 = vec4(0.0);
    vec4 s1 = vec4(0.0);
    vec4 s2 = vec4(0.0);
    float count = 0.0;
    for (int j = 0; j < 8; j++) {
      ivec2 q = pc + OFF[j];
      float open = step(0.5, texelFetch(uAux, q * 2, 0).a);
      s0 += open * texelFetch(uC0, q, 0);
      s1 += open * texelFetch(uC1, q, 0);
      s2 += open * texelFetch(uC2, q, 0);
      count += open;
    }
    float inv = count > 0.0 ? 1.0 / count : 0.0;
    o0 = s0 * inv;
    o1 = s1 * inv;
    o2 = s2 * inv;
    return;
  }
  vec4 b = 0.25 * (
    texelFetch(uB, pf, 0) + texelFetch(uB, pf + ivec2(1, 0), 0) +
    texelFetch(uB, pf + ivec2(0, 1), 0) + texelFetch(uB, pf + ivec2(1, 1), 0)
  );
  vec4 d = 0.25 * (
    texelFetch(uD, pf, 0) + texelFetch(uD, pf + ivec2(1, 0), 0) +
    texelFetch(uD, pf + ivec2(0, 1), 0) + texelFetch(uD, pf + ivec2(1, 1), 0)
  );
  float pig = 0.25 * (x00.g + x10.g + x01.g + x11.g);

  vec4 c0 = texelFetch(uC0, pc, 0);
  vec4 c1 = texelFetch(uC1, pc, 0);
  vec4 c2 = texelFetch(uC2, pc, 0);

  // Diffusion, with nothing crossing the dish wall or a cut in the agar.
  // Over all eight neighbours, with the isotropic weights. Under a colony's
  // edge the food runs out over less than a texel, and with only the four
  // nearest the edge was fed faster along the grid's diagonals than along
  // its rows: round colonies grew square.
  vec4 l0 = vec4(0.0);
  vec4 l1 = vec4(0.0);
  vec4 l2 = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    ivec2 q = pc + OFF[j];
    float open = WGT[j] * step(0.5, texelFetch(uAux, q * 2, 0).a);
    l0 += open * (texelFetch(uC0, q, 0) - c0);
    l1 += open * (texelFetch(uC1, q, 0) - c1);
    l2 += open * (texelFetch(uC2, q, 0) - c2);
  }
  c0 += uDiff0 * l0 - uDecay0 * c0;
  c1 += uDiff1 * l1 - uDecay1 * c1;
  c2 += uDiff2 * l2 - uDecay2 * c2;

  // What the biomass above did this step.
  float n = max(c0.r, 0.0);
  vec4 fN = vec4(n) / (n + uKn);
  float rhoB = dot(b, ONE);
  float rhoD = dot(d, ONE);
  // The same growth law the biology pass uses (culture.js), less the
  // modifiers that only matter where something is being poisoned.
  vec4 layer = min(ONE, uActive / max(rhoD, 1e-6));
  vec4 growth = uTemp * fN * (
    uGrowB * b * smoothstep(0.5 * uCutoff, uCutoff, b) * max(1.0 - rhoB / uCapB, 0.0) +
    uGrowD * d * max(layer - uActive / uCapD, 0.0)
  );

  // Nutrient: eaten from the top, refilled from below.
  float eaten = min(dot(growth, uUptake), n);
  float refill = uExchange * (c1.b - (n - eaten));
  c0.r = n - eaten + refill;
  c1.b = max(c1.b - refill / uDeepRatio, 0.0);

  vec4 late = mix(ONE, vec4(pig), uProdLate);
  c0.g += dot(uSurf, b);
  c0.b += dot(uProdX * late, d);
  c0.a += dot(uSignal, b + d);
  c1.r += dot(uAcid, growth) - dot(uAlkali * (1.0 - fN), d);
  c1.g += dot(uEnzyme, d);
  c1.a += dot(uProdY * late, d);
  c2.rgb += pig * vec3(dot(uPigR, d), dot(uPigG, d), dot(uPigB, d));

  o0 = max(c0, 0.0);
  o1 = vec4(c1.r, max(c1.gba, 0.0)); // the pH shift is signed
  o2 = max(c2, 0.0);
}
`;
