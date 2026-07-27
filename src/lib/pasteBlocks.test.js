import { describe, it, expect } from 'vitest';
import { looksLikeMultiBlock, markdownToBlocks, textBlockToBlocks } from './pasteBlocks.js';

const TEXT = 'pub.leaflet.blocks.text';
const BOLD = 'pub.leaflet.richtext.facet#bold';
const LINK = 'pub.leaflet.richtext.facet#link';

const para = (plaintext, facets = []) => ({ $type: TEXT, plaintext, facets });
const bold = (start, end) => ({ index: { byteStart: start, byteEnd: end }, features: [{ $type: BOLD }] });
const typesAt = (facets, start) =>
  (facets.find((f) => f.index.byteStart === start)?.features || []).map((f) => f.$type).sort();

describe('looksLikeMultiBlock', () => {
  it('takes a blank-line break or a block marker as structure', () => {
    expect(looksLikeMultiBlock('one\n\ntwo')).toBe(true);
    expect(looksLikeMultiBlock('# Title')).toBe(true);
    expect(looksLikeMultiBlock('- a\n- b')).toBe(true);
  });

  it('leaves a lone line alone, marker or not', () => {
    expect(looksLikeMultiBlock('just a sentence')).toBe(false);
    expect(looksLikeMultiBlock('- one note')).toBe(false);
    expect(looksLikeMultiBlock('')).toBe(false);
  });
});

describe('textBlockToBlocks', () => {
  it('leaves prose that is not markdown alone', () => {
    // The null is what makes this safe to run on every exit from a block.
    expect(textBlockToBlocks(para('just some plain prose here'))).toBeNull();
    expect(textBlockToBlocks(para('line one\nline two'))).toBeNull();
    expect(textBlockToBlocks(para('well-known facts about 2019. That year was odd.'))).toBeNull();
    expect(textBlockToBlocks(para('my_file_name is here'))).toBeNull();
  });

  it('ignores anything that is not a text block', () => {
    expect(textBlockToBlocks({ $type: 'pub.leaflet.blocks.header', plaintext: '# no' })).toBeNull();
    expect(textBlockToBlocks(null)).toBeNull();
  });

  it('keeps an empty or blank block rather than deleting it', () => {
    expect(textBlockToBlocks(para(''))).toBeNull();
    expect(textBlockToBlocks(para('   \n\n'))).toBeNull();
  });

  it('splits a passage into the blocks it describes', () => {
    const out = textBlockToBlocks(para('# Title\n\nBody text\n\n- milk\n- eggs'));
    expect(out.map((b) => b.$type)).toEqual([
      'pub.leaflet.blocks.header',
      TEXT,
      'pub.leaflet.blocks.unorderedList',
    ]);
    expect(out[0].plaintext).toBe('Title');
    expect(out[2].children.map((c) => c.content.plaintext)).toEqual(['milk', 'eggs']);
  });

  it('turns an inline link into a facet without leaving the paragraph', () => {
    const out = textBlockToBlocks(para('A [link](https://example.com) inline.'));
    expect(out).toHaveLength(1);
    expect(out[0].plaintext).toBe('A link inline.');
    expect(out[0].facets[0].features[0]).toEqual({ $type: LINK, uri: 'https://example.com' });
  });

  it('is idempotent, so leaving an already-converted block does nothing', () => {
    // A bare URL auto-links on the first pass; the second pass must find
    // nothing left to do, or every exit would re-commit the same block.
    const first = textBlockToBlocks(para('See https://example.com for more'));
    expect(first).toHaveLength(1);
    expect(first[0].facets).toHaveLength(1);
    expect(textBlockToBlocks(first[0])).toBeNull();
  });

  it('carries formatting the author applied with the toolbar', () => {
    // "eggs" is bold via the B button — there is no marker in the text for the
    // markdown pass to see, so it has to be carried across separately.
    const out = textBlockToBlocks(para('- milk\n- eggs\n- bread', [bold(9, 13)]));
    const items = out[0].children.map((c) => c.content);
    expect(items.map((c) => c.plaintext)).toEqual(['milk', 'eggs', 'bread']);
    expect(items[0].facets).toEqual([]);
    expect(items[1].facets).toEqual([bold(0, 4)]);
  });

  it('keeps toolbar formatting alongside formatting the markdown produced', () => {
    // "read" is bold from the toolbar; the bare URL auto-links. Both belong to
    // the finished block — neither pass may overwrite the other's work.
    const out = textBlockToBlocks(para('read https://x.test now', [bold(0, 4)]));
    expect(out[0].plaintext).toBe('read https://x.test now');
    expect(typesAt(out[0].facets, 0)).toEqual([BOLD]);
    expect(typesAt(out[0].facets, 5)).toEqual([LINK]);
  });

  it('carries formatting across a heading too', () => {
    const out = textBlockToBlocks(para('# Big news\n\nbody', [bold(6, 10)]));
    expect(out[0].plaintext).toBe('Big news');
    expect(out[0].facets).toEqual([bold(4, 8)]);
  });

  it('gives up on a span whose markers were consumed rather than misplacing it', () => {
    // "**bold**" becomes "bold", so there is no verbatim text to locate — the
    // markdown's own bold stands, and the stale offsets are not guessed at.
    const out = textBlockToBlocks(para('some **bold** text', [bold(5, 13)]));
    expect(out[0].plaintext).toBe('some bold text');
    expect(typesAt(out[0].facets, 5)).toEqual([BOLD]);
  });

  it('carries the spacing the author set around the passage', () => {
    const out = textBlockToBlocks({
      ...para('# Title\n\nbody'),
      spaceTop: 'lg',
      spaceBottom: 'sm',
    });
    expect(out[0].spaceTop).toBe('lg');
    expect(out[0].spaceBottom).toBeUndefined();
    expect(out[out.length - 1].spaceBottom).toBe('sm');
  });

  it('only follows indent onto a paragraph', () => {
    expect(textBlockToBlocks({ ...para('# Title\n\nbody'), indent: true })[0].indent).toBeUndefined();
    expect(textBlockToBlocks({ ...para('a [x](https://y.test) b'), indent: true })[0].indent).toBe(true);
  });
});

describe('markdownToBlocks', () => {
  it('keeps an absolute image URL renderable and drops the migration field', () => {
    const [block] = markdownToBlocks('![a cat](https://example.com/cat.jpg)');
    expect(block.$type).toBe('pub.leaflet.blocks.image');
    expect(block.url).toBe('https://example.com/cat.jpg');
    expect(block._src).toBeUndefined();
  });

  it('leaves an unresolvable local image empty for the author to fill in', () => {
    const [block] = markdownToBlocks('![a cat](/images/cat.jpg)');
    expect(block.url).toBeUndefined();
    expect(block.alt).toBe('a cat');
  });
});
