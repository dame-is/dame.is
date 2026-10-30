import { describe, it, expect } from 'vitest';
import {
  quotableText,
  matchQuote,
  quoteFrom,
  encodeQuote,
  quoteHref,
  fold,
  QUOTE_MAX_CHARS,
  QUOTE_PARAM,
} from './quote.js';

const text = (plaintext, extra = {}) => ({ block: { $type: 'pub.leaflet.blocks.text', plaintext, ...extra } });
const header = (plaintext) => ({ block: { $type: 'pub.leaflet.blocks.header', level: 2, plaintext } });
const item = (plaintext, children = []) => ({ content: { $type: 'pub.leaflet.blocks.text', plaintext }, children });
const list = (...children) => ({ block: { $type: 'pub.leaflet.blocks.unorderedList', children } });
const other = ($type, extra = {}) => ({ block: { $type, ...extra } });
const doc = (...blocks) => ({ $type: 'pub.leaflet.content', pages: [{ blocks }] });

// Written the way records are: straight quotes, three dots, double hyphens.
const ESSAY = doc(
  text('Recently in the Atmosphere there were several contentious conversations happening.'),
  text("It's the \"Bluesky is dying\" discourse -- again... and I don't think it's true."),
  header('Graber > Gruber'),
  list(item('Go to bsky.app and click "Create account".'), item('Pick a handle', [item('a nested step')])),
  other('pub.leaflet.blocks.bskyPost', { postRef: { uri: 'at://did:plc:x/app.bsky.feed.post/1' } }),
  text('The prose after the embedded post carries on here.'),
  text('Somebody else said this, set as a quotation.', { layout: 'inset' }),
  text('image source: a credit line', { layout: 'credit' }),
  other('pub.leaflet.blocks.code', { plaintext: 'const quoted = "code";' }),
  other('pub.leaflet.blocks.blockquote', { plaintext: 'a blockquote from elsewhere' }),
  text('A closing thought 🌱 with an emoji before the end of it.'),
);

describe('quotableText', () => {
  it('keeps the author’s prose: paragraphs, headings and every list item', () => {
    const t = quotableText(ESSAY);
    expect(t).toContain('Recently in the Atmosphere');
    expect(t).toContain('Graber > Gruber');
    expect(t).toContain('Pick a handle');
    expect(t).toContain('a nested step');
  });

  it('leaves out embeds, code, quotations, credits and blockquotes', () => {
    const t = quotableText(ESSAY);
    expect(t).not.toContain('Somebody else said this');
    expect(t).not.toContain('image source');
    expect(t).not.toContain('const quoted');
    expect(t).not.toContain('a blockquote from elsewhere');
  });

  it('is empty for a document with no pages', () => {
    expect(quotableText(null)).toBe('');
    expect(quotableText({ pages: [] })).toBe('');
  });
});

