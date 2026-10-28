import { afterEach, describe, it, expect } from 'vitest';
import {
  formatDateAbbrev,
  formatDateFull,
  formatDateLong,
  formatDateShort,
} from './time.js';

// A record page prints "… at 10:53 PM on October 16, 2026": a local time and
// a date beside it, which have to be on the same day. The date helpers used
// to read UTC parts, so anywhere west of Greenwich an evening post was dated
// tomorrow. Node re-reads TZ whenever it is assigned; it is put back after
// every test.
const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

// 10:53 PM on Oct 16 in New York, which is already Oct 17 in UTC.
const EVENING_ET = '2026-10-16T22:53:00-04:00';

describe('date helpers read an instant in the local calendar', () => {
  it('in New York, an evening post is dated that evening', () => {
    process.env.TZ = 'America/New_York';
    expect(formatDateFull(EVENING_ET)).toBe('October 16, 2026');
    expect(formatDateShort(EVENING_ET)).toBe('Oct 16, 2026');
    expect(formatDateAbbrev(EVENING_ET)).toBe('Oct 16, 2026');
    expect(formatDateLong(EVENING_ET)).toBe('16 October 2026');
  });

  it('in UTC and in Tokyo, the same moment is already the 17th', () => {
    for (const zone of ['UTC', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      expect(formatDateFull(EVENING_ET)).toBe('October 17, 2026');
    }
  });

  it('a bare YYYY-MM-DD names the same day in every zone', () => {
    for (const zone of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      expect(formatDateFull('2026-10-16')).toBe('October 16, 2026');
    }
  });

  it('so does a day stored as UTC midnight', () => {
    // How the back-filled portfolio works date a piece to its year.
    for (const zone of ['America/New_York', 'UTC', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      expect(formatDateFull('2019-01-01T00:00:00.000Z')).toBe(
        'January 1, 2019',
      );
      expect(formatDateShort(new Date(Date.UTC(2019, 0, 1)))).toBe(
        'Jan 1, 2019',
      );
    }
  });
});
