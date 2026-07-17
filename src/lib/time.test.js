import { describe, it, expect } from 'vitest';
import {
  relativeTime,
  groupByDay,
  relativeDay,
  formatDayLabel,
  formatDayShortLabel,
  formatDateLong,
  formatDateFull,
  formatWallClockTime,
  toIso,
  compareIsoDesc,
} from './time.js';

describe('relativeTime', () => {
  // Fixed anchor; `date` is derived by subtracting an exact delta from it, so
  // the buckets are deterministic regardless of the runner's timezone.
  const now = new Date('2020-06-15T12:00:00Z');
  const ago = (ms) => new Date(now.getTime() - ms);

  it('returns empty string for missing or unparseable input', () => {
    expect(relativeTime(null, now)).toBe('');
    expect(relativeTime('', now)).toBe('');
    expect(relativeTime('not a date', now)).toBe('');
  });

  it('says "just now" under a minute', () => {
    expect(relativeTime(ago(30 * 1000), now)).toBe('just now');
    expect(relativeTime(ago(59 * 1000), now)).toBe('just now');
  });

  it('floors to minutes, then hours, then days', () => {
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(relativeTime(ago(59 * 60_000), now)).toBe('59m ago');
    expect(relativeTime(ago(60 * 60_000), now)).toBe('1h ago');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2d ago');
  });

  it('rolls up to weeks, months and years', () => {
    expect(relativeTime(ago(14 * 86_400_000), now)).toBe('2w ago');
    expect(relativeTime(ago(2 * 2_629_800_000), now)).toBe('2mo ago');
    expect(relativeTime(ago(2 * 31_557_600_000), now)).toBe('2y ago');
  });
});

