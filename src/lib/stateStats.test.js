import { describe, it, expect } from 'vitest';
import { caloriesToday, computeStats } from './stateStats.js';

/** A normalized state sample, as useStateHistory hands them over. */
const sample = (sampledAt, over = {}) => ({
  heartRate: null,
  soundLevel: null,
  caloriesBurned: null,
  activity: null,
  ...over,
  sampledAt,
  t: Date.parse(sampledAt),
});

describe('caloriesToday', () => {
  // Last night's total, then the phone's midnight post (a 0, which normalizes
  // to no reading), in Eastern daylight time.
  const night = [
    sample('2026-10-26T23:00:00-04:00', { caloriesBurned: 851 }),
    sample('2026-10-27T00:00:00-04:00'),
  ];

  it('is nothing between midnight and the first reading of the day', () => {
    expect(
      caloriesToday(night, Date.parse('2026-10-27T03:00:00-04:00')),
    ).toBeNull();
  });

  it('is the newest reading once today has one', () => {
    const morning = [
      ...night,
      sample('2026-10-27T09:00:00-04:00', { caloriesBurned: 120 }),
    ];
    expect(
      caloriesToday(morning, Date.parse('2026-10-27T09:30:00-04:00')),
    ).toBe(120);
  });

  it('turns the day over on the phone’s clock, not the reader’s', () => {
    // 23:30 Eastern is already tomorrow in UTC; the reading is still today's.
    const late = [sample('2026-10-26T23:00:00-04:00', { caloriesBurned: 851 })];
    expect(caloriesToday(late, Date.parse('2026-10-26T23:30:00-04:00'))).toBe(
      851,
    );
  });

  it('is nothing without samples', () => {
    expect(caloriesToday([], Date.now())).toBeNull();
    expect(caloriesToday(null, Date.now())).toBeNull();
  });
});

describe('computeStats', () => {
  const now = Date.parse('2026-10-27T12:00:00-04:00');
  const samples = [
    sample('2026-10-25T12:00:00-04:00', { heartRate: 90, activity: 'walking' }),
    sample('2026-10-27T08:00:00-04:00', {
      heartRate: 60,
      soundLevel: 40,
      activity: 'stationary',
    }),
    sample('2026-10-27T10:00:00-04:00', {
      heartRate: 80,
      soundLevel: 50,
      activity: 'stationary',
    }),
  ];

  it('keeps to the window', () => {
    const stats = computeStats(samples, 24, now);
    expect(stats.count).toBe(2);
    expect(stats.avgHr).toBe(70);
    expect(stats.peakHr).toBe(80);
    expect(stats.avgDb).toBe(45);
    expect(stats.hrSeries).toHaveLength(2);
    expect(stats.activity).toEqual([
      { activity: 'stationary', count: 2, pct: 1 },
    ]);
  });

  it('widens with the window', () => {
    expect(computeStats(samples, 24 * 7, now).count).toBe(3);
  });
});
