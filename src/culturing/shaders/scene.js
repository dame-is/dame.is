// The bench, the dishes on it, and the light.
//
// Four things are drawn: the bench, the surface of each plate (gel and
// whatever is growing on it, as one displaced sheet), the edge of the gel
// where it meets the wall, and the polystyrene wall itself. Everything a
// plate needs has already been reduced to five textures (display.js), so
// these shaders are only about light.
//
// Four ways of looking at a plate, each of which a microbiologist would
// recognise, because each shows something the others hide:
//
//   bench        a soft lamp raking in from behind and to one side, over a
//                matte black bench: relief, texture, sheen. How colony
//                morphology is photographed.
//   light table  lit from underneath: density, translucency, and anything
//                dissolved in the gel. How haemolysis is read.
//   ultraviolet  a 365 nm lamp in a dark room: only what fluoresces.
//   dark         nothing but what the plate gives off.

import { HEADER } from './common.js';

const LIGHTING = `
uniform vec3 uEye;
uniform int uLightMode;   // 0 bench, 1 light table, 2 ultraviolet, 3 dark
uniform vec3 uLamp;       // toward the lamp
uniform vec3 uBench;      // the bench's own colour
uniform vec4 uDishes[8];  // x, z, outer radius, wall height
uniform int uDishCount;

const vec3 LAMP = vec3(1.0, 0.965, 0.9);
const vec3 SKY = vec3(0.36, 0.39, 0.44);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise2(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// How strongly each light is on, by mode.
vec3 lampLevel() {
  if (uLightMode == 0) return LAMP * 1.2;
  if (uLightMode == 1) return LAMP * 0.12;
  if (uLightMode == 2) return vec3(0.16, 0.05, 0.42) * 0.5;
  return vec3(0.0);
}
vec3 skyLevel() {
  if (uLightMode == 0) return SKY * 0.4;
  if (uLightMode == 1) return SKY * 0.16;
  if (uLightMode == 2) return vec3(0.05, 0.015, 0.14) * 0.6;
  return vec3(0.004, 0.005, 0.007);
}
// A second, weaker lamp opposite the first, as a studio would have: it
// keeps the shadowed side of a ridge from going black.
vec3 fillDir() {
  return normalize(vec3(-uLamp.x, 0.9, -uLamp.z));
}
vec3 fillLevel() {
  return lampLevel() * 0.2;
}

// The bench at a point: matte, a little mottled, darker under and beside
// each dish. On the light table it is the light.
vec3 benchAt(vec2 xz) {
  if (uLightMode == 1) {
    float fall = 1.0 - 0.18 * smoothstep(60.0, 420.0, length(xz));
    return vec3(1.0, 0.985, 0.95) * 1.9 * fall;
  }
  float mottle = 0.88 + 0.24 * noise2(xz * 0.35) + 0.1 * (noise2(xz * 3.1) - 0.5);
  vec3 base = uBench * mottle;
  float shade = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uDishCount) break;
    vec4 dish = uDishes[i];
    float away = length(xz - dish.xy) - dish.z;
    // Close to the wall the bench sees less sky...
    shade *= 1.0 - 0.5 * (1.0 - smoothstep(-2.0, 16.0, away));
    // ...and the wall throws a shadow away from the lamp.
    vec2 thrown = -uLamp.xz / max(uLamp.y, 0.2) * dish.w * 0.55;
    float inShadow = length(xz - dish.xy - thrown) - dish.z;
    shade *= 1.0 - 0.32 * (1.0 - smoothstep(-3.0, 5.0, inShadow)) * step(float(uLightMode), 0.5);
  }
  float lambert = max(uLamp.y, 0.0);
  return base * (lampLevel() * lambert * shade + skyLevel() * (0.35 + 0.65 * shade));
}

// A lamp seen as a reflection: a soft-edged patch where the mirrored view
// direction meets it. The lamp is a softbox, a good twenty degrees across;
// a rougher surface sees a wider, dimmer one.
float lampPatch(vec3 r, vec3 toward, float rough) {
  float inner = cos(0.17 + rough * 0.7);
  float outer = cos(0.33 + rough * 1.3);
  return smoothstep(outer, inner, dot(r, toward)) / (1.0 + 22.0 * rough * rough);
}

// Everything a glossy surface mirrors: both lamps and the dim room. A lamp
// is far brighter to look at than anything it lights, which is why a wet
// surface that reflects only a twentieth of it still shows a white patch.
vec3 mirrored(vec3 r, float rough, float shadow) {
  return lampLevel() * lampPatch(r, uLamp, rough) * 9.0 * shadow
    + fillLevel() * lampPatch(r, fillDir(), rough) * 9.0
    + skyLevel() * (0.3 + 0.7 * clamp(r.y, 0.0, 1.0));
}

vec3 filmic(vec3 x) {
  // ACES, Narkowicz's fit.
  x *= 0.85;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 toScreen(vec3 linear) {
  return pow(filmic(linear), vec3(1.0 / 2.2));
}
`;

