import { describe, it, expect } from 'vitest';
import {
  relativeTime,
  groupByDay,
  relativeDay,
  relativeDayShort,
  recentDay,
  formatDayLabel,
  formatDayShortLabel,
  formatDateLong,
  formatDateAbbrev,
  formatDateFull,
  formatDateShort,
  formatDateWeekday,
  formatMonthDay,
  formatStamp,
  formatTime,
  formatWallClockTime,
  formatWeekday,
  formatYear,
  calendarDay,
  dateKey,
  easternDate,
  easternHour,
  easternInstant,
  isDayOnly,
  toIso,
  compareIsoDesc,
} from './time.js';

// Everything here is read on Dame's clock, America/New_York, so the instants
// are written with their New York offsets (-04:00 in summer, -05:00 in
// winter) and the expectations hold in whatever zone the runner sits in.
// time.tz.test.js runs the same facts from Los Angeles, London and Tokyo.

/** Noon in New York, `n` days before June 15, 2020. */
const noonBefore = (n) => new Date(Date.UTC(2020, 5, 15 - n, 16));

describe('relativeTime', () => {
  const now = new Date('2020-06-15T12:00:00-04:00');
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

  it('counts minutes and hours as elapsed time', () => {
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(relativeTime(ago(59 * 60_000), now)).toBe('59m ago');
    expect(relativeTime(ago(60 * 60_000), now)).toBe('1h ago');
    expect(relativeTime(ago(19 * 3_600_000), now)).toBe('19h ago');
  });

  it('counts days as calendar days on Dame’s clock', () => {
    expect(relativeTime(noonBefore(2), now)).toBe('2d ago');
    // 11 pm two nights ago is 26 hours back at 1 am: two dates ago, not one.
    const oneAm = new Date('2020-06-15T01:00:00-04:00');
    expect(relativeTime('2020-06-13T23:00:00-04:00', oneAm)).toBe('2d ago');
    // 23 hours back but yesterday: still hours.
    expect(relativeTime('2020-06-14T13:00:00-04:00', now)).toBe('23h ago');
  });

  it('rolls days into weeks under 30 days', () => {
    expect(relativeTime(noonBefore(7), now)).toBe('1w ago');
    expect(relativeTime(noonBefore(14), now)).toBe('2w ago');
    expect(relativeTime(noonBefore(29), now)).toBe('4w ago');
  });

  it('gives the short date from 30 days on', () => {
    expect(relativeTime(noonBefore(30), now)).toBe('May 16, 2020');
    expect(relativeTime(noonBefore(636), now)).toBe(formatDateShort(noonBefore(636)));
    expect(relativeTime('2018-06-15T12:00:00-04:00', now)).toBe('Jun 15, 2018');
  });

  it('says hours, not "1d ago", through the 25-hour day', () => {
    // Nov 1 2026 falls back: 00:10 EDT to 23:50 EST is 24h40m, one date.
    const late = new Date('2026-11-01T23:50:00-05:00');
    expect(relativeTime('2026-11-01T00:10:00-04:00', late)).toBe('24h ago');
    expect(relativeDay('2026-11-01T00:10:00-04:00', late)).toBe('today');
  });
});

