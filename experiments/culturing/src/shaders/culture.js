// The biology pass: one step of everything alive on the surface.
//
// Each of a plate's four cultures is two populations.
//
//   Motile (uB) is the thin layer that travels: swarmers, gliders, the
//   exploring edge. It spreads by a diffusion that needs company and a wet
//   surface (cells move in rafts, not alone), is carried up a nutrient
//   gradient and down a surfactant or toxin one, and settles when it thins
//   out, starves or dries. A culture can also be carried the way a film of
//   liquid is, faster where it lies thicker; that one rule is what breaks a
//   swarm's front into tendrils (see uTaxRaft below).
//
//   Settled (uD) is the biofilm. It doesn't diffuse; it creeps, pushed outward
//   by its own growth like a viscous drop, which is what gives a colony a
//   sharp edge and a domed profile. It thickens in place while there is food
//   under it, and where a culture swarms it sends out new motile cells while
//   it is inside a window of density.
//
// The pair is the old split from the colony-pattern literature (active and
// inactive cells in Mimura et al. 2000; swarmer and vegetative cells in
// Esipov & Shapiro 1998 and Czirók et al. 2001), and the creeping term with
// its nutrient gate is Kawasaki et al. 1997. The patterns are not drawn:
// branching, rings, tendrils, sectors and standoffs all come out of these few
// rules meeting a nutrient field that can run short.
//
// Every exchange between two texels is written so that both compute the same
// number for it. That is not bookkeeping for its own sake: a front only
// fingers if spreading out costs it something, and a scheme that makes
// biomass out of nothing as a swarm fans out never starves and never
// branches.

import { HEADER, HASH, STENCIL } from './common.js';