// ---------------------------------------------------------------- bench

export const BENCH_VERTEX = `${HEADER}
uniform mat4 uViewProj;
uniform vec2 uExtent;
out vec3 vWorld;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vWorld = vec3(p.x * uExtent.x, 0.0, p.y * uExtent.y);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}`;

export const BENCH_FRAGMENT = `${HEADER}
in vec3 vWorld;
out vec4 o;
${LIGHTING}
void main() {
  vec3 colour = benchAt(vWorld.xz);
  // The room past the edge of the bench is dark.
  float beyond = smoothstep(260.0, 900.0, length(vWorld.xz));
  colour *= 1.0 - 0.85 * beyond;
  o = vec4(toScreen(colour), 1.0);
}`;

// -------------------------------------------------------------- surface

export const SURFACE_VERTEX = `${HEADER}
layout(location = 0) in vec2 aGrid;
uniform mat4 uViewProj;
uniform vec3 uCentre;     // the dish's centre on the bench
uniform float uSpan;      // mm the plate's textures cover
uniform float uRadius;    // mm of gel
uniform float uEdge;      // the last mm before the wall, taken from just inside
uniform float uTop;       // height of the gel's surface
uniform float uFloor;     // height of the dish floor
uniform float uStretch;
uniform sampler2D uRelief;
uniform sampler2D uAgar;
out vec3 vWorld;
out vec2 vMm;

void main() {
  vec2 mm = aGrid * uSpan * 0.5;
  float r = length(mm);
  // The gel's edge is a staircase of texels under the wall. The last
  // little way is drawn from just inside it, so the surface meets the
  // wall in a clean circle.
  vec2 at = mm * min(1.0, (uRadius - uEdge) / max(r, 1e-4));
  vec2 uv = at / uSpan + 0.5;
  float height = textureLod(uRelief, uv, 0.0).r;
  float gel = smoothstep(0.0, 0.012, textureLod(uAgar, uv, 0.0).a);
  // Gel climbs the wall a little: a meniscus.
  float meniscus = 0.9 * exp(-(uRadius - min(r, uRadius)) / 1.5);
  float y = mix(uFloor, uTop + height * uStretch + meniscus, gel);
  vWorld = vec3(uCentre.x + mm.x, y, uCentre.z - mm.y);
  vMm = mm;
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}`;

