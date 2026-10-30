import { describe, it, expect } from 'vitest';
import { countWords, documentWords, readingMinutes, WORDS_PER_MINUTE } from './readingTime.js';

const wrap = (block) => ({ block });
const doc = (...blocks) => ({ pages: [{ blocks: blocks.map(wrap) }] });
const words = (n) => Array.from({ length: n }, () => 'word').join(' ');

describe('countWords', () => {
  it('counts runs of text, not punctuation or extra space', () => {
    expect(countWords('Don’t miss the Atmosphere — for the blue sky.')).toBe(8);
    expect(countWords('  two\n\nwords  ')).toBe(2);
    expect(countWords('20% month over month')).toBe(4);
  });

  it('answers 0 for nothing', () => {
    expect(countWords('')).toBe(0);
    expect(countWords(undefined)).toBe(0);
  });
});

describe('documentWords', () => {
  it('reads paragraphs, headings, quotations and nested lists', () => {
    const content = doc(
      { $type: 'pub.leaflet.blocks.header', plaintext: 'Graber > Gruber' },
      { $type: 'pub.leaflet.blocks.text', plaintext: 'one two three' },
      { $type: 'pub.leaflet.blocks.blockquote', plaintext: '“four five”' },
      {
        $type: 'pub.leaflet.blocks.orderedList',
        children: [
          {
            content: { plaintext: 'six seven' },
            children: [{ content: { plaintext: 'eight' } }],
          },
        ],
      },
    );
    expect(documentWords(content)).toBe(10);
  });

  it('leaves out code, embeds, cards and pictures', () => {
    const content = doc(
      { $type: 'pub.leaflet.blocks.code', plaintext: 'const a = 1;' },
      { $type: 'pub.leaflet.blocks.bskyPost', postRef: { uri: 'at://x' } },
      { $type: 'pub.leaflet.blocks.website', title: 'A card title' },
      { $type: 'pub.leaflet.blocks.image', alt: 'A painting', caption: 'Untitled' },
    );
    expect(documentWords(content)).toBe(0);
  });

  it('answers 0 for a document with no body', () => {
    expect(documentWords(undefined)).toBe(0);
    expect(documentWords({ pages: [{}] })).toBe(0);
  });
});

describe('readingMinutes', () => {
  it('rounds to whole minutes at the average reading speed', () => {
    expect(readingMinutes(WORDS_PER_MINUTE * 9)).toBe(9);
    expect(readingMinutes(Math.floor(WORDS_PER_MINUTE * 8.4))).toBe(8);
    expect(readingMinutes(Math.ceil(WORDS_PER_MINUTE * 8.6))).toBe(9);
  });

  it('says a minute for anything short, and nothing for no words', () => {
    expect(readingMinutes(countWords(words(40)))).toBe(1);
    expect(readingMinutes(0)).toBe(0);
  });
});
