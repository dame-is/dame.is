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

  it('names the local day in both the label and its long form', () => {
    expect(dayHeaderLabels(evening, 'default', now)).toEqual({
      label: 'Yesterday, October 26, 2026',
      full: 'Yesterday, October 26, 2026',
    });
  });

  it("keeps the long local form behind the ledger's short label", () => {
    expect(dayHeaderLabels(evening, 'ledger', now)).toEqual({
      label: 'Yesterday',
      full: 'Yesterday, October 26, 2026',
    });
  });
});
