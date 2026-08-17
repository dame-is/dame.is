import { describe, it, expect } from 'vitest';
import { DEFAULT_COPY, COPY_FIELDS, mergeCopy, fillCopy } from './ratioedCopy.js';

describe('mergeCopy', () => {
  it('is the built-in wording when nothing has been written', () => {
    expect(mergeCopy(null)).toEqual(DEFAULT_COPY);
    expect(mergeCopy({})).toEqual(DEFAULT_COPY);
  });

  it('takes a field that has been written and leaves the rest', () => {
    const out = mergeCopy({ replay: 'Press play.' });
    expect(out.replay).toBe('Press play.');
    expect(out.roster).toBe(DEFAULT_COPY.roster);
  });

  it('treats an empty or blank field as unwritten', () => {
    // Clearing a field in the studio restores the site's sentence rather than
    // publishing a blank caption — which is why the record stores absence
    // rather than a copy of the default.
    expect(mergeCopy({ replay: '' }).replay).toBe(DEFAULT_COPY.replay);
    expect(mergeCopy({ replay: '   ' }).replay).toBe(DEFAULT_COPY.replay);
  });

  it('ignores anything the lexicon does not name', () => {
    expect(mergeCopy({ nonsense: 'hello' })).toEqual(DEFAULT_COPY);
  });

  it('has a default and a form field for every key, both ways', () => {
    expect(COPY_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_COPY).sort());
  });
});

describe('fillCopy', () => {
  it('substitutes the take and the budget', () => {
    expect(fillCopy('Take {take} is up.', { take: '07' })).toBe('Take 07 is up.');
    expect(fillCopy('stops at {budget} MB', { budget: 256 })).toBe('stops at 256 MB');
  });

  it('leaves a placeholder it was given nothing for', () => {
    expect(fillCopy('Take {take}', {})).toBe('Take {take}');
  });

  it('leaves any other braces alone', () => {
    expect(fillCopy('a {thing} in braces')).toBe('a {thing} in braces');
  });
});
