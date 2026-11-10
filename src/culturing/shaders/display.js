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

import { HEADER, STENCIL } from './common.js';

export const COMPOSE_FRAGMENT = `${HEADER}
uniform sampler2D uB;
uniform sampler2D uD;
uniform sampler2D uAux;
uniform sampler2D uWr;
uniform sampler2D uC0;
uniform sampler2D uC1;
uniform sampler2D uC2;
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
uniform vec4 uGloss;
uniform vec4 uRough;
uniform vec4 uFuzz;
uniform vec4 uFuzzLate;
uniform vec4 uSheen;
uniform vec4 uStain;
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

// The medium.
uniform vec3 uAgarColor;
uniform float uAgarOpacity;
uniform vec3 uAcidColor;
uniform vec3 uAlkaliColor;
uniform float uIndicator;  // 1 where the medium carries a pH indicator
uniform float uPhRange;
uniform vec3 uClearColor;
uniform float uClearOpacity;
uniform float uClearGain;
uniform vec3 uDyeColor;
uniform float uDye;
uniform vec3 uAgarFluor;   // the gel's own glow under ultraviolet
uniform vec3 uHaloFluor;   // the glow of whatever pigment has left the colony

layout(location = 0) out vec4 oRelief; // height mm, coverage, gloss, roughness
layout(location = 1) out vec4 oColony; // colour, fuzz
layout(location = 2) out vec4 oAgar;   // colour, opacity (0 = no gel here)
layout(location = 3) out vec4 oGlow;   // light given off, sheen

${STENCIL}

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

vec3 pick(vec4 w, vec4 r, vec4 g, vec4 b) {
  return vec3(dot(w, r), dot(w, g), dot(w, b));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 aux = texelFetch(uAux, p, 0);
  if (aux.a < 0.5) {
    // No gel: outside the dish, or cut away down to the plastic.
    oRelief = vec4(0.0);
    oColony = vec4(0.0);
    oAgar = vec4(0.0);
    oGlow = vec4(0.0);
    return;
  }

  vec4 b = texelFetch(uB, p, 0);
  vec4 d = texelFetch(uD, p, 0);
  float wr = texelFetch(uWr, p, 0).r;
  vec2 xy = gl_FragCoord.xy;
  vec4 c0 = agarAt(uC0, xy);
  vec4 c1 = agarAt(uC1, xy);
  vec4 c2 = agarAt(uC2, xy);

  vec4 mass = b + d;
  float rhoB = dot(b, ONE);
  float rhoD = dot(d, ONE);
  float rho = rhoB + rhoD;
  vec4 share = mass / max(rho, 1e-6);
  vec4 shareD = d / max(rhoD, 1e-6);
  float pig = aux.g;
  float sport = aux.b;

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
  height += film * fold * (crest - 0.12 * trough);

  // ---- Colony ---------------------------------------------------------
  vec3 young = pick(share, uYoungR, uYoungG, uYoungB);
  vec3 mature = pick(share, uMatureR, uMatureG, uMatureB);
  vec3 sported = pick(share, uSportR, uSportG, uSportB);
  vec3 colour = mix(young, mix(mature, sported, sport), pig);
  // A dye in the medium is taken up by the matrix: the film goes the
  // dye's colour, most where it is thickest.
  float stained = dot(share, uStain) * uDye * smoothstep(0.05, 0.6, rhoD);
  colour = mix(colour, colour * uDyeColor * 1.6, stained);
  // The floors of the folds are older, wetter and a shade darker.
  colour *= 1.0 - 0.18 * film * trough;

  float coverage = 1.0 - exp(-dot(mass, uOpacity));
  // A paper disc sits on top of whatever is there.
  float paper = smoothstep(0.35, 0.65, c2.a);
  colour = mix(colour, vec3(0.86, 0.84, 0.78), paper);
  coverage = max(coverage, paper);
  height += 0.5 * paper;
  // A thin travelling layer is a film of liquid: it glistens.
  float wetFilm = clamp(rhoB * 5.0, 0.0, 1.0) * (1.0 - smoothstep(0.15, 0.5, rhoD));
  float gloss = mix(mix(dot(share, uGloss), 0.92, wetFilm), 0.05, paper);
  float rough = mix(mix(dot(share, uRough), 0.12, wetFilm), 0.9, paper);
  float fuzz = dot(share, uFuzz + uFuzzLate * pig) * smoothstep(0.03, 0.25, rhoD);
  float sheen = dot(share, uSheen) * pig * coverage;

  // ---- Agar -----------------------------------------------------------
  vec3 gel = uAgarColor;
  float opacity = uAgarOpacity;
  float turn = c1.r / uPhRange;
  gel = mix(gel, uAcidColor, uIndicator * smoothstep(0.0, 1.0, turn));
  gel = mix(gel, uAlkaliColor, uIndicator * smoothstep(0.0, 1.0, -turn));
  float cleared = 1.0 - exp(-uClearGain * c1.g);
  gel = mix(gel, uClearColor, cleared);
  opacity = mix(opacity, uClearOpacity, cleared);
  // Pigment that has left the colony stains the gel by what it absorbs.
  vec3 stain = exp(-c2.rgb);
  gel *= stain;
  float dissolved = 1.0 - (stain.r + stain.g + stain.b) / 3.0;
  opacity = min(1.0, opacity + 0.35 * dissolved);

  // ---- Light of its own -----------------------------------------------
  vec3 light = vec3(0.0);
  if (uLightMode == 2) {
    // 365 nm: some pigments glow, in the colony and out in the gel.
    light = pick(share, uFluorR, uFluorG, uFluorB) * coverage * (0.35 + 0.65 * pig)
      + uHaloFluor * dissolved
      + uAgarFluor;
  } else if (uLightMode == 3) {
    // Bioluminescence needs a quorum, and cells that are still fed.
    float fed = dot(share, vec4(c0.r) / (c0.r + uKn));
    vec4 lit = smoothstep(uGlowQ * 0.6, uGlowQ * 1.4, vec4(c0.a));
    light = pick(share * lit, uGlowR, uGlowG, uGlowB) * coverage * (0.25 + 0.75 * fed);
  }

  oRelief = vec4(height, coverage, gloss, rough);
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
