import { afterEach, describe, it, expect } from 'vitest';
import { dayOfLife, dayOfLifeSnapshot } from './dayOfLife.js';

// The same calendar facts, read in the zones the site's readers are in. Node
// re-reads TZ whenever it is assigned, and it is put back after every test.
// The birthdate used to be parsed as UTC midnight, which ran every count a day
// ahead west of Greenwich — the owner's own zone among them — while UTC and
// Europe read correctly, so a runner in either never saw it.
const ZONES = [
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
  'Asia/Tokyo',
  // Skipped Dec 31 1994 moving across the date line, which a count between
  // local midnights came out a day short on.
  'Pacific/Kiritimati',
];
const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each(ZONES)('in %s', (zone) => {
  it('counts Oct 27 2026 as Day 12,227', () => {
    process.env.TZ = zone;
    expect(dayOfLife(new Date(2026, 9, 27, 12))).toBe(12227);
    expect(dayOfLife(new Date(2026, 9, 27, 23, 30))).toBe(12227);
  });

  it('keeps May 6 in the old year of life and starts the new one on May 7', () => {
    process.env.TZ = zone;
    expect(dayOfLifeSnapshot(new Date(2026, 4, 6, 21))).toMatchObject({
      year: 33,
      dayOfYear: 365,
    });
    expect(dayOfLifeSnapshot(new Date(2026, 4, 7, 0, 30))).toMatchObject({
      year: 34,
      dayOfYear: 1,
    });
  });
});