export const CULTURE_FRAGMENT = `${HEADER}
uniform sampler2D uB;
uniform sampler2D uD;
uniform sampler2D uAux;
uniform sampler2D uC0;
uniform sampler2D uC1;
uniform sampler2D uC3;     // which compartment of the vessel (vessels.js)

uniform float uChemSize;
uniform float uHours;
uniform uint uStep;
uniform uint uSeed;
uniform float uWet;        // how wet the surface is now, 0..1
uniform float uSurfWet;    // how much a unit of surfactant wets it further
uniform float uLight;      // lights on, 0..1
uniform float uArriveAt;   // density that counts as "biomass is here"
uniform float uYoungHours; // how long new growth stays competent to band
uniform bool uHasTaxis;

// One component per culture on the plate.
uniform vec4 uGrowB;        // motile growth, per step
uniform vec4 uGrowD;        // settled growth, per step
uniform vec4 uSuit[6];      // how well each grows on each compartment's medium
uniform vec4 uKn;           // nutrient at half the best growth
uniform vec4 uCapB;         // how dense the motile layer gets
uniform vec4 uCutoff;       // the least of it that can grow at all
uniform vec4 uCapD;         // how thick the biofilm gets
uniform vec4 uActive;       // how much of that thickness is still growing
uniform vec4 uTemp;         // growth at this temperature, 0..1
uniform vec4 uPhOpt;
uniform vec4 uPhTol;
uniform vec4 uNoise;        // step-to-step unevenness in growth
uniform vec4 uPatchy;       // how much the agar's unevenness matters to it

uniform vec4 uMotB;         // swarm diffusivity on a fully wet surface
uniform vec4 uMotExp;       // how strongly moving needs company
uniform vec4 uMotHalf;      // the density at which a raft moves freely
uniform vec4 uMotFloor;     // the fraction of that a lone cell manages
uniform vec4 uWetNeed;      // how strongly moving needs a wet surface
uniform vec4 uHinder;       // how far foreign biofilm blocks a swarm
uniform vec4 uCreep;        // biofilm's pressure-driven spreading
uniform vec4 uCreepIdle;    // the part of it that goes on without food

uniform vec4 uSettle;       // motile -> settled, always
uniform vec4 uSettleStarve; // ... more when starved
uniform vec4 uSettleThin;   // ... more when the raft has thinned out
uniform vec4 uSettleDry;    // ... more on a dry surface
uniform vec4 uRaft;         // density under which a raft counts as thin
uniform vec4 uLaunch;       // settled -> motile, inside the window below
uniform vec4 uLaunchLo;
uniform vec4 uLaunchHi;
uniform vec4 uLaunchTop;    // ... and not once it is denser than this

uniform vec4 uTaxN;         // drift up the nutrient gradient
uniform vec4 uTaxS;         // drift down the surfactant gradient
uniform vec4 uTaxX;         // drift down the toxin gradient
uniform vec4 uTaxMax;       // the fastest a raft is carried, texels per step
uniform vec4 uTaxRaft;      // how far that speed needs a thick raft too, 0..1
uniform float uTaxK;

uniform vec4 uSensX;        // 1 / (toxin X that halves growth)
uniform vec4 uSensY;
uniform vec4 uKill;         // lysis once growth is mostly stopped
uniform vec4 uKin;          // harm done to other cultures on contact
uniform vec4 uKinKill;
uniform vec4 uLyse;         // autolysis of old, starved biofilm
uniform vec4 uLyseAfter;    // hours before it starts

uniform vec4 uMutRate;      // chance new ground is founded by a sport
uniform vec4 uMutAdv;       // its growth advantage

uniform vec4 uPigRate;      // pigment coming up, per step
uniform vec4 uPigQ;         // signal needed first (0 = none)
uniform vec4 uPigLight;     // 1 = only young growth under light pigments
uniform vec4 uPigStarve;    // 1 = only once the food has run down

layout(location = 0) out vec4 oB;
layout(location = 1) out vec4 oD;
layout(location = 2) out vec4 oAux;

${HASH}
${STENCIL}

// pow() for a base that may be zero and an exponent that may be zero too.
vec4 powSafe(vec4 x, vec4 k) {
  return exp(k * log(max(x, vec4(1e-6))));
}

// The agar textures are half this pass's resolution, and this texel and its
// eight neighbours all fall inside one 3×3 block of them. So the block is
// fetched once and the nine interpolations done here: fewer fetches than
// nine bilinear reads, the same answer on hardware that can't filter a
// 32-bit float texture, and every neighbour's chemistry on hand for free.
//
// The weights are over (left, middle, right) for an offset of -1, 0, +1
// texels of this pass; which set applies depends on whether this texel is
// the left or the right one of its pair.
const vec3 EVEN[3] = vec3[3](vec3(0.75, 0.25, 0.0), vec3(0.25, 0.75, 0.0), vec3(0.0, 0.75, 0.25));
const vec3 ODD[3] = vec3[3](vec3(0.25, 0.75, 0.0), vec3(0.0, 0.75, 0.25), vec3(0.0, 0.25, 0.75));

void agarBlock(sampler2D t, ivec2 p, out vec4 at[9]) {
  ivec2 m = p >> 1;
  ivec2 hi = ivec2(int(uChemSize) - 1);
  vec4 k[9];
  for (int y = 0; y < 3; y++) {
    for (int x = 0; x < 3; x++) {
      k[y * 3 + x] = texelFetch(t, clamp(m + ivec2(x - 1, y - 1), ivec2(0), hi), 0);
    }
  }
  bool oddX = (p.x & 1) == 1;
  bool oddY = (p.y & 1) == 1;
  for (int oy = 0; oy < 3; oy++) {
    vec3 wy = oddY ? ODD[oy] : EVEN[oy];
    for (int ox = 0; ox < 3; ox++) {
      vec3 wx = oddX ? ODD[ox] : EVEN[ox];
      vec4 r0 = wx.x * k[0] + wx.y * k[1] + wx.z * k[2];
      vec4 r1 = wx.x * k[3] + wx.y * k[4] + wx.z * k[5];
      vec4 r2 = wx.x * k[6] + wx.y * k[7] + wx.z * k[8];
      at[oy * 3 + ox] = wy.x * r0 + wy.y * r1 + wy.z * r2;
    }
  }
}

// What a culture drifts down, in two parts. Toward food: the log makes the
// pull depend on the relative change in nutrient, as chemotaxis does. Away
// from what repels it: its own surfactant, anyone's toxin.
vec4 foodPotential(vec4 c0) {
  return -uTaxN * log(uTaxK + max(c0.r, 0.0));
}
vec4 repelPotential(vec4 c0, vec4 c1) {
  return uTaxS * c0.g + uTaxX * (c0.b + c1.a);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 aux = texelFetch(uAux, p, 0);
  if (aux.a < 0.5) {
    oB = vec4(0.0);
    oD = vec4(0.0);
    oAux = vec4(-1.0, 0.0, 0.0, aux.a);
    return;
  }

  vec4 b = texelFetch(uB, p, 0);
  vec4 d = texelFetch(uD, p, 0);
  vec4 k0[9];
  vec4 k1[9];
  agarBlock(uC0, p, k0);
  agarBlock(uC1, p, k1);
  vec4 c0 = k0[4];
  vec4 c1 = k1[4];
  float n = max(c0.r, 0.0);

  float rhoB = dot(b, ONE);
  float rhoD = dot(d, ONE);
  float rho = rhoB + rhoD;

  // The agar is not perfectly even, and that is frozen in for the life of
  // the plate: a little more give here, a little less there (written into
  // the mask channel when the plate is poured, as 1 ± 0.4). The published
  // models carry the same term, and say why: without it a branching front
  // breaks the grid's symmetry instead of its own, and grows a cross.
  float grain = (aux.a - 1.0) * 2.5;
  // Growth is never quite even from one hour to the next, and each
  // culture has its own luck: it is what lets one of two equal strains
  // take a stretch of the edge from the other.
  uint tick = uSeed ^ (uStep * 2654435761u);
  vec4 jitter = vec4(
    hash(p, tick), hash(p, tick + 101u), hash(p, tick + 211u), hash(p, tick + 307u)
  ) * 2.0 - 1.0;

  vec4 fN = vec4(n) / (n + uKn);
  float wetHere = clamp(uWet + uSurfWet * c0.g, 0.0, 1.0);

  // ---- Movement: exchange with the eight neighbours -------------------
  vec4 dB = vec4(0.0);
  vec4 dD = vec4(0.0);
  float bestNeighbour = 0.0;
  float inherited = 0.0;

  // What each culture drifts down, at this texel and its eight neighbours:
  // toward food, away from what repels it.
  vec4 psi[9];
  if (uHasTaxis) {
    for (int k = 0; k < 9; k++) {
      psi[k] = foodPotential(k0[k]) + repelPotential(k0[k], k1[k]);
    }
  }

  for (int j = 0; j < 8; j++) {
    ivec2 q = p + OFF[j];
    vec4 xj = texelFetch(uAux, q, 0);
    if (xj.a < 0.5) continue; // the dish wall, or a cut: nothing crosses
    vec4 bj = texelFetch(uB, q, 0);
    vec4 dj = texelFetch(uD, q, 0);
    int kj = (OFF[j].y + 1) * 3 + OFF[j].x + 1;
    vec4 c0j = k0[kj];
    float w = WGT[j];

    // Everything below is evaluated at the face between the two texels,
    // from the mean of the two, so both arrive at the same exchange.
    vec4 give = max(1.0 + uPatchy * (0.5 * (grain + (xj.a - 1.0) * 2.5)), 0.0);
    float nf = 0.5 * (n + max(c0j.r, 0.0));
    vec4 fNf = vec4(nf) / (nf + uKn);
    float wetJ = clamp(uWet + uSurfWet * c0j.g, 0.0, 1.0);
    vec4 wetF = powSafe(vec4(0.5 * (wetHere + wetJ)), uWetNeed);

    // A swarm moves as a raft: the diffusivity falls almost to nothing as
    // the layer thins, so the front is sharp and can stall. The little
    // that is left (uMotFloor) is what a lone cell manages; it keeps the
    // front a texel or two wide, which is what stops it squaring off.
    vec4 bf = 0.5 * (b + bj);
    float rhoDj = dot(dj, ONE);
    vec4 foreign = max(vec4(0.5 * (rhoD + rhoDj)) - 0.5 * (d + dj), 0.0);
    vec4 raft = uMotFloor
      + (1.0 - uMotFloor) * powSafe(clamp(bf / uMotHalf, 0.0, 1.0), uMotExp);
    vec4 passable = wetF * give * exp(-uHinder * foreign);
    dB += w * uMotB * raft * passable * (bj - b);

    // Carried: down the potential, taken from the upstream texel. The
    // speed is capped, and the cap has to bite on the gradient's whole
    // length, not on this face's share of it: capped face by face, a swarm
    // at full speed goes a fifth faster along the grid's diagonals and
    // grows square. Both texels can work out the whole gradient at the
    // face between them from points they both hold, so they still agree.
    if (uHasTaxis) {
      ivec2 o = OFF[j];
      vec4 drop = psi[kj] - psi[4];
      vec4 along;
      vec4 across;
      if (o.x != 0 && o.y != 0) {
        along = drop * 0.7071068;
        across = (psi[(o.y + 1) * 3 + 1] - psi[4 + o.x]) * 0.7071068;
      } else {
        // The two texels to either side of this face, on both rows.
        ivec2 t = ivec2(-o.y, o.x);
        int a0 = (t.y + 1) * 3 + t.x + 1;
        int a1 = (-t.y + 1) * 3 - t.x + 1;
        int b0 = (o.y + t.y + 1) * 3 + o.x + t.x + 1;
        int b1 = (o.y - t.y + 1) * 3 + o.x - t.x + 1;
        along = drop;
        across = 0.25 * ((psi[a0] - psi[a1]) + (psi[b0] - psi[b1]));
      }
      vec4 steep = sqrt(along * along + across * across);
      vec4 v = -drop * min(ONE, uTaxMax / max(steep, vec4(1e-6))) * passable;
      // A swarm that spreads on its own surfactant is a film of liquid
      // dragged along by its surface, and a film like that moves at a speed
      // that grows with its depth. So a stretch of the front that is a
      // little thicker gets a little ahead, comes to fresh agar first,
      // thickens on it, and pulls away; the thin stretches between are left
      // on ground already eaten, slow down and set. The front does not stay
      // a front: it goes out as tendrils with bare agar between them.
      v *= mix(ONE, raft, uTaxRaft);
      dB += w * (max(-v, 0.0) * bj - max(v, 0.0) * b);
    }

    // Biofilm creeps down its own pressure gradient, each culture carried
    // with the flow it is part of. Taken from the upstream texel, so two
    // colonies that meet push against each other and neither soaks into
    // the other. It needs growth to drive it: where the food is gone the
    // film sets, which is what keeps a branch a branch.
    float rf = 0.5 * (rhoD + rhoDj);
    float dr = rhoDj - rhoD;
    vec4 creep = uCreep * (uCreepIdle + (1.0 - uCreepIdle) * fNf) * give;
    dD += w * creep * rf * (max(dr, 0.0) * dj - max(-dr, 0.0) * d);

    // Whoever is densest next door is who founds this texel.
    float tj = dot(bj + dj, ONE);
    if (xj.r >= 0.0 && tj > bestNeighbour) {
      bestNeighbour = tj;
      inherited = xj.b;
    }
  }

  // ---- Growth ---------------------------------------------------------
  vec4 tox = uSensX * c0.b + uSensY * c1.a;
  vec4 inhib = tox * tox / (1.0 + tox * tox);
  vec4 dPh = (vec4(c1.r) - uPhOpt) / uPhTol;
  vec4 phF = exp(-dPh * dPh);

  // Cultures that fight on contact: each is harmed by the others in
  // proportion to their share of this texel. It is what keeps two strains
  // from blending, and turns a mixed drop into sectors.
  vec4 share = (b + d) / max(rho, 1e-6);
  vec4 harm = max(vec4(dot(uKin, share)) - uKin * share, 0.0);

  int part = clamp(int(texelFetch(uC3, p >> 1, 0).r + 0.5), 0, 5);
  vec4 gmod = uTemp * uSuit[part] * phF * (1.0 - inhib)
    * (1.0 + uMutAdv * aux.b)
    * max(1.0 - harm, 0.0)
    * max(1.0 + uNoise * jitter, 0.0);

  // Nothing grows from less than a cell. Without this floor the faintest
  // trace that leaks into the next texel multiplies as fast as a crowd
  // does, the front is carried forward by the arithmetic instead of the
  // biology, and it travels a fifth faster along the grid's diagonals: a
  // round swarm comes out square. The floor is Kessler and Levine's, and
  // it is also part of why a starved front fingers.
  vec4 seeded = smoothstep(0.5 * uCutoff, uCutoff, b);
  vec4 growB = uGrowB * gmod * fN * b * seeded * max(1.0 - rhoB / uCapB, 0.0);
  // A biofilm grows through its whole thickness only while it is thin.
  // Past a few tens of microns the food and the oxygen don't reach the
  // middle, the growing part is a layer of fixed depth, and the film
  // thickens at a steady rate that tails off toward its full height:
  // dh/dt = a·min(h, L) − b·h, as interferometry of real colonies finds
  // (Bravo et al. 2023). It is why a colony is domed and not flat-topped:
  // its middle has simply been at it longer.
  vec4 layer = min(ONE, uActive / max(rhoD, 1e-6));
  vec4 growD = uGrowD * gmod * fN * d * max(layer - uActive / uCapD, 0.0);

  // ---- Changing state -------------------------------------------------
  vec4 thin = 1.0 - smoothstep(uRaft * 0.5, uRaft, b);
  vec4 settleRate = uSettle
    + uSettleStarve * (1.0 - fN)
    + uSettleThin * thin
    + uSettleDry * (1.0 - wetHere);
  vec4 settle = min(settleRate, vec4(0.6)) * b;

  // Swarmers are made by biofilm inside a window of density: a patch that
  // has just been colonised has to thicken first, and one that has grown
  // past the window stops (Czirók et al. 2001). The wait to get into the
  // window is the pause between a swarming colony's rings, which is why
  // their period follows the doubling time and not the agar.
  vec4 wetB = powSafe(vec4(wetHere), uWetNeed);
  vec4 launch = uLaunch * smoothstep(uLaunchLo, uLaunchHi, d)
    * (1.0 - smoothstep(uLaunchTop, uLaunchTop * 1.15, d))
    * fN * wetB * d * max(1.0 - rhoB / uCapB, 0.0);

  float age = aux.r >= 0.0 ? uHours - aux.r : 0.0;
  vec4 lysis = uKill * smoothstep(0.5, 0.95, inhib) + uKinKill * harm;
  vec4 autolysis = uLyse * (1.0 - fN) * smoothstep(uLyseAfter, uLyseAfter * 2.0, vec4(age));

  vec4 bNew = max(b + dB + growB - settle + launch - lysis * b, 0.0);
  vec4 dNew = max(d + dD + growD + settle - launch - (lysis + autolysis) * d, 0.0);

  // ---- What the patch remembers ---------------------------------------
  float arrival = aux.r;
  float pig = aux.g;
  float sport = aux.b;
  float rhoNew = dot(bNew + dNew, ONE);
  vec4 shareNew = (bNew + dNew) / max(rhoNew, 1e-6);

  if (arrival < 0.0 && rhoNew > uArriveAt) {
    arrival = uHours;
    sport = bestNeighbour > 0.0 ? inherited : 0.0;
    if (hash(p, uSeed ^ 0x9e3779b9u) < dot(uMutRate, shareNew)) sport = 1.0;
  }
  if (arrival >= 0.0 && rhoNew < uArriveAt * 0.05) {
    // Scraped, lysed or starved away: the ground is open again.
    arrival = -1.0;
    pig = 0.0;
    sport = 0.0;
  }

  if (arrival >= 0.0) {
    float young = exp(-(uHours - arrival) / uYoungHours);
    vec4 qGate = mix(
      vec4(1.0),
      smoothstep(uPigQ * 0.6, uPigQ * 1.4, vec4(c0.a)),
      step(1e-6, uPigQ)
    );
    vec4 lGate = mix(vec4(1.0), vec4(uLight * young), uPigLight);
    vec4 sGate = mix(vec4(1.0), 1.0 - fN, uPigStarve);
    float rate = dot(shareNew, uPigRate * qGate * lGate * sGate);
    pig = clamp(pig + rate * (1.0 - pig), 0.0, 1.0);
  }

  oB = bNew;
  oD = dNew;
  oAux = vec4(arrival, pig, sport, aux.a);
}
`;
