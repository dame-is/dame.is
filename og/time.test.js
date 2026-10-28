import { describe, expect, it } from 'vitest';
import { dayOfLife, easternDate, easternHour, folio } from './time.js';

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

  it('prints with thousands separators', () => {
    expect(folio('2026-10-28')).toBe(
      dayOfLife('2026-10-28').toLocaleString('en-US'),
    );
    expect(folio('2026-10-28')).toMatch(/^\d{1,2},\d{3}$/);
  });
});
