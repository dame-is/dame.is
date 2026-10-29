import { afterEach, describe, it, expect } from 'vitest';
import { dayOfLife, dayOfLifeSnapshot } from './dayOfLife.js';

// The same instants, counted from the zones the site's readers are in. The
// count is on the New York calendar, so every zone has to get the same
// number at the same moment — which, before, none west or east of New York
// did for part of every day: Los Angeles ran three hours behind the share
// cards' folio, Tokyo thirteen ahead. Node re-reads TZ whenever it is
// assigned, and it is put back after every test.
const ZONES = [
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'UTC',
  'Asia/Tokyo',
  // Skipped Dec 31 1994 moving across the date line, which a count between
  // local midnights once came out a day short on.
  'Pacific/Kiritimati',
];
const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each(ZONES)('in %s', (zone) => {
  it('counts Oct 27 2026 in New York as Day 12,227, all day', () => {
    process.env.TZ = zone;
    expect(dayOfLife(new Date('2026-10-27T00:01:00-04:00'))).toBe(12227);
    expect(dayOfLife(new Date('2026-10-27T12:00:00-04:00'))).toBe(12227);
    // 8:30 pm in Los Angeles, 3:30 am on the 28th in London, 12:30 pm on the
    // 28th in Tokyo: still the 27th in New York.
    expect(dayOfLife(new Date('2026-10-27T23:30:00-04:00'))).toBe(12227);
  });

  it('moves to Day 12,228 at midnight in New York', () => {
    process.env.TZ = zone;
    // 9:01 pm on the 27th in Los Angeles.
    expect(dayOfLife(new Date('2026-10-28T00:01:00-04:00'))).toBe(12228);
  });

  it('keeps May 6 in the old year of life and starts the new one on May 7', () => {
    process.env.TZ = zone;
    expect(dayOfLifeSnapshot(new Date('2026-05-06T21:00:00-04:00'))).toMatchObject({
      year: 33,
      dayOfYear: 365,
    });
    expect(dayOfLifeSnapshot(new Date('2026-05-07T00:30:00-04:00'))).toMatchObject({
      year: 34,
      dayOfYear: 1,
    });
  });
});
