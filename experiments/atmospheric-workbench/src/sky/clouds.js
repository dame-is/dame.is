// The five kinds of cloud, and how each is built.
//
// A cloud is a few hundred soft puffs (see puff.js). Each kind is a
// generator: puff i depends only on the cloud's seed and i, so moving a
// slider adds or removes puffs instead of reshuffling them, and changing
// kind lets the same puffs glide into the new shape. Brought over from
// atmosphere.online's sky.js.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rngAt = (seed, i) => {
  const r = mulberry((seed * 7919 + i * 104729 + 17) | 0);
  r();
  return r;
};

/** One unit of the sky is about 200 m of altitude. */
export const metres = (u) =>
  `${(Math.round((u * 200) / 50) * 50).toLocaleString('en-US')} m`;

/**
 * `alt` is the band of heights a kind lives at, in sky units; `alpha` and
 * `ero` how solid it is and how ragged its edges; `drift` how fast the wind
 * carries it; `mood`, `rain` and `thunder` the weather it starts with.
 */
export const TYPES = {
  cumulus: {
    name: 'Cumulus',
    sci: 'Cumulus · Cu',
    blurb: 'Flat-bottomed heaps that build on warm afternoons. Fair weather.',
    base: 160,
    alt: [7, 12],
    alpha: 0.96,
    ero: 0.55,
    drift: 1,
    mood: 0,
    rain: false,
    thunder: false,
  },
  stratus: {
    name: 'Stratus',
    sci: 'Stratus · St',
    blurb: 'A low, even sheet. Grey days, drizzle, fog that lifts.',
    base: 170,
    alt: [3.5, 6],
    alpha: 0.8,
    ero: 0.45,
    drift: 0.7,
    mood: 0.18,
    rain: false,
    thunder: false,
  },
  cirrus: {
    name: 'Cirrus',
    sci: 'Cirrus · Ci',
    blurb: 'Ice crystals combed out by fast winds, way up high.',
    base: 260,
    alt: [27, 33],
    alpha: 0.5,
    ero: 0.95,
    drift: 1.8,
    mood: 0,
    rain: false,
    thunder: false,
  },
  nimbus: {
    name: 'Nimbus',
    sci: 'Cumulonimbus · Cb',
    blurb: 'A towering thunderhead with an anvil top. Makes it rain.',
    base: 300,
    alt: [2.5, 4],
    alpha: 0.97,
    ero: 0.6,
    drift: 0.8,
    mood: 0.55,
    rain: true,
    thunder: true,
  },
  lenticular: {
    name: 'Lenticular',
    sci: 'Lenticularis · Ac len',
    blurb:
      'Stacked lenses that sit still over hills while the wind rushes through.',
    base: 240,
    alt: [15, 20],
    alpha: 0.92,
    ero: 0.28,
    drift: 0,
    mood: 0.02,
    rain: false,
    thunder: false,
  },
};
export const TYPE_KEYS = Object.keys(TYPES);