describe('relativeDay', () => {
  const now = new Date('2020-06-15T12:00:00-04:00');

  it('handles today / yesterday', () => {
    expect(relativeDay(now, now)).toBe('today');
    expect(relativeDay(noonBefore(1), now)).toBe('yesterday');
  });

  it('turns over at midnight in New York', () => {
    const justAfter = new Date('2026-10-28T00:01:00-04:00');
    expect(relativeDay('2026-10-27T23:59:00-04:00', justAfter)).toBe('yesterday');
    expect(relativeDay('2026-10-28T00:00:00-04:00', justAfter)).toBe('today');
    // 03:59Z is still the 27th in New York, though it's the 28th in UTC.
    expect(relativeDay('2026-10-28T03:59:00Z', justAfter)).toBe('yesterday');
  });

  it('treats future dates as today (never negative)', () => {
    expect(relativeDay('2020-06-20T12:00:00-04:00', now)).toBe('today');
  });

  it('uses plain days below a week', () => {
    expect(relativeDay(noonBefore(3), now)).toBe('3 days ago');
    expect(relativeDay(noonBefore(6), now)).toBe('6 days ago');
  });

  it('rolls into weeks, months and years', () => {
    expect(relativeDay(noonBefore(7), now)).toBe('1 week ago');
    expect(relativeDay(noonBefore(14), now)).toBe('2 weeks ago');
    expect(relativeDay(noonBefore(61), now)).toBe('2 months ago');
    expect(relativeDay(noonBefore(400), now)).toBe('1 year ago');
    expect(relativeDay(noonBefore(800), now)).toBe('2 years ago');
  });

  it('counts completed units, never rounding up', () => {
    // 636 days is 1.74 years: one year has passed, not two.
    expect(relativeDay(noonBefore(636), now)).toBe('1 year ago');
    expect(relativeDay(noonBefore(60), now)).toBe('1 month ago');
    expect(relativeDay(noonBefore(13), now)).toBe('1 week ago');
    expect(relativeDay(noonBefore(30), now)).toBe('4 weeks ago');
    expect(relativeDay(noonBefore(364), now)).toBe('11 months ago');
  });

  it('puts a date in the same bucket, with the same count, as relativeTime', () => {
    // The two sit side by side on a document page (the meta band's "Elapsed"
    // and the footer's "written …"), so they must not disagree about a date.
    const unit = { d: 'day', w: 'week' };
    for (const n of [2, 3, 6, 7, 13, 14, 20, 29]) {
      const terse = relativeTime(noonBefore(n), now).match(/^(\d+)(d|w) ago$/);
      const [count, word] = relativeDay(noonBefore(n), now).split(' ');
      expect([count, word.replace(/s$/, '')]).toEqual([terse[1], unit[terse[2]]]);
    }
  });

  it('leaves relativeTime nothing to round past 30 days: it prints the date', () => {
    for (const n of [30, 61, 400, 636, 800]) {
      expect(relativeTime(noonBefore(n), now)).toBe(formatDateShort(noonBefore(n)));
    }
  });

  it('returns empty string for an invalid date', () => {
    expect(relativeDay('nope', now)).toBe('');
  });
});

describe('recentDay', () => {
  const now = new Date('2020-06-15T12:00:00-04:00');

  it('says today, yesterday, then days for the rest of the week', () => {
    expect(recentDay(now, now)).toBe('today');
    expect(recentDay(noonBefore(1), now)).toBe('yesterday');
    expect(recentDay(noonBefore(2), now)).toBe('2d ago');
    expect(recentDay(noonBefore(6), now)).toBe('6d ago');
  });

  it('says nothing from a week on', () => {
    expect(recentDay(noonBefore(7), now)).toBe('');
    expect(recentDay(noonBefore(400), now)).toBe('');
  });

  it('counts calendar days in New York', () => {
    const justAfter = new Date('2026-10-28T00:01:00-04:00');
    expect(recentDay('2026-10-27T23:59:00-04:00', justAfter)).toBe('yesterday');
    expect(recentDay('2026-10-28T03:59:00Z', justAfter)).toBe('yesterday');
  });

  it('treats a future date as today, and no date as nothing', () => {
    expect(recentDay('2020-06-20T12:00:00-04:00', now)).toBe('today');
    expect(recentDay(null, now)).toBe('');
    expect(recentDay('not a date', now)).toBe('');
  });
});

