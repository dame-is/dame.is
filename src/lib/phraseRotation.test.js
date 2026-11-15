import { describe, expect, it } from 'vitest';
import { createRotation } from './phraseRotation.js';

const poolOf = (n) => Array.from({ length: n }, (_, i) => `phrase ${i}`);

/** Show `steps` phrases the way HeroSentence does: pick, then record. */
function run(pool, steps, start = 0) {
  const rot = createRotation();
  const shown = [pool[start]];
  rot.see(pool[start], pool);
  for (let s = 0; s < steps; s += 1) {
    const text = pool[rot.next(pool)];
    rot.see(text, pool);
    shown.push(text);
  }
  return shown;
}

describe('createRotation', () => {
  // The live pools on 2026-11-15: 11 roles and 13 clauses.
  for (const n of [11, 13, 4, 3]) {
    it(`shows all ${n} phrases once per round`, () => {
      const pool = poolOf(n);
      const shown = run(pool, n * 60);
      for (let r = 0; r + n <= shown.length; r += n) {
        expect(new Set(shown.slice(r, r + n)).size).toBe(n);
      }
    });

    it(`keeps a repeat at least half of ${n} away`, () => {
      const pool = poolOf(n);
      const gap = Math.floor(n / 2);
      const shown = run(pool, n * 60);
      for (let k = 1; k < shown.length; k += 1) {
        expect(shown.slice(Math.max(0, k - gap), k)).not.toContain(shown[k]);
      }
    });
  }

  it('alternates a pool of two and stays put on a pool of one', () => {
    expect(run(['a', 'b'], 5)).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
    expect(run(['a'], 3)).toEqual(['a', 'a', 'a', 'a']);
  });

  it('only moves on what was seen, so asking twice changes nothing', () => {
    const pool = poolOf(13);
    const rot = createRotation();
    rot.see(pool[0], pool);
    const draws = [0.1, 0.9, 0.5];
    let d = 0;
    const random = () => draws[d++ % draws.length];
    const first = rot.next(pool, random);
    d = 0;
    expect(rot.next(pool, random)).toBe(first);
  });

  it('never returns the phrase on screen after the pool changes', () => {
    const pool = poolOf(13);
    const rot = createRotation();
    for (let i = 0; i < 9; i += 1) rot.see(pool[i], pool);
    // Most of the round so far is gone; the phrase on screen stays.
    const smaller = [pool[8], 'new a', 'new b'];
    for (let i = 0; i < 50; i += 1) {
      const next = rot.next(smaller);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(smaller.length);
      expect(smaller[next]).not.toBe(pool[8]);
    }
  });
});
