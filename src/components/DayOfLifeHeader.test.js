import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayHeaderLabels } from './DayOfLifeHeader.jsx';

// The header's date is the day's newest record. In an American evening that
// instant is already tomorrow in UTC, which is where the old tooltip and
// screen-reader label took their date from.
describe('dayHeaderLabels (viewer in New York)', () => {
  const realTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = realTz;
    if (realTz === undefined) delete process.env.TZ;
  });

  // 9:30pm on the 26th in New York.
  const evening = '2026-10-27T01:30:00Z';
  const now = new Date('2026-10-27T15:00:00Z');

  it('dates the local day in full, and keeps the name it goes by', () => {
    expect(dayHeaderLabels(evening, now)).toEqual({
      date: 'Monday, October 26',
      relative: 'Yesterday',
      short: 'Yesterday',
    });
    expect(dayHeaderLabels(now, now)).toEqual({
      date: 'Tuesday, October 27',
      relative: 'Today',
      short: 'Today',
    });
  });

  it('gives an older day no name, and a past year its year', () => {
    expect(dayHeaderLabels('2026-10-25T16:00:00Z', now)).toEqual({
      date: 'Sunday, October 25',
      relative: null,
      short: 'Oct 25',
    });
    expect(dayHeaderLabels('2025-03-02T16:00:00Z', now)).toEqual({
      date: 'Sunday, March 2, 2025',
      relative: null,
      short: 'Mar 2, 2025',
    });
  });
});
