import { describe, expect, it } from 'vitest';
import { GEN, OPENING_SKY, TYPES, TYPE_KEYS, metres } from './clouds.js';
import { COLOR_KEYS, skyAt, sunVector } from './palette.js';
import {
  CRYSTALS,
  CRYSTAL_KEYS,
  DISPLAYS,
  emptyAir,
} from '../optics/displays.js';
import { ORIENTATIONS } from '../optics/halo.js';

const P = { size: 1, height: 1, fluff: 0.5, count: 1 };

describe('the clouds', () => {
  it('builds every kind from its seed, the same way twice', () => {
    for (const type of TYPE_KEYS) {
      const a = GEN[type](1234, P);
      const b = GEN[type](1234, P);
      expect(a.length).toBe(TYPES[type].base);
      expect(a).toEqual(b);
      for (const p of a) {
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        expect(p.r).toBeGreaterThan(0);
      }
    }
  });

  it('adds puffs without moving the ones already there', () => {
    // A slider makes more of the same cloud, not a different one. (A storm
    // shades its puffs by how tall the whole cloud is, so its shade may
    // shift; where they are doesn't.)
    for (const type of TYPE_KEYS) {
      const fewer = GEN[type](77, { ...P, count: 0.6 });
      const more = GEN[type](77, { ...P, count: 1.4 });
      expect(more.length).toBeGreaterThan(fewer.length);
      fewer.forEach((p, i) => {
        expect(more[i].x).toBe(p.x);
        expect(more[i].y).toBe(p.y);
        expect(more[i].z).toBe(p.z);
      });
    }
  });

  it('draws cirrus as streaks and stratus as pancakes', () => {
    const cirrus = GEN.cirrus(5, P);
    expect(cirrus.filter((p) => p.st > 3).length).toBeGreaterThan(
      cirrus.length / 2,
    );
    for (const p of GEN.stratus(5, P)) expect(p.st).toBeLessThan(0.5);
  });

  it('opens on a sky of known kinds, each at a height its kind lives at or near', () => {
    expect(OPENING_SKY.length).toBeGreaterThan(8);
    for (const [type, , y] of OPENING_SKY) {
      expect(TYPES[type]).toBeTruthy();
      const [lo, hi] = TYPES[type].alt;
      expect(y).toBeGreaterThanOrEqual(lo - 1);
      expect(y).toBeLessThanOrEqual(hi + 1);
    }
  });

  it('reads heights in metres, to the nearest fifty', () => {
    expect(metres(8.5)).toBe('1,700 m');
    expect(metres(30)).toBe('6,000 m');
  });
});

describe('the colour of the sky', () => {
  it('has every colour at every height of the sun, and at night', () => {
    for (const sky of [
      skyAt(-5),
      skyAt(0),
      skyAt(15),
      skyAt(40),
      skyAt(90),
      skyAt(30, true),
    ]) {
      for (const k of COLOR_KEYS) {
        expect(sky[k]).toHaveLength(3);
        for (const v of sky[k]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('is the painted sky at the heights it was painted for, and between them between', () => {
    // 23.5° is the morning sky: #A7C4F2 overhead.
    expect(skyAt(23.5).top.map((v) => Math.round(v * 255))).toEqual([
      167, 196, 242,
    ]);
    const low = skyAt(7).top[0];
    const high = skyAt(23.5).top[0];
    const mid = skyAt(15).top[0];
    expect(mid).toBeGreaterThan(Math.min(low, high));
    expect(mid).toBeLessThan(Math.max(low, high));
    // Stars only once the sun is down, and all of them at night.
    expect(skyAt(30).stars).toBe(0);
    expect(skyAt(-1).stars).toBeGreaterThan(0);
    expect(skyAt(30, true).stars).toBe(1);
  });

  it('points at the sun', () => {
    const [x, y, z] = sunVector(30);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);
    expect(y).toBeCloseTo(0.5, 6);
    expect(sunVector(90)[1]).toBeCloseTo(1, 6);
  });
});

describe('the shelf', () => {
  it('offers only crystals the tracer knows how to drop', () => {
    expect(CRYSTAL_KEYS).toEqual(ORIENTATIONS);
    for (const c of CRYSTALS) {
      expect(c.ratio).toBeGreaterThan(0);
      expect(c.makes.length).toBeGreaterThan(0);
    }
    const air = emptyAir();
    for (const k of CRYSTAL_KEYS) expect(air[k].amount).toBe(0);
  });

  it('starts every sky from crystals that are on it, with the sun where its halo can be seen', () => {
    const keys = new Set();
    for (const d of DISPLAYS) {
      expect(keys.has(d.key)).toBe(false);
      keys.add(d.key);
      expect(d.sun).toBeGreaterThanOrEqual(0);
      expect(d.sun).toBeLessThanOrEqual(90);
      for (const k of Object.keys(d.air)) expect(CRYSTAL_KEYS).toContain(k);
      expect(Object.keys(d.air).length > 0 || d.rain > 0).toBe(true);
    }
    const sun = (key) => DISPLAYS.find((d) => d.key === key).sun;
    // The limits the notes give.
    expect(sun('cza')).toBeLessThan(32);
    expect(sun('cha')).toBeGreaterThan(58);
    expect(sun('circumscribed')).toBeGreaterThan(29);
    expect(sun('tangent')).toBeLessThan(29);
    expect(sun('rainbow')).toBeLessThan(42);
  });
});
