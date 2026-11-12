import { describe, expect, it } from 'vitest';
import {
  fresnel,
  glassIndex,
  iceIndex,
  minimumDeviation,
  waterIndex,
} from './media.js';
import { spectrum } from './spectrum.js';
import {
  clearSkyMap,
  createSkyMap,
  createTracer,
  develop,
  expose,
  seeded,
  SKY_REACH,
} from './halo.js';
import { bowAngle, BOW_REACH, rainbowTable } from './rainbow.js';

const DEG = Math.PI / 180;

/** The angle between the sun and where a ray's light is seen, in degrees. */
function fromSun(seen, sunAltitude) {
  const a = sunAltitude * DEG;
  const dot = seen.x * Math.cos(a) + seen.z * Math.sin(a);
  return Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
}

/** Count rays by angle from the sun, in bins `step` degrees wide. */
function ringCounts(crystal, sunAltitude, rays, step = 0.5) {
  const random = seeded(7);
  const tracer = createTracer({ random });
  const counts = new Float64Array(Math.ceil(180 / step));
  for (let i = 0; i < rays; i++) {
    if (!tracer.shoot(crystal, sunAltitude)) continue;
    const bin = Math.floor(fromSun(tracer.seen, sunAltitude) / step);
    counts[Math.min(bin, counts.length - 1)] += tracer.seen.weight;
  }
  const at = (deg) => counts[Math.floor(deg / step)];
  return { counts, at, step };
}

describe('what light slows down in', () => {
  it('reads ice, water and glass at the yellow of a sodium lamp', () => {
    // Warren & Brandt give 1.3097 at 590 nm, against a vacuum.
    expect(iceIndex(590)).toBeCloseTo(1.3097 / 1.00028, 4);
    // The handbook value for water at 20 °C, in air.
    expect(waterIndex(589.3)).toBeCloseTo(1.333, 3);
    // Schott's catalogue value for F2 at the helium d line.
    expect(glassIndex(587.56)).toBeCloseTo(1.62, 3);
  });

  it('bends blue more than red in all three', () => {
    for (const index of [iceIndex, waterIndex, glassIndex]) {
      expect(index(450)).toBeGreaterThan(index(650));
    }
  });

  it('reflects about 2 % of light that meets ice head on, and all of it past the critical angle', () => {
    expect(fresnel(1, 1, 1.31)).toBeCloseTo(0.018, 3);
    // Inside ice the critical angle is asin(1 / 1.31) = 49.8°.
    expect(fresnel(Math.cos(49 * DEG), 1.31, 1)).toBeLessThan(1);
    expect(fresnel(Math.cos(51 * DEG), 1.31, 1)).toBe(1);
  });

  it('puts the least a 60° wedge of ice can turn light at 22°, and a 90° wedge at 46°', () => {
    expect(minimumDeviation(1.31, 60)).toBeCloseTo(21.8, 1);
    expect(minimumDeviation(1.31, 90)).toBeCloseTo(45.7, 1);
    // Faces that meet at 120° let nothing through: no halo from those.
    expect(minimumDeviation(1.31, 120)).toBeNull();
  });
});

describe('the spectrum', () => {
  it('adds up to white', () => {
    const bands = spectrum(48);
    const mean = [0, 0, 0];
    for (const { rgb } of bands) rgb.forEach((v, c) => (mean[c] += v / 48));
    for (const v of mean) expect(v).toBeCloseTo(1, 6);
  });

  it('runs from blue at one end to red at the other', () => {
    const bands = spectrum(48);
    const [r0, , b0] = bands[4].rgb;
    const [r1, , b1] = bands[44].rgb;
    expect(b0).toBeGreaterThan(r0);
    expect(r1).toBeGreaterThan(b1);
  });
});

describe('tumbling crystals', () => {
  const rings = ringCounts({ kind: 'random', ratio: 1 }, 30, 400000);

  it('leave the sky dark inside 21° and light it at 22°', () => {
    // Nothing refracted lands inside the halo; only stray reflections do.
    const inside = rings.at(15) + rings.at(17) + rings.at(19);
    const edge = rings.at(22) + rings.at(22.5) + rings.at(23);
    expect(edge).toBeGreaterThan(inside * 8);
    // The edge is sharp: a degree inside it there is almost nothing.
    expect(rings.at(22)).toBeGreaterThan(rings.at(20.5) * 8);
  });

  it('light a second, fainter ring at 46°', () => {
    const before = rings.at(43) + rings.at(43.5);
    const edge = rings.at(46) + rings.at(46.5);
    expect(edge).toBeGreaterThan(before * 1.5);
    expect(rings.at(22)).toBeGreaterThan(rings.at(46) * 2);
  });
});

