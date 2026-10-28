import { describe, expect, it } from 'vitest';
import { figureSpans } from './figureSpans.js';

describe('figureSpans', () => {
  it('leaves a full row alone', () => {
    expect(figureSpans([{}, {}, {}, {}], 4)).toEqual([1, 1, 1, 1]);
  });

  it('stretches the last cell over the rest of a short row', () => {
    // Five figures two-up: the fifth takes the whole last row.
    expect(figureSpans([{}, {}, {}, {}, {}], 2)).toEqual([1, 1, 1, 1, 2]);
    // Three headline figures in a four-column band: the third takes two.
    expect(figureSpans([{}, {}, {}], 4)).toEqual([1, 1, 2]);
  });

  it('gives a wide cell its own row only when asked', () => {
    const items = [{}, {}, {}, { wide: true }];
    expect(figureSpans(items, 2)).toEqual([1, 1, 1, 1]);
    // Two-up, the third figure closes its row before the wide one starts.
    expect(figureSpans(items, 2, { honorWide: true })).toEqual([1, 1, 2, 2]);
  });

  it('copes with nothing and with nonsense', () => {
    expect(figureSpans([], 3)).toEqual([]);
    expect(figureSpans(null, 3)).toEqual([]);
    expect(figureSpans([{}, {}], 0)).toEqual([1, 1]);
  });
});
