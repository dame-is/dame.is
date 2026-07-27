import { describe, it, expect } from 'vitest';
import { splitRichTextLines, joinRichTextLines } from './facetUtils.js';
import {
  BULLET_LIST,
  NUMBER_LIST,
  emptyListItem,
  isListBlock,
  isOrdered,
  listBlockFrom,
  listItemType,
  listToTextBlock,
  retypeList,
} from './listBlocks.js';

// The type leaflet actually renders — facetUtils writes this one.
const BOLD = { $type: 'pub.leaflet.richtext.facet#bold' };
const bold = (start, end) => ({ index: { byteStart: start, byteEnd: end }, features: [BOLD] });
const textOf = (item) => item.content.plaintext;

describe('splitRichTextLines', () => {
  it('gives one value per non-blank line', () => {
    const out = splitRichTextLines('milk\neggs\n\nbread', []);
    expect(out.map((p) => p.text)).toEqual(['milk', 'eggs', 'bread']);
  });

  it('strips a list marker the author typed by hand', () => {
    // Otherwise converting "- milk" leaves an item that renders "• - milk".
    expect(splitRichTextLines('- milk\n* eggs\n+ jam', []).map((p) => p.text)).toEqual([
      'milk',
      'eggs',
      'jam',
    ]);
    expect(splitRichTextLines('1. one\n2) two', []).map((p) => p.text)).toEqual(['one', 'two']);
  });

  it('does not mistake a hyphenated word for a marker', () => {
    expect(splitRichTextLines('well-known facts', []).map((p) => p.text)).toEqual([
      'well-known facts',
    ]);
  });

  it('re-bases facets onto the line they fall in', () => {
    // "milk\neggs" — bold covers "eggs", bytes 5–9 of the whole string.
    const out = splitRichTextLines('milk\neggs', [bold(5, 9)]);
    expect(out[0].facets).toEqual([]);
    expect(out[1].text).toBe('eggs');
    expect(out[1].facets).toEqual([bold(0, 4)]);
  });

  it('keeps byte offsets right past a multi-byte character', () => {
    // "café\nbar" — é is two bytes, so "bar" starts at byte 6, not 5.
    const out = splitRichTextLines('café\nbar', [bold(6, 9)]);
    expect(out[1].text).toBe('bar');
    expect(out[1].facets).toEqual([bold(0, 3)]);
  });

  it('returns nothing for empty or blank input', () => {
    expect(splitRichTextLines('', [])).toEqual([]);
    expect(splitRichTextLines('   \n\n', [])).toEqual([]);
  });
});

describe('joinRichTextLines', () => {
  it('rejoins with newlines and shifts facets to match', () => {
    const joined = joinRichTextLines([
      { text: 'milk', facets: [] },
      { text: 'eggs', facets: [bold(0, 4)] },
    ]);
    expect(joined.text).toBe('milk\neggs');
    expect(joined.facets).toEqual([bold(5, 9)]);
  });

  it('round-trips through splitRichTextLines', () => {
    const text = 'one\ntwo\nthree';
    const facets = [bold(4, 7)];
    const back = joinRichTextLines(splitRichTextLines(text, facets));
    expect(back.text).toBe(text);
    expect(back.facets).toEqual(facets);
  });

  it('handles an empty set', () => {
    expect(joinRichTextLines([])).toEqual({ text: '', facets: [] });
  });
});

describe('listBlockFrom', () => {
  it('builds a bulleted list with matching item types', () => {
    const block = listBlockFrom([{ text: 'a', facets: [] }, { text: 'b', facets: [] }]);
    expect(block.$type).toBe(BULLET_LIST);
    expect(block.children.map(textOf)).toEqual(['a', 'b']);
    for (const item of block.children) expect(item.$type).toBe(listItemType(false));
  });

  it('builds a numbered list with matching item types', () => {
    const block = listBlockFrom([{ text: 'a', facets: [] }], true);
    expect(block.$type).toBe(NUMBER_LIST);
    expect(block.children[0].$type).toBe(listItemType(true));
  });

  it('never produces a list with no items', () => {
    expect(listBlockFrom([]).children).toHaveLength(1);
    expect(listBlockFrom(null).children).toHaveLength(1);
  });
});

describe('retypeList', () => {
  const nested = {
    $type: BULLET_LIST,
    children: [
      { ...emptyListItem(false), content: { plaintext: 'top', facets: [] }, children: [
        { ...emptyListItem(false), content: { plaintext: 'deep', facets: [] }, children: [] },
      ] },
    ],
  };

  it('retypes the block and every descendant', () => {
    // The bug this guards: switching to numbered used to leave the children
    // typed as unordered items, so the record disagreed with itself.
    const out = retypeList(nested, true);
    expect(out.$type).toBe(NUMBER_LIST);
    expect(out.children[0].$type).toBe(listItemType(true));
    expect(out.children[0].children[0].$type).toBe(listItemType(true));
  });

  it('goes back the other way just as completely', () => {
    const out = retypeList(retypeList(nested, true), false);
    expect(out.$type).toBe(BULLET_LIST);
    expect(out.children[0].children[0].$type).toBe(listItemType(false));
  });

  it('keeps the item content untouched', () => {
    expect(retypeList(nested, true).children[0].content.plaintext).toBe('top');
  });
});

describe('listToTextBlock', () => {
  it('flattens a list into one paragraph, an item per line', () => {
    const block = listBlockFrom([{ text: 'milk' }, { text: 'eggs' }]);
    const out = listToTextBlock(block);
    expect(out.$type).toBe('pub.leaflet.blocks.text');
    expect(out.plaintext).toBe('milk\neggs');
  });

  it('pulls nested items up rather than dropping them', () => {
    // A paragraph has no depth to put them at, and losing the author's text
    // would be worse than losing the indentation.
    const block = {
      $type: BULLET_LIST,
      children: [
        { ...emptyListItem(), content: { plaintext: 'top', facets: [] }, children: [
          { ...emptyListItem(), content: { plaintext: 'deep', facets: [] }, children: [] },
        ] },
      ],
    };
    expect(listToTextBlock(block).plaintext).toBe('top\ndeep');
  });

  it('survives a round trip from a paragraph and back', () => {
    const text = 'milk\neggs\nbread';
    const facets = [bold(5, 9)];
    const back = listToTextBlock(listBlockFrom(splitRichTextLines(text, facets)));
    expect(back.plaintext).toBe(text);
    expect(back.facets).toEqual(facets);
  });

  it('drops empty items rather than leaving blank lines', () => {
    const block = listBlockFrom([{ text: 'a' }, { text: '  ' }, { text: 'b' }]);
    expect(listToTextBlock(block).plaintext).toBe('a\nb');
  });
});

describe('type guards', () => {
  it('recognises both list types and nothing else', () => {
    expect(isListBlock({ $type: BULLET_LIST })).toBe(true);
    expect(isListBlock({ $type: NUMBER_LIST })).toBe(true);
    expect(isListBlock({ $type: 'pub.leaflet.blocks.text' })).toBe(false);
    expect(isListBlock(null)).toBe(false);
  });

  it('reads orderedness off the block type', () => {
    expect(isOrdered({ $type: NUMBER_LIST })).toBe(true);
    expect(isOrdered({ $type: BULLET_LIST })).toBe(false);
    // An item type is not a list type — passing one in must not read as ordered.
    expect(isOrdered({ $type: listItemType(true) })).toBe(false);
  });
});
