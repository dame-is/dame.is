import { afterEach, describe, expect, it } from 'vitest';
import { currentAvatarKey, dayOfLife, easternDate, easternHour, folio } from './time.js';

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('easternHour / easternDate', () => {
  it('reads the Eastern clock across daylight saving', () => {
    // 03:30 UTC is 11:30pm EDT the day before in summer, 10:30pm EST in winter.
    expect(easternHour(new Date('2026-07-04T03:30:00Z'))).toBe(23);
    expect(easternDate(new Date('2026-07-04T03:30:00Z'))).toBe('2026-07-03');
    expect(easternHour(new Date('2026-01-10T03:30:00Z'))).toBe(22);
    expect(easternDate(new Date('2026-01-10T03:30:00Z'))).toBe('2026-01-09');
  });

  it('calls midnight hour 0, never 24', () => {
    expect(easternHour(new Date('2026-07-04T04:15:00Z'))).toBe(0);
    expect(currentAvatarKey(new Date('2026-07-04T04:15:00Z'))).toBe('12am');
  });

  it('steps over the hour daylight saving skips, and repeats the one it adds', () => {
    // Mar 8 2026: 1 am EST, then 3 am EDT. Nov 1 2026: 1 am EDT, then 1 am EST.
    expect(easternHour(new Date('2026-03-08T06:30:00Z'))).toBe(1);
    expect(easternHour(new Date('2026-03-08T07:30:00Z'))).toBe(3);
    expect(easternHour(new Date('2026-11-01T05:30:00Z'))).toBe(1);
    expect(easternHour(new Date('2026-11-01T06:30:00Z'))).toBe(1);
    expect(easternHour(new Date('2026-11-01T07:30:00Z'))).toBe(2);
  });

  it('reads the same in the server’s zone as anywhere', () => {
    // The card renderer runs in UTC; a dev machine may not.
    for (const zone of ['America/Los_Angeles', 'Europe/London', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      expect(easternHour(new Date('2026-07-04T03:30:00Z'))).toBe(23);
      expect(easternDate(new Date('2026-07-04T03:30:00Z'))).toBe('2026-07-03');
    }
  });
});

describe('dayOfLife', () => {
  it('is 1 on the birthday', () => {
    expect(dayOfLife(new Date('1993-05-07T16:00:00Z'))).toBe(1);
    expect(dayOfLife('1993-05-07')).toBe(1);
  });

  it('turns over at midnight Eastern, not at midnight UTC', () => {
    const evening = new Date('2026-10-27T23:30:00-04:00'); // 03:30 UTC on the 28th
    const morning = new Date('2026-10-28T08:00:00-04:00');
    expect(dayOfLife(morning)).toBe(dayOfLife(evening) + 1);
    expect(dayOfLife(evening)).toBe(dayOfLife('2026-10-27'));
    expect(dayOfLife(evening)).toBe(12227);
  });

  it('takes a calendar date as the day it names', () => {
    // As an instant, UTC midnight would be the evening before in Eastern time.
    expect(dayOfLife('2026-10-28')).toBe(
      dayOfLife(new Date('2026-10-28T12:00:00-04:00')),
    );
    expect(dayOfLife('2026-10-28') - dayOfLife('2025-10-28')).toBe(365);
  });

  it('counts calendar days through a 23-hour day', () => {
    // 2026-03-08 is the spring-forward day in America/New_York.
    expect(
      dayOfLife('2026-03-09') -
        dayOfLife(new Date('2026-03-07T23:59:00-05:00')),
    ).toBe(2);
  });

  it('counts calendar days through a 25-hour day', () => {
    // 2026-11-01 is the fall-back day: 12:10 am to 11:50 pm is still one date.
    expect(dayOfLife(new Date('2026-11-01T23:50:00-05:00'))).toBe(
      dayOfLife(new Date('2026-11-01T00:10:00-04:00')),
    );
  });

  it('stamps the same folio whatever zone the renderer is in', () => {
    const late = new Date('2026-10-27T23:30:00-04:00');
    for (const zone of ['America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'UTC']) {
      process.env.TZ = zone;
      expect(folio(late)).toBe('12,227');
      expect(folio('2026-10-28')).toBe('12,228');
    }
  });

  it('prints with thousands separators', () => {
    expect(folio('2026-10-28')).toBe(
      dayOfLife('2026-10-28').toLocaleString('en-US'),
    );
    expect(folio('2026-10-28')).toMatch(/^\d{1,2},\d{3}$/);
  });
});