describe('relativeDayShort', () => {
  const now = new Date('2020-06-15T12:00:00-04:00');

  it('leaves today and yesterday spelled out', () => {
    expect(relativeDayShort(now, now)).toBe('today');
    expect(relativeDayShort(noonBefore(1), now)).toBe('yesterday');
  });

  it('abbreviates the unit and drops "ago"', () => {
    expect(relativeDayShort(noonBefore(3), now)).toBe('3 days');
    expect(relativeDayShort(noonBefore(7), now)).toBe('1 wk');
    expect(relativeDayShort(noonBefore(14), now)).toBe('2 wks');
    expect(relativeDayShort(noonBefore(61), now)).toBe('2 mo');
    expect(relativeDayShort(noonBefore(400), now)).toBe('1 yr');
    expect(relativeDayShort(noonBefore(800), now)).toBe('2 yrs');
  });

  it('agrees with relativeDay about which bucket a date is in', () => {
    for (const n of [0, 1, 3, 6, 7, 29, 30, 200, 400, 636, 800]) {
      const long = relativeDay(noonBefore(n), now);
      const short = relativeDayShort(noonBefore(n), now);
      expect(short.split(' ')[0]).toBe(long.split(' ')[0]);
    }
  });

  it('returns empty string for an invalid date', () => {
    expect(relativeDayShort('nope', now)).toBe('');
  });
});

