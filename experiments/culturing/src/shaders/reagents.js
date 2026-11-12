// The reagent pass: what has been put on the gel from the tray to be looked
// at with, rather than to grow or kill anything.
//
//   uR0  r  universal indicator, which takes its colour from the pH
//        g  tetrazolium (TTC), colourless until a living cell reduces it
//        b  formazan: the red that TTC becomes, and that stays where it was
//           made
//        a  calcofluor white, loose in the gel
//   uR1  rgb a dye loose in the gel, kept as what it absorbs (crystal
//            violet, methylene blue, safranin)
//        a  fluorescein
//   uR2  rgb the dye that cells have taken up
//        a  the calcofluor that has stuck to something
//
// Whatever is loose spreads through the gel at its own rate, under a colony
// as freely as anywhere: the colony sits on the gel, not in it. Cells take
// up a dye from the gel under and around them, and what they have taken up
// stays with them. So a colony stains from where the dye reaches it first,
// and the gel round a stained colony is left paler, because the colony has
// drawn the dye out of it. A basic dye is taken up by every cell and
// whatever they have made; calcofluor only sticks to what it binds.
//
// It runs at the agar's half resolution, after the agar pass, and only on a
// plate something from the tray has been put on.

import { HEADER, STENCIL } from './common.js';

export const REAGENT_FRAGMENT = `${HEADER}
uniform sampler2D uB;
uniform sampler2D uD;
uniform sampler2D uAux;
uniform sampler2D uC0;
uniform sampler2D uR0;
uniform sampler2D uR1;
uniform sampler2D uR2;

uniform vec4 uRDiff0;   // diffusion per step, on this grid
uniform vec4 uRDiff1;
uniform float uTake;    // dye taken up per step, per unit of biomass
uniform vec4 uBinds;    // per culture: how much it has for calcofluor to bind
uniform vec4 uKn;
uniform vec4 uActive;
uniform float uReduce;  // TTC turned to formazan per step, per unit of live growth

layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;

${STENCIL}

void main() {
  ivec2 pc = ivec2(gl_FragCoord.xy);
  vec4 r0 = texelFetch(uR0, pc, 0);
  vec4 r1 = texelFetch(uR1, pc, 0);
  vec4 r2 = texelFetch(uR2, pc, 0);
  if (texelFetch(uAux, pc * 2, 0).a < 0.5) {
    o0 = r0;
    o1 = r1;
    o2 = r2;
    return;
  }

  // Diffusion, with nothing crossing the dish wall or a cut.
  vec4 l0 = vec4(0.0);
  vec4 l1 = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    ivec2 q = pc + OFF[j];
    float open = WGT[j] * step(0.5, texelFetch(uAux, q * 2, 0).a);
    l0 += open * (texelFetch(uR0, q, 0) - r0);
    l1 += open * (texelFetch(uR1, q, 0) - r1);
  }
  r0 += uRDiff0 * l0;
  r1 += uRDiff1 * l1;

  // The biomass over this texel.
  ivec2 f = pc * 2;
  vec4 d = 0.25 * (
    texelFetch(uD, f, 0) + texelFetch(uD, f + ivec2(1, 0), 0) +
    texelFetch(uD, f + ivec2(0, 1), 0) + texelFetch(uD, f + ivec2(1, 1), 0)
  );
  vec4 b = 0.25 * (
    texelFetch(uB, f, 0) + texelFetch(uB, f + ivec2(1, 0), 0) +
    texelFetch(uB, f + ivec2(0, 1), 0) + texelFetch(uB, f + ivec2(1, 1), 0)
  );

  // Taken up: a share of what is loose under the cells, each step.
  float dyeTaken = min(0.5, uTake * dot(b + d, ONE));
  float cfTaken = min(0.5, uTake * dot(d, uBinds));
  vec3 dye = r1.rgb * dyeTaken;
  float cf = r0.a * cfTaken;
  r1.rgb -= dye;
  r2.rgb += dye;
  r0.a -= cf;
  r2.a += cf;

  // Living cells reduce tetrazolium to formazan, which is red and doesn't
  // dissolve: it stays in the colony that made it. Cells that are still
  // fed and still near the air do most of it, so a starved middle stays
  // paler than a growing rim.
  float n = max(texelFetch(uC0, pc, 0).r, 0.0);
  vec4 fed = vec4(n) / (n + uKn);
  float live = dot(b + min(d, uActive), fed);
  float reduced = min(r0.g, r0.g * uReduce * live);
  r0.g -= reduced;
  r0.b += reduced;

  o0 = max(r0, 0.0);
  o1 = max(r1, 0.0);
  o2 = max(r2, 0.0);
}
`;
