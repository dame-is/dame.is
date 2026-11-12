// From state to something a light can fall on.
//
// The simulation's textures say how much of what is where. These two passes
// turn that into the handful of things the eye reads off a plate: how high
// the surface stands, what colour it is, how much of the agar shows through
// it, how wet it looks, what the agar under it has become, and whether any
// of it gives off light of its own.
//
//   compose   state            ->  relief, colony, agar, glow
//   shade     relief + a light ->  the shadow each ridge throws, and how
//                                  much sky each valley sees
//
// Heights are in millimetres, and they are the true ones: a colony is a
// few tenths of a millimetre thick, a ridge perhaps half a millimetre, on a
// dish 86 mm across. The renderer stretches the vertical, as a raking light
// does in a photograph, and says by how much.

import { HEADER, HASH, LATTICE, STENCIL } from './common.js';

export const COMPOSE_FRAGMENT = `${HEADER}
uniform sampler2D uB;
uniform sampler2D uD;
uniform sampler2D uAux;
uniform sampler2D uWr;
uniform sampler2D uC0;
uniform sampler2D uC1;
uniform sampler2D uC2;
uniform sampler2D uC3;
uniform sampler2D uR0;
uniform sampler2D uR1;
uniform sampler2D uR2;
uniform bool uStained;   // whether anything from the tray's stains is on it
uniform float uChemSize;
uniform int uLightMode; // 0 bench, 1 light table, 2 ultraviolet, 3 dark

// One component per culture.
uniform vec4 uYoungR;
uniform vec4 uYoungG;
uniform vec4 uYoungB;
uniform vec4 uMatureR;
uniform vec4 uMatureG;
uniform vec4 uMatureB;
uniform vec4 uSportR;
uniform vec4 uSportG;
uniform vec4 uSportB;
uniform vec4 uOpacity;
uniform vec4 uHeightD;   // mm of biofilm at density 1
uniform vec4 uHeightB;   // mm of motile layer at density 1
uniform vec4 uWrHeight;  // mm, ridge crest above the film
uniform vec4 uWrSport;
uniform vec4 uWrCoarsen; // as the wrinkle pass has them: a fold's width with age
uniform vec4 uWrAgeing;
uniform vec4 uCrest;     // how much paler a fold's crest is than its floor
uniform vec4 uGloss;
uniform vec4 uRough;
uniform vec4 uFuzz;
uniform vec4 uFuzzLate;
uniform vec4 uTufts;     // how far ripe growth stands up in tufts
uniform float uMmPerTexel;
uniform uint uSeed;
uniform vec4 uSheen;
uniform vec4 uStain;
uniform vec4 uChromoR;   // the colour it turns a chromogenic medium's substrates
uniform vec4 uChromoG;
uniform vec4 uChromoB;
uniform vec4 uChromo;    // 1 where that is to be shown
uniform vec4 uChromoSheen; // the sheen it comes up with there
uniform vec4 uFluorR;
uniform vec4 uFluorG;
uniform vec4 uFluorB;
uniform vec4 uGlowR;
uniform vec4 uGlowG;
uniform vec4 uGlowB;
uniform vec4 uGlowQ;     // signal a culture needs before it lights up
uniform vec4 uKn;
uniform float uWrOnset;
uniform float uWrFull;

// The medium, one per compartment of the vessel (vessels.js).
uniform vec3 uAgarColor[6];
uniform float uAgarOpacity[6];
uniform vec3 uAcidColor[6];
uniform vec3 uAlkaliColor[6];
uniform float uIndicator[6];  // 1 where the medium carries a pH indicator
uniform float uPhRange[6];
uniform vec3 uClearColor[6];
uniform float uClearOpacity[6];
uniform float uClearGain[6];
uniform vec3 uDyeColor[6];
uniform float uDye[6];
uniform vec3 uAgarFluor[6];   // the gel's own glow under ultraviolet
uniform float uChromogenic[6];
uniform vec3 uHaloFluor;   // the glow of whatever pigment has left the colony

// What was put on from the tray (shaders/reagents.js).
uniform vec4 uBinds;          // per culture: what calcofluor has to stick to
uniform vec3 uUniversal[7];   // a universal indicator's colour at pH 4 to 10
uniform vec3 uFormazan;       // the red TTC turns to
uniform vec3 uCalcofluor;     // its glow under ultraviolet
uniform vec3 uFluorescein;    // its glow
uniform vec3 uFluoresceinAbs; // what it absorbs, per unit

layout(location = 0) out vec4 oRelief; // height mm, optical depth, gloss, roughness
layout(location = 1) out vec4 oColony; // colour, fuzz
layout(location = 2) out vec4 oAgar;   // colour, opacity (0 = no gel here)
layout(location = 3) out vec4 oGlow;   // light given off, sheen

${STENCIL}
${HASH}
${LATTICE}

// The agar textures are half this resolution; read between their texels.
vec4 agarAt(sampler2D t, vec2 xy) {
  vec2 c = xy * 0.5 - 0.5;
  vec2 f = fract(c);
  ivec2 i = ivec2(floor(c));
  ivec2 hi = ivec2(int(uChemSize) - 1);
  ivec2 i0 = clamp(i, ivec2(0), hi);
  ivec2 i1 = clamp(i + 1, ivec2(0), hi);
  return mix(
    mix(texelFetch(t, i0, 0), texelFetch(t, ivec2(i1.x, i0.y), 0), f.x),
    mix(texelFetch(t, ivec2(i0.x, i1.y), 0), texelFetch(t, i1, 0), f.x),
    f.y
  );
}

// The same, through a cubic B-spline over sixteen texels. For what is
// about to be given a hard edge (a paper disc): read between texels with
// straight lines, a disc four texels across comes out an octagon.
vec4 agarSmoothAt(sampler2D t, vec2 xy) {
  vec2 c = xy * 0.5 - 0.5;
  vec2 f = fract(c);
  ivec2 i = ivec2(floor(c));
  ivec2 hi = ivec2(int(uChemSize) - 1);
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w[4];
  w[0] = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  w[1] = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  w[2] = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  w[3] = f3 / 6.0;
  vec4 sum = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      ivec2 q = clamp(i + ivec2(x - 1, y - 1), ivec2(0), hi);
      sum += w[x].x * w[y].y * texelFetch(t, q, 0);
    }
  }
  return sum;
}

vec3 pick(vec4 w, vec4 r, vec4 g, vec4 b) {
  return vec3(dot(w, r), dot(w, g), dot(w, b));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 aux = texelFetch(uAux, p, 0);
  int part = clamp(int(texelFetch(uC3, p >> 1, 0).r + 0.5), 0, 5);
  if (aux.a < 0.5) {
    // No gel: outside the dish, or cut away down to the plastic. It keeps
    // the medium's colour with no opacity, so that the gel beside a cut
    // isn't darkened by being read together with nothing.
    oRelief = vec4(0.0);
    oColony = vec4(0.0);
    oAgar = vec4(uAgarColor[part], 0.0);
    oGlow = vec4(0.0);
    return;
  }

  vec4 b = texelFetch(uB, p, 0);
  vec4 d = texelFetch(uD, p, 0);
  vec4 wrinkle = texelFetch(uWr, p, 0);
  float wr = wrinkle.r;
  vec2 xy = gl_FragCoord.xy;
  vec4 c0 = agarAt(uC0, xy);
  vec4 c1 = agarAt(uC1, xy);
  vec4 c2 = agarSmoothAt(uC2, xy);
  // Smooth, because a stain is gathered at a colony's edge and the eye goes
  // to an edge.
  // A plate nothing has been put on reads none of them.
  vec4 r0 = vec4(0.0);
  vec4 r1 = vec4(0.0);
  vec4 r2 = vec4(0.0);
  if (uStained) {
    r0 = agarSmoothAt(uR0, xy);
    r1 = agarSmoothAt(uR1, xy);
    r2 = agarSmoothAt(uR2, xy);
  }

  vec4 mass = b + d;
  float rhoB = dot(b, ONE);
  float rhoD = dot(d, ONE);
  float rho = rhoB + rhoD;
  vec4 share = mass / max(rho, 1e-6);
  vec4 shareD = d / max(rhoD, 1e-6);
  float pig = aux.g;
  float sport = aux.b;
  if (rho < 1e-5) {
    // Bare gel beside a colony. Nothing here to have a colour, but the
    // scene reads the colour between this texel and its neighbours, and
    // nothing would read as black: a dark line round every colony. So it
    // takes its neighbours' colour, and none of their substance.
    float near = 0.0;
    float nearPig = 0.0;
    float nearSport = 0.0;
    vec4 nearMass = vec4(0.0);
    for (int j = 0; j < 8; j++) {
      ivec2 q = p + OFF[j];
      vec4 mj = texelFetch(uB, q, 0) + texelFetch(uD, q, 0);
      float rj = dot(mj, ONE);
      vec4 xj = texelFetch(uAux, q, 0);
      nearMass += mj;
      nearPig += rj * xj.g;
      nearSport += rj * xj.b;
      near += rj;
    }
    if (near > 1e-5) {
      share = nearMass / near;
      pig = nearPig / near;
      sport = nearSport / near;
    }
  }

  // ---- Relief ---------------------------------------------------------
  float height = dot(d, uHeightD) + dot(b, uHeightB);
  // A buckled film stands up in narrow folds with flat ground between
  // them, not in a sine wave: the crests are sharpened and the troughs
  // barely dip.
  float film = smoothstep(uWrOnset, uWrFull, rhoD);
  float v = wr / 0.9;
  float crest = pow(max(v, 0.0), 1.5);
  float trough = max(-v, 0.0);
  float fold = dot(shareD, uWrHeight * mix(ONE, uWrSport, sport));
  // A broad fold is a tall one: both follow the thickness of the film, which
  // is why the old veins near the middle stand over the young ridges at the
  // rim (see wrinkle.js for the width).
  float old = 1.0 - exp(-wrinkle.g / max(dot(shareD, uWrAgeing), 1.0));
  fold *= pow(1.0 + dot(shareD, uWrCoarsen) * old, 0.6);
  float ridge = film * crest;
  height += film * fold * (crest - 0.12 * trough);

  // ---- Tufts ----------------------------------------------------------
  // A mould doesn't fruit evenly. Its spores come up in tufts on the felt,
  // a millimetre or so across and nowhere in particular, so the colour is
  // on them first and never quite fills in between. They are noise, not a
  // pattern the plate grew: irregular is the whole of what they have to be.
  float tufted = dot(share, uTufts) * smoothstep(0.03, 0.25, rhoD);
  float tuft = 0.0;
  if (tufted > 0.0) {
    vec2 mm = gl_FragCoord.xy * uMmPerTexel;
    float n = 0.6 * lattice(mm / 1.2, uSeed + 5u)
      + 0.4 * lattice(mat2(0.8, -0.6, 0.6, 0.8) * mm / 0.55, uSeed + 11u);
    tuft = smoothstep(-0.2, 0.7, n);
    height += tufted * (0.05 + 0.2 * pig) * tuft;
    pig = mix(pig, clamp(pig * (0.3 + 1.4 * tuft), 0.0, 1.0), tufted);
  }

  // ---- Colony ---------------------------------------------------------
  vec3 young = pick(share, uYoungR, uYoungG, uYoungB);
  vec3 mature = pick(share, uMatureR, uMatureG, uMatureB);
  vec3 sported = pick(share, uSportR, uSportG, uSportB);
  vec3 colour = mix(young, mix(mature, sported, sport), pig);
  // On a chromogenic plate the colour is made by the colony's enzymes from
  // what is in the gel, so it comes up as the colony thickens and is the
  // same at any age.
  float chromo = uChromogenic[part] * dot(share, uChromo) * smoothstep(0.04, 0.4, rhoD);
  colour = mix(colour, pick(share * uChromo, uChromoR, uChromoG, uChromoB)
    / max(dot(share, uChromo), 1e-4), 0.9 * chromo);
  // A dye in the medium is taken up by the matrix: the film goes the
  // dye's colour, most where it is thickest.
  // It pools between the folds and thins over them, so the floors come
  // up saturated and the crests pale.
  float stained = dot(share, uStain) * uDye[part] * smoothstep(0.05, 0.6, rhoD);
  stained *= 1.0 - 0.45 * ridge + 0.25 * film * trough;
  colour = mix(colour, colour * uDyeColor[part] * 1.6, clamp(stained, 0.0, 1.0));
  // A dye from the tray that the cells have taken up: the colony takes its
  // colour, deepest where the most has gathered, and in the floors of its
  // folds more than on the crests.
  colour *= exp(-r2.rgb * 1.6 * (1.0 - 0.35 * ridge + 0.2 * film * trough));
  // Tetrazolium that living cells have turned red.
  colour = mix(colour, uFormazan, 1.0 - exp(-3.0 * max(r0.b, 0.0)));
  // Calcofluor is an optical brightener: what it sticks to looks a shade
  // whiter even in ordinary light, which has a little ultraviolet in it.
  float brightened = 1.0 - exp(-0.6 * r2.a);
  colour = mix(colour, colour * 1.08 + vec3(0.02, 0.025, 0.05), brightened);
  // The floors of the folds are older, wetter and a shade darker; the
  // crests are where the film is thickest and driest, and scatter the most
  // light back.
  colour *= 1.0 - 0.22 * film * trough;
  float pale = dot(share, uCrest) * ridge;
  colour = mix(colour, mix(colour, vec3(0.97, 0.94, 0.9), 0.75), clamp(pale, 0.0, 1.0));

  // How much stands between the eye and the gel, as an optical depth. The
  // scene turns it into coverage after it has been magnified, not before:
  // a colony's edge is where this crosses about one, and a smooth curve
  // through that is an outline, where a blur of covered and uncovered
  // texels is a staircase.
  float depth = dot(mass, uOpacity);
  // A paper disc sits on top of whatever is there, and where nothing is,
  // it is all there is to see.
  float paper = smoothstep(0.3, 0.7, c2.a);
  float lid = paper / max(paper + (1.0 - paper) * (1.0 - exp(-depth)), 1e-3);
  colour = mix(colour, vec3(0.86, 0.84, 0.78), lid);
  depth = max(depth, 9.0 * paper);
  float coverage = 1.0 - exp(-depth);
  height += 0.5 * paper;
  // A thin travelling layer is a film of liquid: it glistens.
  float wetFilm = clamp(rhoB * 5.0, 0.0, 1.0) * (1.0 - smoothstep(0.15, 0.5, rhoD));
  float gloss = mix(mix(dot(share, uGloss), 0.92, wetFilm), 0.05, lid);
  float rough = mix(mix(dot(share, uRough), 0.12, wetFilm), 0.9, lid);
  float fuzz = dot(share, uFuzz + uFuzzLate * pig) * smoothstep(0.03, 0.25, rhoD);
  float sheen = dot(share, uSheen + uChromoSheen * uChromogenic[part]) * pig * coverage;

  // ---- Agar -----------------------------------------------------------
  vec3 gel = uAgarColor[part];
  float opacity = uAgarOpacity[part];
  float turn = c1.r / uPhRange[part];
  gel = mix(gel, uAcidColor[part], uIndicator[part] * smoothstep(0.0, 1.0, turn));
  gel = mix(gel, uAlkaliColor[part], uIndicator[part] * smoothstep(0.0, 1.0, -turn));
  float cleared = 1.0 - exp(-uClearGain[part] * c1.g);
  gel = mix(gel, uClearColor[part], cleared);
  opacity = mix(opacity, uClearOpacity[part], cleared);
  // A universal indicator dropped on the gel: a run of colours from red
  // at pH 4 to violet at 10, so each colony draws its own map of what it
  // is doing to the gel. A shift of one on the plate's scale is taken as
  // about a pH unit and a half.
  float indicator = 1.0 - exp(-4.0 * max(r0.r, 0.0));
  float pH = clamp(3.0 - 1.5 * c1.r, 0.0, 6.0);
  int lo = int(floor(pH));
  vec3 universal = mix(uUniversal[lo], uUniversal[min(lo + 1, 6)], pH - float(lo));
  gel = mix(gel, universal, 0.85 * indicator);
  opacity = min(1.0, opacity + 0.3 * indicator);
  // Pigment that has left the colony stains the gel by what it absorbs,
  // and so does a dye from the tray where it is still free in the gel.
  vec3 stain = exp(-(c2.rgb + r1.rgb + uFluoresceinAbs * r1.a));
  gel *= stain;
  float dissolved = 1.0 - (stain.r + stain.g + stain.b) / 3.0;
  opacity = min(1.0, opacity + 0.35 * dissolved);

  // ---- Light of its own -----------------------------------------------
  vec3 light = vec3(0.0);
  // Fluorescein glows green, and less in acid: it is a weak acid itself,
  // and only its alkaline form fluoresces much.
  float fluorescein = (1.0 - exp(-0.8 * max(r1.a, 0.0)))
    * (1.0 - smoothstep(-0.3, 1.2, c1.r));
  if (uLightMode < 2) {
    // Even in daylight: the green that makes it a tracer.
    light = uFluorescein * 0.08 * fluorescein * (1.0 - coverage);
  } else if (uLightMode == 2) {
    // 365 nm: some pigments glow, in the colony and out in the gel.
    light = pick(share, uFluorR, uFluorG, uFluorB) * coverage * (0.35 + 0.65 * pig)
      + uHaloFluor * dissolved
      + uAgarFluor[part];
    // Calcofluor glows blue where it has stuck to something, and faintly
    // where it is still loose in the gel.
    light += uCalcofluor * ((1.0 - exp(-0.5 * r2.a)) * coverage
      + 0.08 * (1.0 - exp(-0.5 * max(r0.a, 0.0))) * (1.0 - coverage));
    // Fluorescein is only weakly excited at 365 nm, a few per cent as well
    // as by blue light: it shows, but calcofluor outshines it.
    light += uFluorescein * 0.25 * fluorescein * (1.0 - 0.7 * coverage);
  } else if (uLightMode == 3) {
    // Bioluminescence needs a quorum, and cells that are still fed.
    float fed = dot(share, vec4(c0.r) / (c0.r + uKn));
    vec4 lit = smoothstep(uGlowQ * 0.6, uGlowQ * 1.4, vec4(c0.a));
    light = pick(share * lit, uGlowR, uGlowG, uGlowB) * coverage * (0.25 + 0.75 * fed);
  }

  oRelief = vec4(height, min(depth, 16.0), gloss, rough);
  oColony = vec4(colour, fuzz);
  oAgar = vec4(gel, max(opacity, 0.02));
  oGlow = vec4(light, sheen);
}
`;