describe('matchQuote', () => {
  it('finds a passage copied off the typeset page in the record’s typed text', () => {
    // What a reader selects: curly quotes, an em dash, an ellipsis.
    const found = matchQuote(ESSAY, 'It’s the “Bluesky is dying” discourse — again… and I don’t think');
    expect(found.words).toBe("It's the \"Bluesky is dying\" discourse -- again... and I don't think");
    expect(found.display).toBe('It’s the “Bluesky is dying” discourse — again… and I don’t think');
  });

  it('ignores case and how the whitespace fell', () => {
    const found = matchQuote(ESSAY, '  RECENTLY in the\n\n  atmosphere  ');
    expect(found.words).toBe('Recently in the Atmosphere');
  });

  it('rounds a selection out to whole words', () => {
    expect(matchQuote(ESSAY, 'ently in the Atmos').words).toBe('Recently in the Atmosphere');
    expect(matchQuote(ESSAY, "and I don").words).toBe("and I don't");
  });

  it('drops the stray punctuation a drag picks up at either end', () => {
    expect(matchQuote(ESSAY, '. It’s the “Bluesky').words).toBe('It\'s the "Bluesky');
    expect(matchQuote(ESSAY, 'is dying” discourse — ').words).toBe('is dying" discourse');
    expect(matchQuote(ESSAY, 'again... and').words).toBe('again... and');
  });

  it('runs across paragraphs, and sets the break as a space', () => {
    const found = matchQuote(ESSAY, 'it’s true.\nGraber > Gruber');
    expect(found.words).toBe("it's true. Graber > Gruber");
  });

  it('never reaches across an embed, a figure or a quotation', () => {
    expect(matchQuote(ESSAY, 'a nested step The prose after')).toBeNull();
    expect(matchQuote(ESSAY, 'carries on here. A closing thought')).toBeNull();
  });

  it('won’t quote words that aren’t the author’s prose', () => {
    expect(matchQuote(ESSAY, 'Somebody else said this')).toBeNull();
    expect(matchQuote(ESSAY, 'a credit line')).toBeNull();
    expect(matchQuote(ESSAY, 'a blockquote from elsewhere')).toBeNull();
  });

  it('finds nothing for words the document doesn’t contain', () => {
    expect(matchQuote(ESSAY, 'Bluesky is thriving')).toBeNull();
    expect(matchQuote(ESSAY, '')).toBeNull();
    expect(matchQuote(null, 'Recently in the Atmosphere')).toBeNull();
  });

  it('can’t be walked across a wall by a control character in the quote', () => {
    expect(matchQuote(ESSAY, 'a nested step\u0000The prose after')).toBeNull();
  });

  it('wants a passage, not a word', () => {
    expect(matchQuote(ESSAY, 'Atmosphere')).toBeNull();
    expect(matchQuote(ESSAY, 'Atmosphere there')).not.toBeNull();
  });

  it('cuts the right words after an emoji', () => {
    expect(matchQuote(ESSAY, 'with an emoji before').words).toBe('with an emoji before');
  });

  it('marks a real passage that is too long to card, and quoteFrom declines it', () => {
    const long = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ');
    const big = doc(text(long));
    const found = matchQuote(big, long);
    expect(found.words.length).toBeGreaterThan(QUOTE_MAX_CHARS);
    expect(found.tooLong).toBe(true);
    expect(quoteFrom(big, long)).toBeNull();
    expect(quoteFrom(ESSAY, 'Recently in the Atmosphere')).toMatchObject({ words: 'Recently in the Atmosphere' });
  });

  it('agrees with itself: the words a link carries find the same words again', () => {
    const first = matchQuote(ESSAY, 'ently in the Atmosphere there were sev');
    expect(matchQuote(ESSAY, first.words)).toEqual(first);
  });
});

describe('fold', () => {
  it('maps every folded character back to the source character it came from', () => {
    const { norm, starts, ends } = fold('a…b');
    expect(norm).toBe('a...b');
    expect(starts).toEqual([0, 1, 1, 1, 2]);
    expect(ends).toEqual([1, 2, 2, 2, 3]);
  });
});

describe('encodeQuote / quoteHref', () => {
  it('reads as words, and comes back exactly through URLSearchParams', () => {
    const words = `It's the "Bluesky is dying" discourse, again: really? Yes & no #1 + 2 / 3.`;
    const encoded = encodeQuote(words);
    expect(encoded).toMatch(/^It's\+the\+%22Bluesky/);
    expect(encoded).toContain('discourse,+again:+really?');
    expect(new URLSearchParams(`${QUOTE_PARAM}=${encoded}`).get(QUOTE_PARAM)).toBe(words);
  });

  it('escapes a final full stop or bracket, so a linkifier can’t drop it', () => {
    expect(encodeQuote('the end.')).toBe('the+end%2E');
    expect(encodeQuote('an aside)')).toBe('an+aside%29');
    expect(encodeQuote('no punctuation')).toBe('no+punctuation');
  });

  it('builds the link a selection shares', () => {
    expect(quoteHref('/blogging/3abc', 'two words')).toBe('/blogging/3abc?quote=two+words');
  });
});
