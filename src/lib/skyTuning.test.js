import { describe, it, expect } from 'vitest';
import { skyMarkVisible, recordToDraft, effectiveSkyTuning } from './skyTuning.js';

describe('skyMarkVisible', () => {
  it('shows the mark when there is no record at all', () => {
    expect(skyMarkVisible(null)).toBe(true);
    expect(skyMarkVisible(undefined)).toBe(true);
  });

  it('shows the mark for a record written before the field existed', () => {
    expect(skyMarkVisible({ value: { enabled: true, hours: [] } })).toBe(true);
  });

  it('hides the mark only on an explicit false', () => {
    expect(skyMarkVisible({ value: { enabled: true, showMark: false } })).toBe(false);
    expect(skyMarkVisible({ value: { enabled: true, showMark: true } })).toBe(true);
  });

  it('is independent of `enabled` — a dormant palette can still hide the mark', () => {
    const record = { value: { enabled: false, showMark: false, hours: [] } };
    expect(effectiveSkyTuning(record)).toBe(null);
    expect(skyMarkVisible(record)).toBe(false);
  });

  it('reads a bare record value as well as a wrapped one', () => {
    expect(skyMarkVisible({ enabled: true, showMark: false })).toBe(false);
    expect(skyMarkVisible({ data: { value: { enabled: true, showMark: false } } })).toBe(false);
  });
});

describe('recordToDraft', () => {
  it('carries showMark into the studio draft, defaulting to on', () => {
    expect(recordToDraft(null).showMark).toBe(true);
    expect(recordToDraft({ value: { enabled: true } }).showMark).toBe(true);
    expect(recordToDraft({ value: { enabled: true, showMark: false } }).showMark).toBe(false);
  });
});
