import { describe, expect, it } from 'vitest';
import { formatFilterCount, kindsSummary } from './filterCounts.js';

describe('formatFilterCount', () => {
  it('prints a loaded count as it is', () => {
    expect(formatFilterCount({ count: 123 })).toEqual({ text: '123', spoken: '123' });
    expect(formatFilterCount({ count: 0 })).toEqual({ text: '0', spoken: '0' });
  });

  it('marks a count that hit the first-fetch cap as having more', () => {
    expect(formatFilterCount({ count: 100, capped: true })).toEqual({ text: '100+', spoken: '100 or more' });
  });

  it('marks a snapshot estimate, which wins over the cap', () => {
    expect(formatFilterCount({ count: 85, estimate: true, capped: true }).text).toBe('~85');
  });

  it('prints a dash for a kind not loaded yet', () => {
    expect(formatFilterCount({ count: undefined })).toEqual({ text: '—', spoken: 'not loaded yet' });
    expect(formatFilterCount()).toEqual({ text: '—', spoken: 'not loaded yet' });
    expect(formatFilterCount({ count: NaN }).text).toBe('—');
  });

  it('separates thousands', () => {
    expect(formatFilterCount({ count: 1234 }).text).toBe('1,234');
  });
});

describe('kindsSummary', () => {
  it('counts the kinds shown, and says when they are the defaults', () => {
    expect(kindsSummary(14, 17)).toBe('14 of 17 kinds');
    expect(kindsSummary(14, 17, { defaults: true })).toBe('14 of 17 kinds · the defaults');
    expect(kindsSummary(2, 5, { noun: 'types' })).toBe('2 of 5 types');
  });
});
