import { describe, expect, it } from 'vitest';
import {
  VITALS_EXPIRED_MS,
  VITALS_STALE_MS,
  normalizeVitals,
  vitalsFreshness,
} from './vitals.js';

const NOW = Date.parse('2026-10-27T15:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

describe('vitalsFreshness', () => {
  it('is fresh for a recent reading', () => {
    expect(vitalsFreshness(ago(20 * 60 * 1000), NOW)).toEqual({
      ageMs: 20 * 60 * 1000,
      stale: false,
      expired: false,
    });
  });

  it('goes stale past the threshold', () => {
    const f = vitalsFreshness(ago(VITALS_STALE_MS), NOW);
    expect(f.stale).toBe(true);
    expect(f.expired).toBe(false);
  });

  it('expires after a day', () => {
    const f = vitalsFreshness(ago(VITALS_EXPIRED_MS + 1), NOW);
    expect(f.stale).toBe(true);
    expect(f.expired).toBe(true);
  });

  it('treats a missing or unparseable timestamp as fresh', () => {
    for (const v of [null, undefined, '', 'not a date']) {
      expect(vitalsFreshness(v, NOW)).toEqual({
        ageMs: null,
        stale: false,
        expired: false,
      });
    }
  });

  it('clamps a reading from the future to age 0', () => {
    expect(vitalsFreshness(ago(-60_000), NOW).ageMs).toBe(0);
  });

  it('reads the timestamp normalizeVitals carries', () => {
    const v = normalizeVitals({
      heartRate: '72',
      capturedAt: ago(3 * 3_600_000),
    });
    expect(vitalsFreshness(v.sampledAt, NOW).stale).toBe(true);
  });
});
