import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import React, { createElement } from 'react';
import { renderPostText } from './postRichText.jsx';

// vitest.config.js has no React plugin, so .jsx compiles to the classic
// React.createElement calls, which look `React` up as a global.
globalThis.React = React;

const html = (text, facets) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, renderPostText(text, facets)));

describe('renderPostText', () => {
  it('leaves out the U+FFFC an inline object left behind', () => {
    // As written to the PDS (at://dame.is/app.bsky.feed.post/3mz26rj72ns26).
    expect(html('rather than the big tech companies￼')).toBe(
      'rather than the big tech companies',
    );
  });

  it('keeps facets on their words when a U+FFFC comes before them', () => {
    // U+FFFC is three bytes in UTF-8, so the link starts at byte 7, not 4.
    const text = 'a ￼ see https://dame.is';
    const start = new TextEncoder().encode('a ￼ see ').length;
    const facets = [
      {
        index: { byteStart: start, byteEnd: start + 'https://dame.is'.length },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://dame.is' }],
      },
    ];
    const out = html(text, facets);
    expect(out).not.toContain('￼');
    expect(out).toContain('>https://dame.is</a>');
    expect(out.startsWith('a  see ')).toBe(true);
  });
});