// Puffs come out in the cloud's own space: about 12 units wide at size 1,
// base at y = 0. A puff can be stretched by st along an axis (ax, ay, az; up
// if left out): over 1 draws a streak along it, under 1 a pancake lying
// across it, 1 (the default) a round puff.
export const GEN = {
  cumulus(seed, P) {
    const R = mulberry(seed);
    const n = Math.round(TYPES.cumulus.base * P.count);
    const out = [];
    const k = 3 + Math.floor(R() * 3);
    const domes = [];
    for (let j = 0; j < k; j++) {
      const f = j / (k - 1) - 0.5;
      const big = 1 - Math.abs(f) * 0.9;
      const rad = 1.9 + big * 1.9 + R() * 0.8;
      domes.push({
        cx: f * 8.5 + (R() - 0.5) * 1.2,
        cz: (R() - 0.5) * 2.6,
        rad,
        H: rad * (0.95 + R() * 0.5) * P.height,
        w: rad,
      });
    }
    const wsum = domes.reduce((s, d) => s + d.w, 0);
    for (let i = 0; i < n; i++) {
      const r = rngAt(seed, i);
      if (r() < 0.22) {
        // the base: wide, flattened puffs, so the bottom reads as one level line
        const x = (r() - 0.5) * 12.4;
        const pr = (1.15 + r() * 0.7) * (0.75 + P.fluff * 0.5);
        out.push({
          x,
          y: pr * 0.3,
          z: (r() - 0.5) * 4.8 * (1 - Math.abs(x) / 9),
          r: pr,
          sh: 0.04,
          st: 0.42,
        });
        continue;
      }
      let pick = r() * wsum;
      let d = domes[0];
      for (const q of domes) {
        pick -= q.w;
        if (pick <= 0) {
          d = q;
          break;
        }
      }
      const u = r() * TAU;
      const v = Math.pow(r(), 0.7);
      const s = Math.sqrt(1 - v * v);
      const rad = Math.pow(r(), 0.3);
      // most fill the dome; some are small, crisp florets right on its skin, the cauliflower look
      const floret = r() < 0.2;
      const pr = floret
        ? (0.5 + r() * 0.3) * (0.8 + P.fluff * 0.4)
        : (0.8 + r() * 1.1) * (1 - rad * 0.25) * (0.7 + P.fluff * 0.6);
      const reach = floret ? 1.08 : rad;
      const x = d.cx + Math.cos(u) * s * d.rad * 1.2 * reach;
      const z = d.cz + Math.sin(u) * s * d.rad * 0.95 * reach;
      out.push({
        x,
        y: Math.max(v * d.H * reach + 0.4, pr * 0.6),
        z,
        r: pr,
        sh: 0,
      });
    }
    return out;
  },
  stratus(seed, P) {
    const R = mulberry(seed);
    const n = Math.round(TYPES.stratus.base * P.count);
    const out = [];
    const W = 14 + R() * 4;
    const D = 6.5 + R() * 2.5;
    const ph = R() * TAU;
    for (let i = 0; i < n; i++) {
      const r = rngAt(seed, i);
      const gx = (r() + r() + r() - 1.5) / 1.5;
      const gz = r() + r() - 1;
      const edge = 1 - Math.min(1, Math.hypot(gx, gz * 0.8));
      const x = gx * W;
      const z = gz * D;
      // one long, even sheet of broad pancakes, its top lifting in a slow swell
      const swell =
        Math.sin(x * 0.3 + ph) * 0.3 + Math.sin(z * 0.55 + ph * 1.7) * 0.18;
      const pr =
        (1.8 + r() * 1.2) * (0.75 + P.fluff * 0.5) * (0.55 + edge * 0.5);
      out.push({
        x,
        y: 0.8 + (swell + (r() - 0.5) * 0.5) * P.height * (0.5 + edge * 0.7),
        z,
        r: pr,
        sh: 0.07 + (1 - edge) * 0.05,
        st: 0.3 + r() * 0.1,
      });
    }
    return out;
  },
  cirrus(seed, P) {
    const R = mulberry(seed);
    const n = Math.round(TYPES.cirrus.base * P.count);
    const out = [];
    const S = 4 + Math.floor(R() * 3);
    const flow = (R() - 0.5) * 0.5;
    const strands = [];
    for (let j = 0; j < S; j++) {
      strands.push({
        x0: -9 + R() * 3,
        z0: (j / (S - 1) - 0.5) * 10 + (R() - 0.5) * 2,
        y0: (R() - 0.5) * 1.2,
        len: 11 + R() * 7,
        ang: flow + (R() - 0.5) * 0.35,
        ph: R() * TAU,
        amp: 0.5 + R() * 0.9,
        waves: 1 + R() * 1.5,
        hook: R() < 0.65,
        lift: 1 + R() * 1.4,
      });
    }
    // a point on a strand: a long, slow wave, most of them ending in a hook
    // that curls up and back, the "mares' tails"
    const at = (s, t) => {
      const ca = Math.cos(s.ang);
      const sa = Math.sin(s.ang);
      const u = t * s.len;
      const wig = Math.sin(t * s.waves * Math.PI + s.ph) * s.amp;
      let x = s.x0 + u * ca - wig * sa;
      let z = s.z0 + u * sa + wig * ca;
      let y = s.y0 + Math.sin(t * 2.2 + s.ph) * 0.35;
      if (s.hook && t > 0.7) {
        const c = (t - 0.7) / 0.3;
        y += c * c * s.lift * 0.6;
        x -= c * c * 0.7 * ca;
        z -= c * c * 0.7 * sa;
      }
      return [x, y * P.height, z];
    };
    for (let i = 0; i < n; i++) {
      const r = rngAt(seed, i);
      const s = strands[Math.floor(r() * S)];
      const t = r();
      const p = at(s, t);
      const a = at(s, Math.max(0, t - 0.02));
      const b = at(s, Math.min(1, t + 0.02));
      let ax = b[0] - a[0];
      let ay = b[1] - a[1];
      let az = b[2] - a[2];
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al;
      ay /= al;
      az /= al;
      // fibres: thin streaks laid along the strand, spread a little across it, a fluffier tuft at the hook
      const off = (r() - 0.5) * 1.1;
      const head = s.hook && t > 0.86;
      const pr =
        (0.3 + r() * 0.28) *
        (0.75 + P.fluff * 0.5) *
        (1 - Math.abs(t - 0.5) * 0.5) *
        (head ? 1.35 : 1);
      out.push({
        x: p[0] - az * off,
        y: 1 + p[1] + (r() - 0.5) * 0.25,
        z: p[2] + ax * off,
        r: pr,
        sh: 0,
        ax,
        ay,
        az,
        st: head ? 1.3 : 3.4 + r() * 2.2,
      });
    }
    return out;
  },
  nimbus(seed, P) {
    const R = mulberry(seed);
    const n = Math.round(TYPES.nimbus.base * P.count);
    const out = [];
    const H = 9.5 * P.height;
    const shear = 2 + R() * 3;
    for (let i = 0; i < n; i++) {
      const r = rngAt(seed, i);
      const q = r();
      let x;
      let y;
      let z;
      let pr;
      let st = 1;
      let ax = 0;
      let ay = 1;
      if (q < 0.22) {
        x = (r() - 0.5) * 13;
        z = (r() - 0.5) * 6.4;
        y = 0.4 + r() * 1.1;
        pr = 1.3 + r() * 0.9;
        st = 0.45;
      } else if (q < 0.62) {
        const t = r();
        const rad = (3.4 - t * 0.9) * Math.sqrt(r());
        const u = r() * TAU;
        x = Math.cos(u) * rad + t * shear * 0.3;
        z = Math.sin(u) * rad * 0.85;
        y = 1.2 + t * H;
        pr = 1.1 + r() * 1.2;
      } else {
        // the anvil: a flat top that spreads downwind and frays into streaks at its far edge
        const ex = -4 + r() * 15;
        x = ex + shear * 0.3;
        z = (r() - 0.5) * 2 * (3 + 0.25 * (ex + 4));
        y = H + 0.5 + r() * 1.4 - Math.max(0, ex - 7) * 0.15;
        pr = (1 + r() * 1.1) * (1 - Math.max(0, ex) / 22);
        if (ex > 6) {
          ax = 1;
          ay = 0;
          st = 1.6 + (ex - 6) * 0.3;
        } else st = 0.42;
      }
      out.push({
        x,
        y,
        z,
        r: pr * (0.7 + P.fluff * 0.6),
        sh: 0,
        ax,
        ay,
        az: 0,
        st,
      });
    }
    const top = H + 2;
    for (const p of out) {
      const h = clamp(p.y / top, 0, 1);
      p.sh = 0.62 * Math.pow(1 - h, 1.6) + 0.05;
    }
    return out;
  },
  lenticular(seed, P) {
    const R = mulberry(seed);
    const n = Math.round(TYPES.lenticular.base * P.count);
    const out = [];
    const L = 2 + Math.floor(R() * 2);
    const layers = [];
    for (let k = 0; k < L; k++) {
      layers.push({
        y: 1 + k * 3.2 * P.height,
        R: 8.2 - k * 1.7 + (R() - 0.5) * 0.8,
      });
    }
    for (let i = 0; i < n; i++) {
      const r = rngAt(seed, i);
      const ly = layers[Math.min(L - 1, Math.floor(Math.pow(r(), 1.2) * L))];
      const u = r() * TAU;
      const d = Math.sqrt(r());
      // polished lenses: broad pancakes, thickest in the middle and thinning to a crisp rim
      const pr = (1.5 + r() * 0.5) * (1 - d * 0.5) * (0.8 + P.fluff * 0.4);
      const dy = (r() - 0.5) * 0.5 * (1 - d * d) * P.height;
      // each lens is lit on its own (hl), so the lower ones don't sink into shadow
      out.push({
        x: Math.cos(u) * d * ly.R * 1.1,
        y: ly.y + dy,
        z: Math.sin(u) * d * ly.R * 0.8,
        r: pr,
        sh: 0.02,
        hl: clamp(0.62 + dy * 0.8 - d * 0.1, 0, 1),
        st: 0.26 + (1 - d) * 0.12,
      });
    }
    return out;
  },
};

/** The sky a first visit opens on: [kind, x, y, z, size, turn]. */
export const OPENING_SKY = [
  ['cumulus', 4, 8.5, -4, 1.05],
  ['cumulus', -27, 10, -26, 1.3],
  ['cumulus', 31, 7, -32, 0.9],
  ['cumulus', -13, 6.5, 6, 0.7],
  ['cumulus', 54, 11, -62, 1.4],
  ['stratus', -42, 4.5, -72, 1.3],
  ['stratus', 36, 4.5, -8, 0.8],
  ['cirrus', -12, 30, -42, 1.6],
  ['cirrus', 38, 32, -24, 1.3],
  ['nimbus', -64, 3, -92, 1.6],
  ['lenticular', 20, 17, -78, 1.2],
  ['cumulus', 0, 9, 78, 1.2],
  ['cumulus', -52, 8, 42, 1],
  ['cumulus', 62, 9, 50, 1.1],
];
