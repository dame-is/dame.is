import { afterEach, describe, it, expect } from 'vitest';
import {
  dateKey,
  formatDateFull,
  formatDateShort,
  formatDayLabel,
  formatDayShortLabel,
  formatTime,
  groupByDay,
  readerTime,
  relativeDay,
  relativeTime,
} from './time.js';

// The same records read from the zones the site's readers are in. Everything
// printed is on Dame's clock, so every zone has to print the same thing; only
// readerTime, the tooltip's second line, is the reader's own. Node re-reads TZ
// whenever it is assigned, and it is put back after every test.
//
// The bugs these guard against only showed away from New York and UTC: a
// reader in Los Angeles saw an evening status under the right day while a
// reader in London saw it under tomorrow, with "4:53 AM" beside it.
const ZONES = ['America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'America/New_York', 'UTC'];
const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

// 10:53 pm on Friday Oct 16 in New York: 7:53 pm in Los Angeles, 3:53 am on
// the 17th in London, 11:53 am on the 17th in Tokyo.
const EVENING_ET = '2026-10-16T22:53:00-04:00';
// 12:30 am on the 17th in New York: still the 16th in Los Angeles.
const JUST_PAST_MIDNIGHT_ET = '2026-10-17T00:30:00-04:00';

describe.each(ZONES)('a reader in %s', (zone) => {
  it('sees the evening on its New York day, at its New York time', () => {
    process.env.TZ = zone;
    expect(formatTime(EVENING_ET)).toBe('10:53 pm');
    expect(formatDateFull(EVENING_ET)).toBe('October 16, 2026');
    expect(formatDateShort(EVENING_ET)).toBe('Oct 16, 2026');
    expect(dateKey(EVENING_ET)).toBe('2026-10-16');
  });

  it('sees the day turn over at midnight in New York', () => {
    process.env.TZ = zone;
    const groups = groupByDay([
      { id: 'after', createdAt: JUST_PAST_MIDNIGHT_ET },
      { id: 'before', createdAt: EVENING_ET },
    ]);
    expect(groups.map((g) => g.dateKey)).toEqual(['2026-10-17', '2026-10-16']);
    const now = new Date('2026-10-17T09:00:00-04:00');
    expect(formatDayShortLabel(groups[0].date, now)).toBe('Today');
    expect(formatDayShortLabel(groups[1].date, now)).toBe('Yesterday');
    expect(formatDayLabel(groups[1].date, now)).toBe('Yesterday, October 16, 2026');
  });

  it('gets the same relative times', () => {
    process.env.TZ = zone;
    const now = new Date('2026-10-18T08:00:00-04:00');
    expect(relativeTime(EVENING_ET, now)).toBe('2d ago');
    expect(relativeDay(EVENING_ET, now)).toBe('2 days ago');
    expect(relativeDay(JUST_PAST_MIDNIGHT_ET, now)).toBe('yesterday');
  });

  it('reads a bare day and a stored UTC-midnight day as written', () => {
    process.env.TZ = zone;
    expect(formatDateFull('2026-10-16')).toBe('October 16, 2026');
    expect(formatDateFull('2019-01-01T00:00:00.000Z')).toBe('January 1, 2019');
  });
});

describe('readerTime: the reader’s own clock, for the tooltip', () => {
  it('is empty where the clock reads the same as New York', () => {
    process.env.TZ = 'America/New_York';
    expect(readerTime(EVENING_ET)).toBe('');
    // Toronto keeps the same time.
    process.env.TZ = 'America/Toronto';
    expect(readerTime(EVENING_ET)).toBe('');
  });

  it('gives the time, and the weekday when it’s another day there', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(readerTime(EVENING_ET)).toBe('7:53 pm');
    process.env.TZ = 'Europe/London';
    expect(readerTime(EVENING_ET)).toBe('3:53 am Saturday');
    process.env.TZ = 'Asia/Tokyo';
    expect(readerTime(EVENING_ET)).toBe('11:53 am Saturday');
  });

  it('notices the week London and New York are an hour closer', () => {
    // London falls back on Oct 25 2026, New York on Nov 1: four hours apart
    // for that week instead of five.
    process.env.TZ = 'Europe/London';
    expect(readerTime('2026-10-27T12:00:00-04:00')).toBe('4:00 pm');
    expect(readerTime('2026-11-03T12:00:00-05:00')).toBe('5:00 pm');
  });
});