export const SURFACE_FRAGMENT = `${HEADER}
in vec3 vWorld;
in vec2 vMm;
out vec4 o;

uniform sampler2D uRelief;  // height mm, coverage, gloss, roughness
uniform sampler2D uColony;  // colour, fuzz
uniform sampler2D uAgar;    // colour, opacity
uniform sampler2D uGlow;    // light given off, sheen
uniform sampler2D uShade;   // shadow, sky
uniform float uSpan;
uniform float uRadius;
uniform float uEdge;
uniform float uTexels;
uniform float uStretch;
uniform float uDetail;      // 1 up close, 0 from across the bench
${LIGHTING}

// Height read through a cubic B-spline (four bilinear taps), so the slope
// taken from it is smooth and a highlight sliding over the surface doesn't
// show the texels underneath.
float reliefAt(vec2 uv) {
  vec2 st = uv * uTexels - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / uTexels;
  vec2 h1 = (i + 1.5 + w3 / g1) / uTexels;
  return mix(
    mix(texture(uRelief, h1).r, texture(uRelief, vec2(h0.x, h1.y)).r, g0.x),
    mix(texture(uRelief, vec2(h1.x, h0.y)).r, texture(uRelief, h0).r, g0.x),
    g0.y
  );
}

void main() {
  float r = length(vMm);
  if (r > uRadius) discard;
  vec2 at = vMm * min(1.0, (uRadius - uEdge) / max(r, 1e-4));
  vec2 uv = at / uSpan + 0.5;

  vec4 relief = texture(uRelief, uv);
  vec4 colony = texture(uColony, uv);
  vec4 agar = texture(uAgar, uv);
  vec4 glow = texture(uGlow, uv);
  vec4 shade = texture(uShade, uv);
  float coverage = relief.g;
  float gloss = relief.b;
  float rough = relief.a;
  float fuzz = colony.a;
  float gel = smoothstep(0.0, 0.012, agar.a);

  // ---- The surface's slope -------------------------------------------
  float texel = 1.0 / uTexels;
  float mmPerTexel = uSpan * texel;
  float hx = reliefAt(uv + vec2(texel, 0.0)) - reliefAt(uv - vec2(texel, 0.0));
  float hy = reliefAt(uv + vec2(0.0, texel)) - reliefAt(uv - vec2(0.0, texel));
  vec2 slope = vec2(hx, hy) * uStretch / (2.0 * mmPerTexel);
  // Finer than the grid can hold: the grain of a dry film, the nap of a
  // mould. Only worth drawing up close.
  vec2 fine = vMm * 9.0;
  float grainAmount = coverage * (0.22 * rough + 0.5 * fuzz) * uDetail;
  vec2 grain = vec2(
    noise2(fine + vec2(13.0, 0.0)) - noise2(fine - vec2(13.0, 0.0)),
    noise2(fine + vec2(0.0, 7.0)) - noise2(fine - vec2(0.0, 7.0))
  ) + 0.5 * vec2(
    noise2(fine * 2.7 + 3.0) - 0.5,
    noise2(fine * 2.7 - 5.0) - 0.5
  );
  slope += grain * grainAmount;
  // The meniscus tilts the gel up toward the wall.
  float lip = 0.6 * exp(-(uRadius - r) / 1.5);
  slope += normalize(vMm + 1e-5) * lip;
  // Plate space is (x, -z): the texture's y runs away from the viewer.
  vec3 n = normalize(vec3(-slope.x, 1.0, slope.y));

  vec3 v = normalize(uEye - vWorld);
  float ndv = max(dot(n, v), 0.0);
  vec3 refl = reflect(-v, n);
  float fresnel = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 lamp = lampLevel();
  vec3 sky = skyLevel();
  // Living things are never quite black in their own shadow: light comes
  // through them and round them.
  float shadow = mix(1.0, 0.3 + 0.7 * shade.r, coverage);
  float open = mix(1.0, 0.4 + 0.6 * shade.g, coverage);

  // ---- What is under the gel -----------------------------------------
  vec3 under = benchAt(vWorld.xz) * 0.92;
  // Light crossing the gel takes its colour.
  float brightest = max(max(agar.r, max(agar.g, agar.b)), 1e-3);
  vec3 tint = mix(vec3(1.0), agar.rgb / brightest, 0.9);
  vec3 through = under * tint * mix(1.0, 0.8, agar.a);

  // ---- The gel -------------------------------------------------------
  float flatLight = max(uLamp.y, 0.0);
  vec3 gelLit = agar.rgb * (lamp * (0.26 + 0.6 * flatLight) + sky * 1.3);
  vec3 gelLook = mix(through, gelLit, agar.a);
  // Light that enters the gel is carried sideways in it and comes out at
  // the rim: the edge of a plate is always a little brighter.
  gelLook += gelLit * 0.3 * exp(-(uRadius - r) / 2.2) * (1.0 - agar.a);

  // ---- The colony ----------------------------------------------------
  float wrap = 0.22;
  float diffuse = clamp((dot(n, uLamp) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float fill = clamp((dot(n, fillDir()) + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 lit = lamp * diffuse * shadow
    + fillLevel() * fill
    + sky * open * (0.55 + 0.45 * n.y) * 1.5;
  vec3 colonyLook = colony.rgb * lit * 0.8;
  // Aerial hyphae: flatter in the middle, bright where seen edge-on.
  colonyLook *= 1.0 - 0.25 * fuzz;
  colonyLook += fuzz * pow(1.0 - ndv, 2.2) * (colony.rgb * 0.5 + 0.22)
    * (lamp * (0.4 + 0.6 * diffuse) + sky);

  vec3 look;
  if (uLightMode == 1) {
    // From underneath, a colony is what it blocks: thin growth is a
    // tinted window, thick growth a dark one.
    vec3 window = through * mix(vec3(1.0), colony.rgb * 1.25, 0.8)
      * mix(0.9, 0.1, coverage * coverage);
    look = mix(through, window, coverage) + colonyLook * coverage * 0.6;
  } else {
    look = mix(gelLook, colonyLook, coverage);
  }

  // ---- Reflections ---------------------------------------------------
  // Bare gel is wet and nearly flat: a mirror, if a dim one.
  float surfGloss = mix(0.95, gloss * (1.0 - 0.8 * fuzz), coverage);
  float surfRough = mix(0.04, rough, coverage);
  look += mirrored(refl, surfRough, shadow) * fresnel * surfGloss * gel;
  // A broader sheen off a film that is neither wet nor matte.
  vec3 h = normalize(uLamp + v);
  float lobe = pow(max(dot(n, h), 0.0), mix(110.0, 5.0, surfRough));
  look += lamp * lobe * surfGloss * 0.16 * (1.0 - 0.7 * surfRough) * shadow * coverage;

  // A metallic film on old growth: colour by the angle it is seen at.
  float sheen = glow.a;
  if (sheen > 0.001) {
    float phase = 1.7 * ndv + 0.35 * noise2(vMm * 1.3) + 0.2 * relief.r;
    vec3 irid = 0.5 + 0.5 * cos(6.2831853 * (phase + vec3(0.0, 0.33, 0.67)));
    look += irid * sheen * (lamp * (0.25 + 0.75 * diffuse) + sky)
      * (0.25 + 0.75 * fresnel + 0.5 * lobe);
  }

  // ---- Light of its own ----------------------------------------------
  // Glow spreads: a soft halo taken from the blurrier levels of the same
  // texture, so it follows the surface instead of the screen.
  vec3 halo = textureLod(uGlow, uv, 2.5).rgb * 0.5 + textureLod(uGlow, uv, 4.5).rgb * 0.45;
  look += glow.rgb * 1.6 + halo;

  // The plastic floor, where the gel has been cut away.
  vec3 plastic = under + mirrored(reflect(-v, vec3(0.0, 1.0, 0.0)), 0.08, 1.0) * fresnel;
  look = mix(plastic, look, gel);

  o = vec4(toScreen(look), 1.0);
}`;

