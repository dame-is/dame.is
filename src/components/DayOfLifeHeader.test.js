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

  it('names the local day, with its date in full beside it', () => {
    expect(dayHeaderLabels(evening, now)).toEqual({
      name: 'Yesterday',
      date: 'Monday, October 26',
      short: 'Yesterday',
    });
    expect(dayHeaderLabels(now, now)).toMatchObject({
      name: 'Today',
      date: 'Tuesday, October 27',
    });
  });

  it('names an older day by its weekday, and a past year by its year', () => {
    expect(dayHeaderLabels('2026-10-25T16:00:00Z', now)).toEqual({
      name: 'Sunday',
      date: 'October 25',
      short: 'Oct 25',
    });
    expect(dayHeaderLabels('2025-03-02T16:00:00Z', now)).toEqual({
      name: 'Sunday',
      date: 'March 2, 2025',
      short: 'Mar 2, 2025',
    });
  });
});
