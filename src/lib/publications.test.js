import { describe, it, expect } from 'vitest';
import { workSlug, canonicalWorkPath } from './publications.js';

describe('workSlug', () => {
  it('strips the leading slash a standard document stores', () => {
    expect(workSlug({ path: '/proof-of-no-work' })).toBe('proof-of-no-work');
    expect(workSlug({ path: '///rainbow' })).toBe('rainbow');
  });

  it('reads the legacy field too', () => {
    expect(workSlug({ slug: 'red-blue-yellow' })).toBe('red-blue-yellow');
  });

  it('is empty when the record carries neither', () => {
    expect(workSlug({})).toBe('');
    expect(workSlug(null)).toBe('');
  });
});

describe('canonicalWorkPath', () => {
  // The bug this exists to fix: /creating/<rkey> and /creating/<path> both
  // resolve, by design — an at:// URI or a Bluesky link hands you the key and
  // nothing else. But the canonical tag used to echo whichever URL was asked
  // for, so the two never collapsed and a work was indexable twice.
  it('sends the record key to the human path', () => {
    expect(canonicalWorkPath({ path: '/proof-of-no-work' }, '3mqmsnffjpk2d', '3mqmsnffjpk2d')).toBe(
      '/creating/proof-of-no-work',
    );
  });

  it('leaves the human path alone', () => {
    expect(
      canonicalWorkPath({ path: '/proof-of-no-work' }, '3mqmsnffjpk2d', 'proof-of-no-work'),
    ).toBe('/creating/proof-of-no-work');
  });

  it('agrees with itself from either address', () => {
    const value = { path: '/ratioed' };
    expect(canonicalWorkPath(value, '3mrlnl6oyuj2d', '3mrlnl6oyuj2d')).toBe(
      canonicalWorkPath(value, '3mrlnl6oyuj2d', 'ratioed'),
    );
  });

  it('falls back to the record key when a doc has no path of its own', () => {
    // Blog-homed docs cross-posted onto /creating often have none.
    expect(canonicalWorkPath({}, '3mqrsdovjjf2d', '3mqrsdovjjf2d')).toBe(
      '/creating/3mqrsdovjjf2d',
    );
  });

  it('escapes a path that would otherwise change the URL shape', () => {
    expect(canonicalWorkPath({ path: '/a b' }, 'k', 'k')).toBe('/creating/a%20b');
  });

  it('returns null rather than a bare /creating/ when it has nothing', () => {
    expect(canonicalWorkPath({}, null, '')).toBeNull();
  });
});