// ----------------------------------------------------------------- slab

// The edge of the gel, seen through the wall from low down: a strip the
// depth of the pour, the colour of whatever the gel is at its rim.
export const SLAB_VERTEX = `${HEADER}
layout(location = 0) in vec3 aPosition; // cos, height 0..1, sin
uniform mat4 uViewProj;
uniform vec3 uCentre;
uniform float uRadius;
uniform float uTop;
uniform float uFloor;
out vec3 vWorld;
out vec2 vAround;
void main() {
  vAround = aPosition.xz;
  // To the top of the meniscus, where the surface sheet ends.
  float y = mix(uFloor, uTop + 0.9, aPosition.y);
  vWorld = vec3(uCentre.x + aPosition.x * uRadius, y, uCentre.z + aPosition.z * uRadius);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}`;

export const SLAB_FRAGMENT = `${HEADER}
in vec3 vWorld;
in vec2 vAround;
out vec4 o;
uniform sampler2D uAgar;
uniform float uSpan;
uniform float uRadius;
uniform float uEdge;
${LIGHTING}
void main() {
  // The gel a little way inside the wall at this bearing, clear of the
  // staircase its edge makes. Plate space is (x, -z).
  vec2 uv = vec2(vAround.x, -vAround.y) * (uRadius - 2.4 * uEdge) / uSpan + 0.5;
  vec4 agar = texture(uAgar, uv);
  if (agar.a < 0.006) discard;
  vec3 n = normalize(vec3(vAround.x, 0.0, vAround.y));
  vec3 lamp = lampLevel();
  float diffuse = clamp(dot(n, uLamp) * 0.5 + 0.5, 0.0, 1.0);
  // Edge-on there is far more gel to look through than from above.
  float depth = 1.0 - pow(1.0 - agar.a, 5.0);
  vec3 under = benchAt(vWorld.xz) * 0.6;
  float brightest = max(max(agar.r, max(agar.g, agar.b)), 1e-3);
  vec3 lit = agar.rgb * (lamp * (0.12 + 0.4 * diffuse) + skyLevel() * 1.1);
  vec3 look = mix(under * agar.rgb / brightest, lit, depth);
  if (uLightMode == 1) look = benchAt(vWorld.xz) * 0.5 * agar.rgb / brightest;
  o = vec4(toScreen(look), 1.0);
}`;

