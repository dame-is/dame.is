import { describe, expect, it } from 'vitest';
import { resolveActiveVerbs, verbsParamValue } from './FeedFilters.jsx';

const resolve = (value) =>
  resolveActiveVerbs(new URLSearchParams({ verbs: value }));

describe('verbsParamValue', () => {
  it('round-trips a chip selection', () => {
    expect(resolve(verbsParamValue(new Set(['posting', 'logging'])))).toEqual(
      new Set(['posting', 'logging']),
    );
  });

  it('writes switching off the last chip as "none", not "all"', () => {
    expect(resolve(verbsParamValue(new Set()))).toEqual(new Set());
  });

  it('leaves the empty-value "all" shortcut alone', () => {
    expect(resolve('').size).toBeGreaterThan(10);
  });
});
