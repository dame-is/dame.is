import { describe, it, expect } from 'vitest';
import { linkCopies, locateBlock } from './blockIdentity.js';

const IMAGE = 'pub.leaflet.blocks.image';
const TEXT = 'pub.leaflet.blocks.text';

const wrap = (block) => ({
  $type: 'pub.leaflet.pages.linearDocument#block',
  block,
});
const doc = (...blocks) => ({ pages: [{ blocks: blocks.map(wrap) }] });
const blocksOf = (content) => content.pages[0].blocks;

describe('locateBlock', () => {
  it('follows a block through edits to where it sits now', () => {
    const successors = new WeakMap();
    const picked = { $type: IMAGE };
    const withAlt = { ...picked, alt: 'a moth' };
    const withCaption = { ...withAlt, caption: 'June' };
    successors.set(picked, withAlt);
    successors.set(withAlt, withCaption);
    // Moved down one, with a new block inserted above it.
    const now = doc({ $type: TEXT }, { $type: TEXT }, withCaption);
    expect(locateBlock(blocksOf(now), picked, successors)).toBe(2);
  });

  it('answers -1 for a block that was deleted meanwhile', () => {
    const successors = new WeakMap();
    const picked = { $type: IMAGE };
    expect(
      locateBlock(blocksOf(doc({ $type: TEXT })), picked, successors),
    ).toBe(-1);
    expect(locateBlock(blocksOf(doc({ $type: TEXT })), null, successors)).toBe(
      -1,
    );
  });

  it('stops at the version an undo put back, not at the edit it took away', () => {
    const successors = new WeakMap();
    const picked = { $type: IMAGE };
    const undone = { ...picked, alt: 'typo' };
    successors.set(picked, undone);
    const now = doc({ $type: TEXT }, picked);
    expect(locateBlock(blocksOf(now), picked, successors)).toBe(1);
  });

  it('survives a cycle in the chain', () => {
    const successors = new WeakMap();
    const a = { $type: IMAGE };
    const b = { $type: IMAGE };
    successors.set(a, b);
    successors.set(b, a);
    expect(locateBlock(blocksOf(doc(b)), a, successors)).toBe(0);
    expect(locateBlock(blocksOf(doc({ $type: TEXT })), a, successors)).toBe(-1);
  });
});

describe('linkCopies', () => {
  it('links a copy of the document block for block, so an upload still lands', () => {
    const successors = new WeakMap();
    const picked = { $type: IMAGE };
    const before = doc({ $type: TEXT, plaintext: 'hi' }, picked);
    // What a save (or the display-URL pass) hands back: same document, new objects.
    const after = JSON.parse(JSON.stringify(before));
    linkCopies(before, after, successors);
    expect(locateBlock(blocksOf(after), picked, successors)).toBe(1);
  });

  it('links nothing across a document of another shape', () => {
    const successors = new WeakMap();
    const picked = { $type: IMAGE };
    const before = doc({ $type: TEXT }, picked);
    linkCopies(before, doc({ $type: TEXT }), successors);
    linkCopies(before, doc({ $type: TEXT }, { $type: TEXT }), successors);
    linkCopies(before, null, successors);
    expect(successors.has(picked)).toBe(false);
  });

  it('leaves blocks the copy kept as they were', () => {
    const successors = new WeakMap();
    const kept = { $type: TEXT };
    const before = doc(kept);
    linkCopies(before, { ...before }, successors);
    expect(successors.has(kept)).toBe(false);
  });
});
