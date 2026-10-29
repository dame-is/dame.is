import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  calendarDay,
  isYearOnlyDate,
  longDay,
  shortDay,
  trimLinkEcho,
  yearOf,
} from './ledger.js';

// Read in New York, as the ledger's tests elsewhere are. TZ has to be set
// before the first formatTime call: time.js builds its formatter once.
const realTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  if (realTz === undefined) delete process.env.TZ;
  else process.env.TZ = realTz;
});

const NOW = new Date('2026-10-27T17:00:00Z'); // 1 pm on Tuesday the 27th

describe('dates beside a row', () => {
  it('names the local calendar day and its weekday', () => {
    // 9:30 pm on the 26th in New York is already the 27th in UTC.
    expect(calendarDay('2026-10-27T01:30:00Z')).toEqual({
      y: 2026,
      m: 9,
      d: 26,
      weekday: 'Monday',
    });
    expect(calendarDay('not a date')).toBeNull();
  });

  it('prints a short day, with the year only when it differs', () => {
    expect(shortDay('2026-10-27T01:30:00Z', NOW)).toBe('Oct 26');
    expect(shortDay('2025-03-02T15:00:00Z', NOW)).toBe('Mar 2, 2025');
    expect(shortDay('nope', NOW)).toBe('');
  });

  it('prints a long day, and the day after an instant', () => {
    expect(longDay('2026-10-25T16:00:00Z', NOW)).toBe('Sunday, October 25');
    // A horizon at 1:31 pm on Saturday: the first whole day is Sunday.
    expect(longDay('2026-10-24T17:31:00Z', NOW, { next: true })).toBe('Sunday, October 25');
    // Across a month and a year.
    expect(longDay('2025-12-31T20:00:00Z', NOW, { next: true })).toBe('Thursday, January 1');
    expect(longDay('2024-06-01T16:00:00Z', NOW)).toBe('Saturday, June 1, 2024');
  });

  it('shortens the month for a day header', () => {
    expect(longDay('2026-10-25T16:00:00Z', NOW, { shortMonth: true })).toBe('Sunday, Oct 25');
    expect(longDay('2024-06-01T16:00:00Z', NOW, { shortMonth: true })).toBe('Saturday, Jun 1, 2024');
  });
});

describe('trimLinkEcho', () => {
  const card = 'https://dame.is/curating/random-shit-my-youtube-algorithm-recommends-me';

  it('drops the text of a link-only post', () => {
    expect(trimLinkEcho('dame.is/curating/ran...', card)).toBe('');
    expect(trimLinkEcho('dame.is/curating/ran… ', card)).toBe('');
    expect(trimLinkEcho('https://www.dame.is/curating/random-shit-my-youtube-algorithm-recommends-me', card)).toBe('');
  });

  it('drops only the trailing link when there are words before it', () => {
    expect(trimLinkEcho('Adding it to the collection… dame.is/curating/ran...', card)).toBe(
      'Adding it to the collection…',
    );
  });

  it('leaves text alone when the link is elsewhere or different', () => {
    expect(trimLinkEcho('look dame.is/curating/ran... at this', card)).toBe(
      'look dame.is/curating/ran... at this',
    );
    expect(trimLinkEcho('see example.com/foo...', card)).toBe('see example.com/foo...');
    // A bare host said in passing isn't the link to a page on it.
    expect(trimLinkEcho('made with love on dame.is', card)).toBe('made with love on dame.is');
    // …but a link to the bare host is.
    expect(trimLinkEcho('dame.is', 'https://dame.is/')).toBe('');
    expect(trimLinkEcho('', card)).toBe('');
    expect(trimLinkEcho('hello', null)).toBe('hello');
  });
});

describe('year-only dates', () => {
  it('spots midnight UTC on New Year’s Day, and only that', () => {
    expect(isYearOnlyDate('2011-01-01T00:00:00.000Z')).toBe(true);
    expect(isYearOnlyDate('2011-01-01T00:00:00Z')).toBe(true);
    expect(isYearOnlyDate('2011-06-01T00:00:00.000Z')).toBe(false);
    expect(isYearOnlyDate('2011-01-01T05:00:00.000Z')).toBe(false);
    expect(isYearOnlyDate('2011-01-01T00:00:00-05:00')).toBe(false);
    expect(isYearOnlyDate(null)).toBe(false);
  });

  it('gives the year it stands for', () => {
    expect(yearOf('2014-01-01T00:00:00.000Z')).toBe('2014');
    expect(yearOf('2014-03-01T12:00:00.000Z')).toBe('');
  });
});
