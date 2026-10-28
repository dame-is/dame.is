import { describe, it, expect } from 'vitest';
import { trimBlockText } from './LeafletDocument.jsx';

describe('trimBlockText', () => {
  it('drops a credit block\'s opening newline and shifts its facets with it', () => {
    // "\nimage source: tech crunch", with "tech crunch" linked.
    const text = '\nimage source: tech crunch';
    const facets = [{ index: { byteStart: 15, byteEnd: 26 }, features: [{ $type: 'pub.leaflet.richtext.facet#link' }] }];
    const out = trimBlockText(text, facets);
    expect(out.text).toBe('image source: tech crunch');
    expect(out.facets[0].index).toEqual({ byteStart: 14, byteEnd: 25 });
    const bytes = new TextEncoder().encode(out.text);
    expect(new TextDecoder().decode(bytes.slice(14, 25))).toBe('tech crunch');
  });

  it('clamps a facet that ran into a trailing newline', () => {
    const out = trimBlockText('hello\n', [{ index: { byteStart: 0, byteEnd: 6 }, features: [] }]);
    expect(out.text).toBe('hello');
    expect(out.facets[0].index).toEqual({ byteStart: 0, byteEnd: 5 });
  });

  it('leaves text with no edge newlines untouched (same facets array)', () => {
    const facets = [{ index: { byteStart: 0, byteEnd: 2 }, features: [] }];
    const out = trimBlockText('hi there', facets);
    expect(out.facets).toBe(facets);
  });
});
