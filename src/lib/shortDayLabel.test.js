import { describe, expect, it } from 'vitest';
import { shortDayLabel } from './shortDayLabel.js';

const NOW = new Date(2026, 9, 28, 13, 0);

describe('shortDayLabel', () => {
  it('says today and yesterday in lower case', () => {
    expect(shortDayLabel('Today, October 28, 2026', NOW)).toBe('today');
    expect(shortDayLabel('Yesterday', NOW)).toBe('yesterday');
  });

  it('shortens a date this year to month and day', () => {
    expect(shortDayLabel('October 25, 2026', NOW)).toBe('Oct 25');
  });

  it('finds the date after a relative lead', () => {
    expect(shortDayLabel('1 week ago, October 21, 2026', NOW)).toBe('Oct 21');
  });

  it('keeps the year from another year', () => {
    expect(shortDayLabel('March 3, 2024', NOW)).toBe('Mar 3, 2024');
  });

  it('keeps anything else as written', () => {
    expect(shortDayLabel('Daytime & untimed', NOW)).toBe('Daytime & untimed');
    expect(shortDayLabel('', NOW)).toBe('');
  });
});
