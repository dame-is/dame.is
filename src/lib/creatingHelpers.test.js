import { describe, it, expect } from 'vitest';
import { blobThumbUrl, coverThumb, swapToOriginal } from './creatingHelpers.js';

const DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
const CID = 'bafkreihlf4xknfmqdnwezg7qn4rkg62e2rniorni6ml5pk6k7fion2q3zi';
// The shape feedBuilder's annotateBlobUrl bakes onto a blob as `_url`.
const GET_BLOB = `https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(DID)}&cid=${CID}`;
const CARD = `https://cdn.bsky.app/img/feed_thumbnail/plain/${DID}/${CID}@webp`;

describe('blobThumbUrl', () => {
  it('turns a getBlob original into a CDN-sized copy', () => {
    expect(blobThumbUrl(GET_BLOB)).toBe(CARD);
    expect(blobThumbUrl(GET_BLOB, { size: 'icon' })).toBe(
      `https://cdn.bsky.app/img/avatar_thumbnail/plain/${DID}/${CID}@webp`,
    );
  });

  it('leaves anything that is not a getBlob URL alone', () => {
    expect(blobThumbUrl('https://example.com/cover.jpg')).toBeNull();
    expect(blobThumbUrl('not a url')).toBeNull();
    expect(blobThumbUrl(null)).toBeNull();
  });

  it('keeps a GIF as its original, since every CDN variant is a still frame', () => {
    expect(blobThumbUrl(GET_BLOB, { mimeType: 'image/gif' })).toBeNull();
  });

  it('refuses a getBlob URL missing its did or cid', () => {
    expect(
      blobThumbUrl(
        'https://pds.example.com/xrpc/com.atproto.sync.getBlob?cid=abc',
      ),
    ).toBeNull();
  });
});

describe('coverThumb', () => {
  it('prefers the cover blob, thumbnailed, and keeps the original to fall back to', () => {
    const value = {
      title: 'Ratioed',
      coverImage: {
        ref: { $link: CID },
        mimeType: 'image/jpeg',
        _url: GET_BLOB,
      },
    };
    expect(coverThumb(value)).toEqual({
      url: CARD,
      alt: 'Ratioed',
      original: GET_BLOB,
    });
  });

  it('falls back to the first image block in the body', () => {
    const value = {
      content: {
        pages: [
          {
            blocks: [
              { block: { $type: 'pub.leaflet.blocks.text' } },
              {
                block: {
                  $type: 'pub.leaflet.blocks.image',
                  alt: 'a diagram',
                  image: { mimeType: 'image/png', _url: GET_BLOB },
                },
              },
            ],
          },
        ],
      },
    };
    expect(coverThumb(value)).toEqual({
      url: CARD,
      alt: 'a diagram',
      original: GET_BLOB,
    });
  });

  it('passes a legacy media URL through untouched', () => {
    const value = {
      media: [{ kind: 'image', url: 'https://example.com/a.jpg', alt: 'a' }],
    };
    expect(coverThumb(value)).toEqual({
      url: 'https://example.com/a.jpg',
      alt: 'a',
      original: null,
    });
  });

  it('returns null when a work has no image at all', () => {
    expect(coverThumb({ title: 'Words only' })).toBeNull();
  });
});

describe('swapToOriginal', () => {
  it('swaps to the original once, then leaves a failing original alone', () => {
    const img = { src: CARD, dataset: {} };
    swapToOriginal({ currentTarget: img }, GET_BLOB);
    expect(img.src).toBe(GET_BLOB);
    img.src = 'broken';
    swapToOriginal({ currentTarget: img }, GET_BLOB);
    expect(img.src).toBe('broken');
  });

  it('does nothing when there is no original to fall back to', () => {
    const img = { src: 'https://example.com/a.jpg', dataset: {} };
    swapToOriginal({ currentTarget: img }, null);
    expect(img.src).toBe('https://example.com/a.jpg');
  });
});
