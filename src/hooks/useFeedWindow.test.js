import { describe, expect, it } from 'vitest';
import { windowOf } from './useFeedWindow.js';

const nights = [3, 5, 2, 8].map((n, i) => ({
  id: i,
  observations: Array(n).fill(0),
}));
const weigh = (night) => night.observations.length;

describe('windowOf', () => {
  it('takes plain rows one for one', () => {
    expect(windowOf([1, 2, 3, 4], 2)).toEqual([1, 2]);
  });

  it('takes whole groups until their rows reach the count', () => {
    // 3 + 5 = 8 reaches 6, so the second night is the last one in.
    expect(windowOf(nights, 6, weigh).map((n) => n.id)).toEqual([0, 1]);
    expect(windowOf(nights, 8, weigh).map((n) => n.id)).toEqual([0, 1]);
    expect(windowOf(nights, 9, weigh).map((n) => n.id)).toEqual([0, 1, 2]);
  });

  it('always shows the first group, however big', () => {
    expect(windowOf(nights.slice(3), 1, weigh)).toHaveLength(1);
  });

  it('counts an empty group as a row, so the window still advances', () => {
    const empty = [
      { observations: [] },
      { observations: [] },
      { observations: [] },
    ];
    expect(windowOf(empty, 2, weigh)).toHaveLength(2);
  });
});
