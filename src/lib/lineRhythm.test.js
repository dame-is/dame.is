import { describe, it, expect } from 'vitest';
import { rhythmPads, rhythmPhase } from './lineRhythm.js';

const all = (n) => Array.from({ length: n }, () => true);
const zeros = (n) => Array.from({ length: n }, () => 0);

describe('rhythmPads', () => {
  it('leaves blocks that already start on a line alone', () => {
    const tops = [0, 31, 93, 155];
    expect(rhythmPads(tops, zeros(4), 31, all(4))).toEqual([0, 0, 0, 0]);
  });

  it('pads the block after a picture down to the next line, and carries it on', () => {
    // A 200px picture at 31: the paragraph after it lands 14px short of a line.
    // Everything after moves with the pad, so only that one block takes one.
    const tops = [0, 31, 231, 293];
    expect(rhythmPads(tops, zeros(4), 31, all(4))).toEqual([0, 0, 17, 0]);
  });

  it('works from the pads already on the page, so a settled page stays put', () => {
    const tops = [0, 31, 248, 310];
    expect(rhythmPads(tops, [0, 0, 17, 0], 31, all(4))).toEqual([0, 0, 17, 0]);
  });

  it('takes a pad back when the picture above grows into it', () => {
    // The picture loaded 10px taller than its placeholder; the old pad would
    // now overshoot, so it shrinks to 7.
    const tops = [0, 31, 258, 320];
    expect(rhythmPads(tops, [0, 0, 17, 0], 31, all(4))).toEqual([0, 0, 7, 0]);
  });

  it('accounts for pads decided above it within the same pass', () => {
    // Two pictures in a row, both off the rhythm: the first's pad of 22 moves
    // the second to 132, 8px past a line, so it needs 23 (not the 14 its own
    // top of 110 would ask for).
    const tops = [0, 40, 110];
    expect(rhythmPads(tops, zeros(3), 31, all(3))).toEqual([0, 22, 23]);
  });

  it('places the block after a hung credit, not the credit', () => {
    const tops = [0, 200, 230];
    expect(rhythmPads(tops, zeros(3), 31, [true, false, true])).toEqual([0, 0, 18]);
  });

  it('counts a block within half a pixel of a line as on it', () => {
    expect(rhythmPads([0, 62.4, 92.6], zeros(3), 31, all(3))).toEqual([0, 0, 0]);
  });

  it('measures from the first block, wherever it starts', () => {
    expect(rhythmPads([12, 43, 80], zeros(3), 31, all(3))).toEqual([0, 0, 25]);
  });

  it('returns no pads without a line to count in', () => {
    expect(rhythmPads([0, 10], [0, 4], 0, all(2))).toEqual([0, 0]);
    expect(rhythmPads([], [], 31, [])).toEqual([]);
  });
});

describe('rhythmPhase', () => {
  it('is the baseline’s depth into a line, from the first block', () => {
    expect(rhythmPhase(0, 22.5, 31)).toBe(22.5);
    expect(rhythmPhase(12, 22.5, 31)).toBe(3.5);
  });

  it('is 0 without a line', () => {
    expect(rhythmPhase(0, 22.5, 0)).toBe(0);
  });
});
