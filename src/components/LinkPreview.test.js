import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// As in LeafletDocument.test.js: no React plugin here, so JSX compiles to
// React.createElement against the global.
globalThis.React = React;

// What the document's previews file holds, stood in for so the links can be
// drawn in each state the hook passes through.
let state;
vi.mock('../hooks/useLinkPreviews.js', () => ({ useLinkPreviews: () => state }));

const { LinkPreviewProvider } = await import('./LinkPreview.jsx');
const { LeafletBlock } = await import('./LeafletDocument.jsx');

const ICON = 'data:image/webp;base64,AAAA';
const block = {
  $type: 'pub.leaflet.blocks.text',
  plaintext: 'Jack Dorsey described it, and so did others.',
  facets: [
    {
      index: { byteStart: 0, byteEnd: 21 },
      features: [{ $type: 'pub.leaflet.richtext.facet#link', uri: 'https://twitter.com/jack/status/1' }],
    },
    {
      index: { byteStart: 37, byteEnd: 43 },
      features: [{ $type: 'pub.leaflet.richtext.facet#link', uri: 'https://example.org/others' }],
    },
  ],
};

const draw = () =>
  renderToStaticMarkup(
    React.createElement(
      LinkPreviewProvider,
      { atUri: 'at://did:plc:me/site.standard.document/a', cid: 'bafy', links: [] },
      React.createElement(LeafletBlock, { block }),
    ),
  );

beforeEach(() => {
  state = { status: 'idle', previews: {}, icons: {} };
});

describe('links in a document with previews', () => {
  it('end on the site’s icon, held to the last word, and drop the host tooltip for the card', () => {
    state = {
      status: 'ready',
      previews: { 'https://twitter.com/jack/status/1': { kind: 'x-post', host: 'twitter.com', path: 'twitter.com/jack/status/1', icon: 'twitter.com' } },
      icons: { 'twitter.com': ICON },
    };
    const html = draw();
    expect(html).toContain(
      `<a href="https://twitter.com/jack/status/1" target="_blank" rel="noreferrer noopener" class="post-rich-link">Jack Dorsey <span class="post-rich-link-end">described<img class="post-rich-link-icon" src="${ICON}"`,
    );
    // The link the build couldn't read keeps its host as the tooltip, and no icon.
    expect(html).toMatch(/<a [^>]*title="example.org"[^>]*><span class="post-rich-link-end">others<\/span><\/a>/);
  });

  it('hold the icon’s room while the previews load', () => {
    state = { status: 'loading', previews: {}, icons: {} };
    const html = draw();
    expect(html.match(/post-rich-link-icon is-pending/g)).toHaveLength(2);
  });

  it('are drawn exactly as before where nothing is looked up', () => {
    const plain = renderToStaticMarkup(React.createElement(LeafletBlock, { block }));
    expect(draw()).toBe(plain);
    expect(plain).not.toContain('post-rich-link-end');
  });
});
