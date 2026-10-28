import { describe, expect, it } from 'vitest';
import { kindsParamValue, resolveActiveKinds } from './CreatingFilters.jsx';

const KINDS = ['writing', 'software', 'design'];
const resolve = (value) =>
  resolveActiveKinds(new URLSearchParams({ kinds: value }), KINDS);

describe('kindsParamValue', () => {
  it('round-trips a chip selection', () => {
    expect(resolve(kindsParamValue(new Set(['writing', 'design'])))).toEqual(
      new Set(['writing', 'design']),
    );
  });

  it('writes switching off the last chip as "none", not "all"', () => {
    expect(resolve(kindsParamValue(new Set()))).toEqual(new Set());
  });

  it('leaves the empty-value "all" shortcut alone', () => {
    expect(resolve('')).toEqual(new Set(KINDS));
  });
});
