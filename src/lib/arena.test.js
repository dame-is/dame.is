// How a gallery orders its blocks. The site had exactly one order — are.na's
// own position order — until the channel record could ask for another, and the
// interesting cases are the ones where "newest" and "position" disagree.

import { describe, it, expect } from 'vitest';
import {
  orderBlocks,
  arenaText,
  pickCoverThumb,
  normalizeBlock,
  DEFAULT_BLOCK_ORDER,
} from './arena.js';
import { videoEmbedSrc } from './videoEmbed.js';

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

describe('normalizeBlock', () => {
  // Trimmed from a real v3 contents page: are.na turns a YouTube link into an
  // Embed block, with the video's poster as its image.
  const EMBED = {
    id: 48229768,
    type: 'Embed',
    title: 'some video',
    source: { url: 'https://youtube.com/watch?v=o_TlE_U_X3c&si=d717hF8V47tZyVsR', title: 'some video' },
    embed: { url: null, type: 'video', width: 640, height: 360, html: '<iframe></iframe>' },
    image: {
      src: 'https://d2w9rnfcy7mm78.cloudfront.net/48229768/original.jpeg',
      width: 480,
      height: 360,
      small: { src: 'https://images.are.na/small', src_2x: 'https://images.are.na/small2x' },
      large: { src: 'https://images.are.na/large' },
    },
    connection: { position: 2, connected_at: '2026-07-26T02:26:00Z' },
  };

  it('keeps an Embed block as a captioned tile that knows its player size', () => {
    const n = normalizeBlock(EMBED);
    expect(n).toMatchObject({
      id: 48229768,
      type: 'embed',
      thumb: { src: 'https://images.are.na/small', src2x: 'https://images.are.na/small2x' },
      large: 'https://images.are.na/large',
      sourceUrl: 'https://youtube.com/watch?v=o_TlE_U_X3c&si=d717hF8V47tZyVsR',
      sourceTitle: 'some video',
      embed: { width: 640, height: 360 },
      position: 2,
    });
  });

  it('gives only embeds an embed field', () => {
    expect(normalizeBlock({ ...EMBED, type: 'Link' })).not.toHaveProperty('embed');
  });

  it('still drops what it has no tile for', () => {
    expect(normalizeBlock({ ...EMBED, image: null })).toBeNull();
    expect(normalizeBlock({ ...EMBED, type: 'Attachment' })).toBeNull();
    expect(normalizeBlock({ ...EMBED, type: 'Channel' })).toBeNull();
  });
});

describe('videoEmbedSrc', () => {
  it('finds the player behind the ways a YouTube link gets shared', () => {
    const player = 'https://www.youtube.com/embed/o_TlE_U_X3c';
    expect(videoEmbedSrc('https://youtube.com/watch?v=o_TlE_U_X3c&si=abc')).toBe(player);
    expect(videoEmbedSrc('https://youtu.be/o_TlE_U_X3c?si=abc')).toBe(player);
    expect(videoEmbedSrc('https://m.youtube.com/shorts/o_TlE_U_X3c')).toBe(player);
    expect(videoEmbedSrc('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
  });

  it('has nothing for a host it can’t frame', () => {
    expect(videoEmbedSrc('https://soundcloud.com/someone/track')).toBeNull();
    expect(videoEmbedSrc('not a url')).toBeNull();
    expect(videoEmbedSrc(null)).toBeNull();
  });
});
