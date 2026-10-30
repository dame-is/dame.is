import { describe, it, expect } from 'vitest';
import { jsonStringToLex } from '@atproto/api';
import { uncaptionedImages, withAltCaptions } from './altCaptions.js';

const LINK = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';

const image = (fields) => ({
  block: {
    $type: 'pub.leaflet.blocks.image',
    image: { $type: 'blob', ref: { $link: LINK }, mimeType: 'image/jpeg', size: 1234 },
    ...fields,
  },
});
const text = (plaintext) => ({ block: { $type: 'pub.leaflet.blocks.text', plaintext } });
const doc = (...pages) => ({
  $type: 'site.standard.document',
  title: 'Red, Blue, Yellow',
  content: { pages: pages.map((blocks) => ({ blocks })) },
});

describe('uncaptionedImages', () => {
  it('finds image blocks with alt text and no caption, wherever they sit', () => {
    const value = doc(
      [text('intro'), image({ alt: '"Parallel Selves" 24 x 18 in' })],
      [image({ alt: '"Untitled 47" 24 x 18 in' })],
    );
    expect(uncaptionedImages(value)).toEqual([
      { page: 0, index: 1, alt: '"Parallel Selves" 24 x 18 in' },
      { page: 1, index: 0, alt: '"Untitled 47" 24 x 18 in' },
    ]);
  });

  it('leaves alone a block with a caption of its own, or no alt to copy', () => {
    const value = doc([
      image({ alt: 'A screenshot', caption: 'The settings screen' }),
      image({ alt: '' }),
      image({ alt: '   ', caption: '' }),
      image({}),
    ]);
    expect(uncaptionedImages(value)).toEqual([]);
  });

  it('counts a blank caption as none', () => {
    expect(uncaptionedImages(doc([image({ alt: 'Iterations', caption: '  ' })]))).toEqual([
      { page: 0, index: 0, alt: 'Iterations' },
    ]);
  });

  it('answers an empty list for a document with no body', () => {
    expect(uncaptionedImages({ title: 'x' })).toEqual([]);
    expect(uncaptionedImages(null)).toEqual([]);
  });
});

describe('withAltCaptions', () => {
  it('copies each alt into its caption and keeps the alt', () => {
    const value = doc([image({ alt: ' Iterations of the Visual Identity ' }), text('after')]);
    const { value: next, count } = withAltCaptions(value);
    expect(count).toBe(1);
    const block = next.content.pages[0].blocks[0].block;
    expect(block.caption).toBe('Iterations of the Visual Identity');
    expect(block.alt).toBe(' Iterations of the Visual Identity ');
    expect(next.content.pages[0].blocks[1]).toEqual(text('after'));
  });

  it('never touches a caption that is already there', () => {
    const value = doc([image({ alt: 'alt', caption: 'Its own caption' })]);
    const { value: next, count } = withAltCaptions(value);
    expect(count).toBe(0);
    expect(next.content.pages[0].blocks[0].block.caption).toBe('Its own caption');
  });

  it('returns a copy and leaves the record it was given as it was', () => {
    const value = doc([image({ alt: 'A figure (Source)' })]);
    withAltCaptions(value);
    expect(value.content.pages[0].blocks[0].block.caption).toBeUndefined();
  });

  it('hands back blobs in the wire form putRecord takes', () => {
    // A record read through the XRPC client holds live BlobRefs, not JSON.
    const live = jsonStringToLex(JSON.stringify(doc([image({ alt: 'A painting' })])));
    const { value: next } = withAltCaptions(live);
    expect(next.content.pages[0].blocks[0].block.image).toEqual({
      $type: 'blob',
      ref: { $link: LINK },
      mimeType: 'image/jpeg',
      size: 1234,
    });
  });
});
