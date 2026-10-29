import { describe, it, expect } from 'vitest';
import { ledeEnd, splitLeafletText, unlinkInitial } from './leafletRichText.jsx';

const lede = (t) => t.slice(0, ledeEnd(t));

describe('ledeEnd', () => {
  it('runs to the first clause mark within five words', () => {
    expect(lede('In November of 2007, Facebook made a tiny change')).toBe('In November of 2007');
    expect(lede('Note: you can also read this')).toBe('Note');
    expect(lede('Several years ago, back when Twitter was a thing')).toBe('Several years ago');
  });

  it('takes three words when no mark comes soon', () => {
    expect(lede('Six months ago I posted the following thought')).toBe('Six months ago');
    expect(lede('As many of you know by now, I am')).toBe('As many of');
  });

  it('copes with a short or empty paragraph', () => {
    expect(lede('Hi')).toBe('Hi');
    expect(ledeEnd('')).toBe(0);
  });
});

describe('splitLeafletText', () => {
  const link = (byteStart, byteEnd) => ({
    index: { byteStart, byteEnd },
    features: [{ $type: 'pub.leaflet.richtext.facet#link', uri: 'https://example.com' }],
  });
  const italic = (byteStart, byteEnd) => ({
    index: { byteStart, byteEnd },
    features: [{ $type: 'pub.leaflet.richtext.facet#italic' }],
  });

  it('rebases facets onto each half and splits formatting across the cut', () => {
    const [a, b] = splitLeafletText('Note: you can read', [italic(0, 18)], 4);
    expect(a).toEqual({ text: 'Note', facets: [italic(0, 4)] });
    expect(b).toEqual({ text: ': you can read', facets: [italic(0, 14)] });
  });

  it('never cuts a link: the cut moves back to its start', () => {
    const [a, b] = splitLeafletText('See anisota.net now', [link(4, 15)], 8);
    expect(a.text).toBe('See ');
    expect(b.text).toBe('anisota.net now');
    expect(b.facets).toEqual([link(0, 11)]);
  });

  it('counts bytes, not characters', () => {
    const [a, b] = splitLeafletText('Café au lait', [italic(6, 13)], 4);
    expect(a.text).toBe('Café');
    expect(b.facets).toEqual([italic(1, 8)]);
  });
});

describe('unlinkInitial', () => {
  const link = (byteStart, byteEnd) => ({
    index: { byteStart, byteEnd },
    features: [{ $type: 'pub.leaflet.richtext.facet#link', uri: 'https://anisota.net' }],
  });
  const bold = { index: { byteStart: 0, byteEnd: 7 }, features: [{ $type: 'pub.leaflet.richtext.facet#bold' }] };

  it('starts an opening link after the initial, leaving other facets alone', () => {
    expect(unlinkInitial('Anisota is one', [link(0, 7), bold])).toEqual([link(1, 7), bold]);
  });

  it('takes leading punctuation with the initial, as ::first-letter does', () => {
    expect(unlinkInitial('\u201cHello\u201d', [link(0, 11)])).toEqual([link(4, 11)]);
  });

  it('leaves a link that starts later', () => {
    expect(unlinkInitial('See anisota.net', [link(4, 15)])).toEqual([link(4, 15)]);
  });
});