describe('plates lying flat', () => {
  // Where the brightest light is, as a compass bearing off the sun and a
  // height above the horizon, away from the sun itself.
  function brightest(crystal, sunAltitude, rays) {
    const random = seeded(11);
    const tracer = createTracer({ random });
    const grid = new Map();
    for (let i = 0; i < rays; i++) {
      if (!tracer.shoot(crystal, sunAltitude)) continue;
      const s = tracer.seen;
      if (fromSun(s, sunAltitude) < 5) continue;
      const alt = Math.round(Math.asin(s.z) / DEG);
      const az = Math.round(Math.abs(Math.atan2(s.y, s.x)) / DEG);
      const key = `${az},${alt}`;
      grid.set(key, (grid.get(key) || 0) + s.weight);
    }
    let best = '';
    let most = 0;
    for (const [key, v] of grid) if (v > most) [best, most] = [key, v];
    const [az, alt] = best.split(',').map(Number);
    return { az, alt };
  }

  it('make sun dogs level with the sun, 22° out when it is low', () => {
    const dog = brightest(
      { kind: 'plate', ratio: 0.3, wobble: 0.5 },
      5,
      300000,
    );
    expect(dog.alt).toBeGreaterThanOrEqual(4);
    expect(dog.alt).toBeLessThanOrEqual(6);
    expect(dog.az).toBeGreaterThanOrEqual(22);
    expect(dog.az).toBeLessThanOrEqual(23);
  });

  it('move the sun dogs outward as the sun climbs', () => {
    // A skew ray sees a steeper prism. At 40° the bearing off the sun works
    // out to 36°, which is 28° across the sky.
    const dog = brightest(
      { kind: 'plate', ratio: 0.3, wobble: 0.5 },
      40,
      300000,
    );
    expect(dog.alt).toBeGreaterThanOrEqual(39);
    expect(dog.alt).toBeLessThanOrEqual(41);
    expect(dog.az).toBeGreaterThanOrEqual(35);
    expect(dog.az).toBeLessThanOrEqual(38);
  });

  // Light in the sun's own compass direction and well above the 46° ring's
  // height: only the circumzenithal arc puts any there.
  function overhead(sunAltitude) {
    const random = seeded(3);
    const tracer = createTracer({ random });
    const byAlt = new Float64Array(91);
    for (let i = 0; i < 400000; i++) {
      if (
        !tracer.shoot({ kind: 'plate', ratio: 0.3, wobble: 0.3 }, sunAltitude)
      )
        continue;
      const s = tracer.seen;
      if (s.z <= 0 || Math.abs(Math.atan2(s.y, s.x)) > 4 * DEG) continue;
      byAlt[Math.round(Math.asin(s.z) / DEG)] += s.weight;
    }
    return byAlt;
  }

  it('draw the circumzenithal arc 46° above a 20° sun', () => {
    // Its top is where sin(altitude) = sqrt(n² − cos²(sun)): 66°.
    const byAlt = overhead(20);
    let peak = 50;
    for (let a = 50; a <= 90; a++) if (byAlt[a] > byAlt[peak]) peak = a;
    expect(peak).toBeGreaterThanOrEqual(65);
    expect(peak).toBeLessThanOrEqual(68);
    expect(byAlt[peak]).toBeGreaterThan(0);
  });

  it('and lose it once the sun is above 32°', () => {
    const low = overhead(20);
    const high = overhead(40);
    const sum = (a) => a.slice(60, 91).reduce((s, v) => s + v, 0);
    expect(sum(high)).toBeLessThan(sum(low) * 0.02);
  });
});

describe('the picture', () => {
  it('collects rays into a map of the sky and develops it', () => {
    const random = seeded(5);
    const tracer = createTracer({ random });
    const map = createSkyMap(128);
    const crystals = [{ kind: 'random', ratio: 1, share: 1 }];
    expose(tracer, map, crystals, 30, 60000, random);
    expect(map.rays).toBe(60000);
    const { image, size } = develop(map, 0.1);
    expect(size).toBe(128);
    expect(image.length).toBe(128 * 128 * 4);
    // Developed coarse, it is a smaller picture of the same sky.
    expect(develop(map, 0.1, 4).size).toBe(32);
    // The sun is 60° down from the zenith, toward +x: that pixel is lit.
    const x = Math.floor(64 + (60 / SKY_REACH) * 64);
    expect(image[(64 * 128 + x) * 4]).toBeGreaterThan(0);
    clearSkyMap(map);
    expect(map.rays).toBe(0);
    expect(map.light.every((v) => v === 0)).toBe(true);
  });
});

describe('the rainbow', () => {
  it('puts the primary at 42° and the secondary at 51°, red on the outside of the first', () => {
    const red = waterIndex(650);
    const violet = waterIndex(420);
    expect(bowAngle(red, 1)).toBeCloseTo(42.3, 0);
    expect(bowAngle(violet, 1)).toBeCloseTo(40.6, 0);
    expect(bowAngle(red, 1)).toBeGreaterThan(bowAngle(violet, 1));
    // The secondary is the other way up.
    expect(bowAngle(red, 2)).toBeCloseTo(50.4, 0);
    expect(bowAngle(violet, 2)).toBeGreaterThan(bowAngle(red, 2));
  });

  it('is brightest at the primary, dark between the bows, and lit inside', () => {
    const bins = 720;
    const table = rainbowTable({ bins, bands: 32, rays: 2000 });
    const at = (deg) => {
      const b = Math.round((deg / BOW_REACH) * bins);
      return table[b * 3] + table[b * 3 + 1] + table[b * 3 + 2];
    };
    let peak = 0;
    for (let d = 10; d < 70; d += 0.1) if (at(d) > at(peak)) peak = d;
    expect(peak).toBeGreaterThan(40);
    expect(peak).toBeLessThan(43);
    // Alexander's band.
    expect(at(46)).toBe(0);
    expect(at(48)).toBe(0);
    // The secondary, fainter than the primary.
    expect(at(52)).toBeGreaterThan(0);
    expect(at(52)).toBeLessThan(at(peak) * 0.6);
    // And the sky inside the bow is brighter than the sky outside it.
    expect(at(30)).toBeGreaterThan(at(60));
  });
});