describe('groupByDay', () => {
  it('buckets by the New York calendar date and orders groups newest-first', () => {
    const items = [
      { id: 'a', createdAt: '2020-01-02T10:00:00-05:00' },
      // 11 pm in New York is 04:00 UTC the next day: it stays on the 2nd.
      { id: 'b', createdAt: '2020-01-02T23:00:00-05:00' },
      { id: 'c', createdAt: '2020-01-01T12:00:00-05:00' },
    ];
    const groups = groupByDay(items);
    expect(groups.map((g) => g.dateKey)).toEqual(['2020-01-02', '2020-01-01']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['c']);
  });

  it('splits at midnight in New York, not at midnight UTC', () => {
    const groups = groupByDay([
      { id: 'after', createdAt: '2026-10-28T04:30:00Z' }, // 12:30 am EDT, Oct 28
      { id: 'before', createdAt: '2026-10-28T03:30:00Z' }, // 11:30 pm EDT, Oct 27
    ]);
    expect(groups.map((g) => [g.dateKey, g.items[0].id])).toEqual([
      ['2026-10-28', 'after'],
      ['2026-10-27', 'before'],
    ]);
  });

  it('keeps each group’s date as picked, so its label names the same day', () => {
    // A day stored as UTC midnight is only recognisable as a string.
    const [group] = groupByDay([{ createdAt: '2019-01-01T00:00:00.000Z' }]);
    expect(group.dateKey).toBe('2019-01-01');
    expect(group.date).toBe('2019-01-01T00:00:00.000Z');
    expect(formatDateFull(group.date)).toBe('January 1, 2019');
  });

  it('skips items with a missing or invalid date', () => {
    const items = [
      { id: 'a', createdAt: '2020-01-02T10:00:00-05:00' },
      { id: 'skip-null', createdAt: null },
      { id: 'skip-bad', createdAt: 'garbage' },
    ];
    const groups = groupByDay(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a']);
  });

  it('honors a custom date picker', () => {
    const items = [{ when: new Date('2020-05-09T08:00:00-04:00') }];
    const groups = groupByDay(items, (i) => i.when);
    expect(groups).toHaveLength(1);
    expect(groups[0].dateKey).toBe('2020-05-09');
  });
});

describe('formatDayLabel / formatDayShortLabel', () => {
  const now = new Date('2020-07-06T12:00:00-04:00');

  it('combines capitalized relative phrasing with the date under 30 days', () => {
    expect(formatDayLabel(now, now)).toBe('Today, July 6, 2020');
    expect(formatDayLabel('2020-07-05T21:00:00-04:00', now)).toBe('Yesterday, July 5, 2020');
    expect(formatDayLabel('2020-07-01T09:00:00-04:00', now)).toBe('5 days ago, July 1, 2020');
    expect(formatDayLabel('2020-06-15T09:00:00-04:00', now)).toBe('3 weeks ago, June 15, 2020');
  });

  it('is just the date from 30 days on', () => {
    expect(formatDayLabel('2020-06-06T09:00:00-04:00', now)).toBe('June 6, 2020');
    expect(formatDayLabel('2019-05-12T09:00:00-04:00', now)).toBe('May 12, 2019');
  });

  it('short label uses Today/Yesterday then a bare date', () => {
    expect(formatDayShortLabel(now, now)).toBe('Today');
    expect(formatDayShortLabel('2020-07-05T21:00:00-04:00', now)).toBe('Yesterday');
    expect(formatDayShortLabel('2020-07-01T09:00:00-04:00', now)).toBe('July 1, 2020');
  });

  it('both return empty string for an invalid date', () => {
    expect(formatDayLabel('bad', now)).toBe('');
    expect(formatDayShortLabel('bad', now)).toBe('');
  });
});

describe('the dates', () => {
  const evening = '2026-09-15T23:00:00-04:00'; // 03:00 UTC on the 16th

  it('formatDateFull is "Month D, YYYY" on Dame’s calendar', () => {
    expect(formatDateFull('2025-03-07T12:00:00-05:00')).toBe('March 7, 2025');
    expect(formatDateFull(evening)).toBe('September 15, 2026');
    expect(formatDateFull('bad')).toBe('');
  });

  it('formatDateShort cuts every month to three letters and keeps the day', () => {
    expect(formatDateShort('2025-03-07T12:00:00-05:00')).toBe('Mar 7, 2025');
    expect(formatDateShort('2025-06-27T12:00:00-04:00')).toBe('Jun 27, 2025');
    expect(formatDateShort(evening)).toBe('Sep 15, 2026');
    expect(formatDateShort('bad')).toBe('');
  });

  it('formatMonthDay, formatWeekday, formatDateWeekday and formatYear name the same day', () => {
    expect(formatMonthDay(evening)).toBe('Sep 15');
    expect(formatWeekday(evening)).toBe('Tuesday');
    expect(formatDateWeekday(evening)).toBe('Tuesday, September 15, 2026');
    expect(formatYear('2026-12-31T23:30:00-05:00')).toBe('2026');
  });

  it('the old names give the house style', () => {
    // formatDateLong was "15 September 2026"; formatDateAbbrev "Sept 15, 2026".
    expect(formatDateLong(evening)).toBe('September 15, 2026');
    expect(formatDateAbbrev(evening)).toBe('Sep 15, 2026');
  });

  it('reads a bare YYYY-MM-DD as the day it names', () => {
    expect(formatDateFull('2026-10-16')).toBe('October 16, 2026');
    expect(formatWeekday('2026-10-16')).toBe('Friday');
    // Not a day the calendar has.
    expect(formatDateFull('2026-02-30')).toBe('');
    expect(formatDateFull('2026-13-01')).toBe('');
  });

  it('reads a UTC-midnight Z stamp as a stored day, and an offset one as a time', () => {
    // How the back-filled portfolio works date a piece to its year.
    expect(formatDateFull('2019-01-01T00:00:00.000Z')).toBe('January 1, 2019');
    expect(formatYear('2019-01-01T00:00:00Z')).toBe('2019');
    expect(isDayOnly('2019-01-01T00:00:00.000Z')).toBe(true);
    // 8 pm in New York lands on UTC midnight; it's a real evening.
    expect(formatDateFull('2026-10-26T20:00:00-04:00')).toBe('October 26, 2026');
    expect(isDayOnly('2026-10-26T20:00:00-04:00')).toBe(false);
    // A Date is always a moment.
    expect(formatDateFull(new Date(Date.UTC(2019, 0, 1)))).toBe('December 31, 2018');
  });

  it('formatStamp gives the moment in full, and a stored day without a clock', () => {
    expect(formatStamp('2026-10-26T21:36:37.000Z')).toBe('Monday, October 26, 2026 · 5:36 pm');
    expect(formatStamp('2019-01-01T00:00:00.000Z')).toBe('Tuesday, January 1, 2019');
    expect(formatStamp('nope')).toBe('');
  });
});

describe('calendarDay / dateKey', () => {
  it('reads an instant on the New York calendar', () => {
    expect(calendarDay('2026-10-28T03:30:00Z')).toEqual({ y: 2026, m: 9, d: 27 });
    expect(dateKey('2026-10-28T03:30:00Z')).toBe('2026-10-27');
    expect(dateKey('2026-10-28T04:00:00Z')).toBe('2026-10-28');
  });

  it('is null / empty for a bad date', () => {
    expect(calendarDay('nope')).toBe(null);
    expect(calendarDay(null)).toBe(null);
    expect(dateKey(undefined)).toBe('');
  });
});

describe('formatTime', () => {
  it('prints the New York clock, lowercase, with a space', () => {
    expect(formatTime('2026-10-16T22:53:00-04:00')).toBe('10:53 pm');
    expect(formatTime('2026-10-17T02:53:00Z')).toBe('10:53 pm');
    expect(formatTime(new Date('2026-01-10T03:30:00Z'))).toBe('10:30 pm');
    expect(formatTime('2026-07-04T04:05:00Z')).toBe('12:05 am');
    expect(formatTime('2026-07-04T16:00:00Z')).toBe('12:00 pm');
  });

  it('follows New York across daylight saving', () => {
    // Spring forward, Mar 8 2026: 1:59 am EST, then 3:00 am EDT.
    expect(formatTime('2026-03-08T06:59:00Z')).toBe('1:59 am');
    expect(formatTime('2026-03-08T07:00:00Z')).toBe('3:00 am');
    // Fall back, Nov 1 2026: 1:30 am comes round twice.
    expect(formatTime('2026-11-01T05:30:00Z')).toBe('1:30 am');
    expect(formatTime('2026-11-01T06:30:00Z')).toBe('1:30 am');
    expect(formatTime('2026-11-01T07:30:00Z')).toBe('2:30 am');
  });

  it('returns empty string for an invalid date', () => {
    expect(formatTime('nope')).toBe('');
    expect(formatTime(null)).toBe('');
  });
});

describe('easternHour / easternDate / easternInstant', () => {
  it('reads the hour and date across daylight saving', () => {
    expect(easternHour(new Date('2026-07-04T03:30:00Z'))).toBe(23);
    expect(easternDate(new Date('2026-07-04T03:30:00Z'))).toBe('2026-07-03');
    expect(easternHour(new Date('2026-01-10T03:30:00Z'))).toBe(22);
    expect(easternDate(new Date('2026-01-10T03:30:00Z'))).toBe('2026-01-09');
  });

  it('turns a New York wall clock into its instant', () => {
    expect(easternInstant(2026, 9, 16, 22, 39).toISOString()).toBe('2026-10-17T02:39:00.000Z');
    expect(easternInstant(2026, 0, 10, 22, 30).toISOString()).toBe('2026-01-11T03:30:00.000Z');
    expect(formatTime(easternInstant(2026, 9, 16, 22, 39))).toBe('10:39 pm');
  });

  it('reads a skipped time past the gap and a repeated one as the first', () => {
    // 2:30 am on Mar 8 2026 never happened; it's read as 3:30 am EDT.
    expect(easternInstant(2026, 2, 8, 2, 30).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    // 1:30 am on Nov 1 2026 happened twice; the EDT one comes first.
    expect(easternInstant(2026, 10, 1, 1, 30).toISOString()).toBe('2026-11-01T05:30:00.000Z');
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

  it('agrees with formatTime on the instant the feed rebuilds from it', () => {
    expect(formatTime(easternInstant(2026, 9, 16, 22, 39))).toBe(formatWallClockTime('22:39'));
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
