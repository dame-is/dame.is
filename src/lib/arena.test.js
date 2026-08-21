// How a gallery orders its blocks. The site had exactly one order — are.na's
// own position order — until the channel record could ask for another, and the
// interesting cases are the ones where "newest" and "position" disagree.

import { describe, it, expect } from 'vitest';
import { orderBlocks, arenaText, pickCoverThumb, DEFAULT_BLOCK_ORDER } from './arena.js';

/** Blocks as they come off are.na: position order, each with a connection date. */
const block = (id, connectedAt, extra = {}) => ({ id, type: 'image', connectedAt, ...extra });

// Position order and connection order deliberately disagree here: block 2 was
// added last but sits second, the way a hand-reordered channel reads.
const CHANNEL = [
  block(1, '2025-01-30T15:10:52Z'),
  block(2, '2026-08-02T01:05:27Z'),
  block(3, '2025-06-01T00:00:00Z'),
  block(4, '2025-02-05T05:20:09Z'),
];

const ids = (list) => list.map((b) => b.id);

describe('orderBlocks', () => {
  it('leaves are.na’s own order alone by default', () => {
    expect(ids(orderBlocks(CHANNEL))).toEqual([1, 2, 3, 4]);
    expect(ids(orderBlocks(CHANNEL, { order: DEFAULT_BLOCK_ORDER }))).toEqual([1, 2, 3, 4]);
    expect(ids(orderBlocks(CHANNEL, { order: 'nonsense' }))).toEqual([1, 2, 3, 4]);
  });

  it('sorts by when a block joined the channel, not by where it sits', () => {
    expect(ids(orderBlocks(CHANNEL, { order: 'newest' }))).toEqual([2, 3, 4, 1]);
    expect(ids(orderBlocks(CHANNEL, { order: 'oldest' }))).toEqual([1, 4, 3, 2]);
  });

  it('keeps undated blocks together at the end rather than dating them', () => {
    const withUndated = [...CHANNEL, block(5, null), block(6, 'not a date')];
    expect(ids(orderBlocks(withUndated, { order: 'newest' }))).toEqual([2, 3, 4, 1, 5, 6]);
    expect(ids(orderBlocks(withUndated, { order: 'oldest' }))).toEqual([1, 4, 3, 2, 5, 6]);
  });

  it('deals the same shuffle for one seed and a different one for another', () => {
    const a = ids(orderBlocks(CHANNEL, { order: 'random', seed: 7 }));
    expect(ids(orderBlocks(CHANNEL, { order: 'random', seed: 7 }))).toEqual(a);
    expect(a).toHaveLength(CHANNEL.length);
    expect([...a].sort()).toEqual([1, 2, 3, 4]);
    // Not a guarantee about any one pair of seeds — these two are checked to
    // differ so a shuffle that quietly stopped shuffling would fail here.
    expect(ids(orderBlocks(CHANNEL, { order: 'random', seed: 99 }))).not.toEqual(a);
  });

  it('floats pinned blocks in pin order, whatever the rest is doing', () => {
    expect(ids(orderBlocks(CHANNEL, { order: 'newest', pinned: [3, 1] }))).toEqual([3, 1, 2, 4]);
    expect(ids(orderBlocks(CHANNEL, { order: 'oldest', pinned: [3, 1] }))).toEqual([3, 1, 4, 2]);
    const random = ids(orderBlocks(CHANNEL, { order: 'random', seed: 7, pinned: [3, 1] }));
    expect(random.slice(0, 2)).toEqual([3, 1]);
    expect([...random].sort()).toEqual([1, 2, 3, 4]);
  });

  it('places nothing for a pin whose block has left the channel', () => {
    expect(ids(orderBlocks(CHANNEL, { pinned: [999, 2] }))).toEqual([2, 1, 3, 4]);
  });

  it('pins each block once, however many times it is named', () => {
    expect(ids(orderBlocks(CHANNEL, { pinned: [2, 2, 3] }))).toEqual([2, 3, 1, 4]);
  });

  it('matches pins across the string/number line', () => {
    expect(ids(orderBlocks(CHANNEL, { pinned: ['3'] }))).toEqual([3, 1, 2, 4]);
  });

  it('never hands back the array it was given', () => {
    const input = [...CHANNEL];
    const out = orderBlocks(input, { order: 'newest' });
    expect(out).not.toBe(input);
    expect(ids(input)).toEqual([1, 2, 3, 4]);
  });

  it('survives the empty and the malformed', () => {
    expect(orderBlocks(null)).toEqual([]);
    expect(orderBlocks([])).toEqual([]);
    expect(orderBlocks(undefined, { order: 'random', seed: 1 })).toEqual([]);
    expect(ids(orderBlocks([null, block(1, null), undefined]))).toEqual([1]);
  });
});

describe('arenaText', () => {
  it('reads are.na’s rich text without handing React an object', () => {
    expect(arenaText({ plain: 'plain', markdown: 'md', html: '<p>x</p>' })).toBe('plain');
    expect(arenaText({ markdown: 'md' })).toBe('md');
    expect(arenaText('already a string')).toBe('already a string');
    expect(arenaText(null)).toBe('');
  });
});

describe('pickCoverThumb', () => {
  const withThumb = (id) => ({ id, thumb: { src: `https://example/${id}.jpg` } });

  it('honours the chosen block, then the first one that has a picture', () => {
    const blocks = [{ id: 1, type: 'text' }, withThumb(2), withThumb(3)];
    expect(pickCoverThumb(blocks, 3).src).toBe('https://example/3.jpg');
    expect(pickCoverThumb(blocks).src).toBe('https://example/2.jpg');
    expect(pickCoverThumb(blocks, 999).src).toBe('https://example/2.jpg');
    expect(pickCoverThumb([{ id: 1, type: 'text' }])).toBeNull();
  });
});
