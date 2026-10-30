import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { trimBlockText, LeafletBlock } from './LeafletDocument.jsx';

// vitest.config.js runs without the React plugin, so JSX here compiles to
// React.createElement against whatever `React` is in scope when it runs. The
// app's build uses the automatic runtime and needs none of this.
globalThis.React = React;

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

describe('LeafletBlock — Leaflet\'s blockquote', () => {
  const draw = (block) => renderToStaticMarkup(React.createElement(LeafletBlock, { block }));

  it('sets the quotation the way an inset is set, typeset', () => {
    const html = draw({
      $type: 'pub.leaflet.blocks.blockquote',
      plaintext: '"Twitter is funding a small independent team" -- in 2019...',
    });
    expect(html).toMatch(
      /^<blockquote class="leaflet-paragraph leaflet-inset">“Twitter is funding a small independent team” — in 2019…/,
    );
    // The typed text rides along for x-ray, hidden from a screen reader.
    expect(html).toContain('<span class="leaflet-xray-raw" aria-hidden="true">');
    expect(html.endsWith('</blockquote>')).toBe(true);
  });

  it('keeps its links', () => {
    const html = draw({
      $type: 'pub.leaflet.blocks.blockquote',
      plaintext: 'Atmosphere update: apps are growing',
      facets: [
        {
          index: { byteStart: 0, byteEnd: 10 },
          features: [{ $type: 'pub.leaflet.richtext.facet#link', uri: 'https://example.com/update' }],
        },
      ],
    });
    expect(html).toMatch(/^<blockquote class="leaflet-paragraph leaflet-inset"><a [^>]*href="https:\/\/example.com\/update"[^>]*>Atmosphere<\/a> update: apps are growing<\/blockquote>$/);
  });

  it('draws no quotation for an empty one', () => {
    expect(draw({ $type: 'pub.leaflet.blocks.blockquote', plaintext: ' \n' })).not.toContain('<blockquote');
  });
});
