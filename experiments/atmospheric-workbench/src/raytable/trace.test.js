import { describe, expect, it } from 'vitest';
import {
  knownAngle,
  mainExit,
  reachOf,
  ringOf,
  SHAPE_KEYS,
  traceRay,
} from './trace.js';

/** The least any ray of green light is turned, over every turn and offset. */
function leastTurn(key, fold) {
  let least = 180;
  for (let turn = 0; turn < fold; turn += 0.25) {
    for (let oy = -0.95; oy <= 0.95; oy += 0.05) {
      for (const e of traceRay(key, turn, oy, 550).exits) {
        // Straight through two parallel faces isn't a turn at all.
        if (e.order !== 0 || Math.abs(e.deviation) < 1) continue;
        least = Math.min(least, Math.abs(e.deviation));
      }
    }
  }
  return least;
}

describe('the ray table', () => {
  it('turns light through a hexagon of ice by 22° at the least', () => {
    expect(knownAngle('hex')).toBeCloseTo(21.9, 1);
    expect(leastTurn('hex', 60)).toBeCloseTo(knownAngle('hex'), 1);
  });

  it('and through a square corner of it by 46°', () => {
    expect(knownAngle('side')).toBeCloseTo(45.9, 1);
    expect(leastTurn('side', 180)).toBeCloseTo(knownAngle('side'), 1);
  });

  it('turns it further through glass', () => {
    expect(knownAngle('prism')).toBeGreaterThan(45);
    expect(leastTurn('prism', 120)).toBeCloseTo(knownAngle('prism'), 1);
  });

  it('sends the once-bounced ray back out of a raindrop no more than 42° off the way it came', () => {
    let most = 0;
    for (let oy = 0.01; oy < 1; oy += 0.002) {
      const e = mainExit('drop', 0, oy);
      if (e) most = Math.max(most, 180 - Math.abs(e.deviation));
    }
    expect(most).toBeCloseTo(knownAngle('drop'), 1);
    expect(most).toBeGreaterThan(41.5);
    expect(most).toBeLessThan(42.5);
  });

  it('loses no light on the way', () => {
    for (const key of SHAPE_KEYS) {
      for (const oy of [0.1, 0.45, 0.8]) {
        const { exits, missed } = traceRay(
          key,
          17,
          oy * reachOf(key) * 0.9,
          550,
          {
            faintest: 1e-7,
          },
        );
        if (missed) continue;
        const out = exits.reduce((s, e) => s + e.power, 0);
        expect(out).toBeGreaterThan(0.985);
        expect(out).toBeLessThan(1.0001);
      }
    }
  });

  it('says so when the ray misses', () => {
    expect(traceRay('hex', 0, 3, 550).missed).toBe(true);
    expect(mainExit('hex', 0, 3)).toBeNull();
  });

  it('piles tumbling light up at the known angle', () => {
    const brightestAt = (key, from, to) => {
      const ring = ringOf(key, { turns: 90, rays: 48 });
      let best = from;
      const sum = (deg) => {
        const b = Math.floor((deg + 180) * 2) * 3;
        return ring[b] + ring[b + 1] + ring[b + 2];
      };
      for (let d = from; d <= to; d += 0.5) if (sum(d) > sum(best)) best = d;
      return best;
    };
    // A halo's inner edge, a degree or so wide across the colours.
    expect(brightestAt('hex', 10, 60)).toBeGreaterThanOrEqual(21.5);
    expect(brightestAt('hex', 10, 60)).toBeLessThanOrEqual(23.5);
    // The rainbow: 42° short of straight back.
    expect(brightestAt('drop', 100, 175)).toBeGreaterThanOrEqual(137);
    expect(brightestAt('drop', 100, 175)).toBeLessThanOrEqual(139.5);
  });
});