// ---------------------------------------------------------------- glass

export const GLASS_VERTEX = `${HEADER}
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProj;
uniform vec3 uCentre;
out vec3 vWorld;
out vec3 vNormal;
void main() {
  vWorld = aPosition + uCentre;
  vNormal = aNormal;
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}`;

export const GLASS_FRAGMENT = `${HEADER}
in vec3 vWorld;
in vec3 vNormal;
out vec4 o;
${LIGHTING}
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  float ndv = max(dot(n, v), 0.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 refl = reflect(-v, n);
  vec3 lamp = lampLevel();
  vec3 sky = skyLevel();
  float patch_ = lampPatch(refl, uLamp, 0.06) + 0.2 * lampPatch(refl, fillDir(), 0.06);
  patch_ *= 3.0;
  // The rim is a moulded edge: it scatters the lamp instead of mirroring it.
  float rim = step(0.9, abs(vNormal.y));
  vec3 colour = sky * (0.5 + 0.5 * clamp(refl.y, 0.0, 1.0)) * 1.4 * fresnel
    + lamp * patch_ * 4.0 * fresnel
    + rim * (lamp * max(uLamp.y, 0.0) * 0.55 + sky * 0.9);
  float alpha = clamp(0.05 + fresnel * 0.8 + patch_ * fresnel * 3.0 + rim * 0.22, 0.0, 0.94);
  if (uLightMode == 1) {
    // Over the light table the wall is a dark outline: it bends the light
    // away from the eye.
    colour = vec3(0.02) + sky * fresnel;
    alpha = clamp(0.1 + fresnel * 0.5 + rim * 0.25, 0.0, 0.9);
  }
  o = vec4(toScreen(colour), alpha);
}`;