/**
 * Shadows and sky. One march from each texel toward the lamp finds what
 * stands in the way; a ring of samples around it measures how enclosed it
 * is. Both are done here, in the plate's own texture, so the surface shader
 * reads two numbers instead of marching for every pixel on screen.
 */
export const SHADE_FRAGMENT = `${HEADER}
uniform sampler2D uRelief;
uniform float uTexel;     // 1 / size
uniform float uMmPerTexel;
uniform float uStretch;   // how much the vertical is exaggerated
uniform vec3 uLamp;       // toward the lamp, in plate space (x, up, z)

layout(location = 0) out vec4 o;

float relief(vec2 uv) {
  return texture(uRelief, uv).r * uStretch;
}

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float here = relief(uv);

  // Toward the lamp across the plate, and how fast the ray climbs.
  vec2 level = uLamp.xz;
  float run = max(length(level), 1e-4);
  vec2 dir = level / run;
  float climb = uLamp.y / run;

  float shadow = 1.0;
  float reach = 0.0;
  for (int i = 1; i <= 18; i++) {
    reach += 0.55 + 0.11 * float(i); // texels; longer strides further out
    float ray = here + climb * reach * uMmPerTexel;
    float ground = relief(uv + dir * reach * uTexel);
    // Soft: how far the ground stands above the ray, over how far away.
    shadow = min(shadow, 1.0 - clamp((ground - ray) / (0.09 * reach * uMmPerTexel + 0.04), 0.0, 1.0));
  }

  float sky = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = 0.7853982 * float(i) + 0.3;
    vec2 d = vec2(cos(a), sin(a));
    for (int k = 1; k <= 2; k++) {
      float r = 1.6 * float(k * k);
      float rise = relief(uv + d * r * uTexel) - here;
      sky += clamp(rise / (r * uMmPerTexel), 0.0, 1.0);
    }
  }
  float open = 1.0 - clamp(sky / 16.0 * 1.5, 0.0, 1.0);

  o = vec4(shadow, open, 0.0, 1.0);
}
`;