describe('groupByDay', () => {
  it('buckets by local calendar date and orders groups newest-first', () => {
    const items = [
      { id: 'a', createdAt: new Date(2020, 0, 2, 10, 0) },
      { id: 'b', createdAt: new Date(2020, 0, 2, 23, 0) },
      { id: 'c', createdAt: new Date(2020, 0, 1, 12, 0) },
    ];
    const groups = groupByDay(items);
    expect(groups.map((g) => g.dateKey)).toEqual(['2020-01-02', '2020-01-01']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['c']);
  });

  it('skips items with a missing or invalid date', () => {
    const items = [
      { id: 'a', createdAt: new Date(2020, 0, 2, 10, 0) },
      { id: 'skip-null', createdAt: null },
      { id: 'skip-bad', createdAt: 'garbage' },
    ];
    const groups = groupByDay(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a']);
  });

  it('honors a custom date picker', () => {
    const items = [{ when: new Date(2020, 4, 9, 8, 0) }];
    const groups = groupByDay(items, (i) => i.when);
    expect(groups).toHaveLength(1);
    expect(groups[0].dateKey).toBe('2020-05-09');
  });
});

describe('relativeDay', () => {
  const now = new Date(2020, 5, 15); // June 15, 2020, local
  const daysBefore = (n) => new Date(2020, 5, 15 - n);

  it('handles today / yesterday', () => {
    expect(relativeDay(now, now)).toBe('today');
    expect(relativeDay(daysBefore(1), now)).toBe('yesterday');
  });

  it('treats future dates as today (never negative)', () => {
    expect(relativeDay(new Date(2020, 5, 20), now)).toBe('today');
  });

  it('uses plain days below a week', () => {
    expect(relativeDay(daysBefore(3), now)).toBe('3 days ago');
    expect(relativeDay(daysBefore(6), now)).toBe('6 days ago');
  });

  it('rolls into weeks, months and years', () => {
    expect(relativeDay(daysBefore(7), now)).toBe('1 week ago');
    expect(relativeDay(daysBefore(14), now)).toBe('2 weeks ago');
    expect(relativeDay(daysBefore(60), now)).toBe('2 months ago');
    expect(relativeDay(daysBefore(400), now)).toBe('1 year ago');
    expect(relativeDay(daysBefore(800), now)).toBe('2 years ago');
  });

  it('returns empty string for an invalid date', () => {
    expect(relativeDay('nope', now)).toBe('');
  });
});

describe('formatDayLabel / formatDayShortLabel', () => {
  const now = new Date(2020, 6, 6); // July 6, 2020

  it('combines capitalized relative phrasing with the local calendar date', () => {
    expect(formatDayLabel(now, now)).toBe('Today, July 6, 2020');
    expect(formatDayLabel(new Date(2020, 6, 5), now)).toBe(
      'Yesterday, July 5, 2020',
    );
    expect(formatDayLabel(new Date(2020, 6, 1), now)).toBe(
      '5 days ago, July 1, 2020',
    );
  });

  it('short label uses Today/Yesterday then a bare date', () => {
    expect(formatDayShortLabel(now, now)).toBe('Today');
    expect(formatDayShortLabel(new Date(2020, 6, 5), now)).toBe('Yesterday');
    expect(formatDayShortLabel(new Date(2020, 6, 1), now)).toBe('July 1, 2020');
  });

  it('both return empty string for an invalid date', () => {
    expect(formatDayLabel('bad', now)).toBe('');
    expect(formatDayShortLabel('bad', now)).toBe('');
  });
});

describe('formatDateLong / formatDateFull (UTC-based)', () => {
  it('formatDateLong reads UTC parts as "D Month YYYY"', () => {
    expect(formatDateLong('2025-03-07T12:00:00Z')).toBe('7 March 2025');
    expect(formatDateLong('bad')).toBe('');
  });

  it('formatDateFull reads UTC parts as "Month D, YYYY"', () => {
    expect(formatDateFull('2025-03-07T12:00:00Z')).toBe('March 7, 2025');
    expect(formatDateFull('bad')).toBe('');
  });
});

describe('formatWallClockTime', () => {
  it('renders a bare HH:MM (24h) as lowercase 12-hour time', () => {
    expect(formatWallClockTime('14:59')).toBe('2:59 pm');
    expect(formatWallClockTime('00:30')).toBe('12:30 am');
    expect(formatWallClockTime('12:00')).toBe('12:00 pm');
    expect(formatWallClockTime('09:05')).toBe('9:05 am');
    expect(formatWallClockTime('23:15')).toBe('11:15 pm');
  });

  it('returns empty string for anything that is not HH:MM', () => {
    expect(formatWallClockTime('9:05')).toBe('');
    expect(formatWallClockTime('')).toBe('');
    expect(formatWallClockTime(null)).toBe('');
    expect(formatWallClockTime('2:59 pm')).toBe('');
  });
});

describe('toIso', () => {
  it('returns null for falsy or unparseable input', () => {
    expect(toIso(null)).toBeNull();
    expect(toIso('')).toBeNull();
    expect(toIso('garbage')).toBeNull();
  });

  it('normalizes a valid timestamp to a full ISO string', () => {
    expect(toIso('2020-01-01T00:00:00Z')).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('compareIsoDesc', () => {
  it('orders newest-first', () => {
    const sorted = [
      '2020-01-01T00:00:00Z',
      '2021-01-01T00:00:00Z',
      '2019-01-01T00:00:00Z',
    ].sort(compareIsoDesc);
    expect(sorted).toEqual([
      '2021-01-01T00:00:00Z',
      '2020-01-01T00:00:00Z',
      '2019-01-01T00:00:00Z',
    ]);
  });

  it('parses offsets rather than comparing strings', () => {
    // 2020-01-01T00:00:00-04:00 == 04:00Z, which is LATER than 02:00Z, even
    // though it sorts earlier lexically. Parsed comparison must put it first.
    expect(
      compareIsoDesc('2020-01-01T00:00:00-04:00', '2020-01-01T02:00:00Z'),
    ).toBeLessThan(0);
  });

  it('treats identical instants (differently spelled) as equal', () => {
    expect(
      compareIsoDesc('2020-01-01T00:00:00Z', '2020-01-01T00:00:00.000Z'),
    ).toBe(0);
  });

  it('sinks missing/unparseable timestamps to the bottom, stably', () => {
    expect(compareIsoDesc(null, '2020-01-01T00:00:00Z')).toBe(1);
    expect(compareIsoDesc('2020-01-01T00:00:00Z', null)).toBe(-1);
    expect(compareIsoDesc(null, undefined)).toBe(0);
    expect(compareIsoDesc('garbage', 'also-garbage')).toBe(0);

    const sorted = [
      '2020-01-01T00:00:00Z',
      'bad',
      '2021-01-01T00:00:00Z',
    ].sort(compareIsoDesc);
    expect(sorted).toEqual([
      '2021-01-01T00:00:00Z',
      '2020-01-01T00:00:00Z',
      'bad',
    ]);
  });
});
