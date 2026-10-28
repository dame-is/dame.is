import { describe, it, expect } from 'vitest';
import { avatarThumb } from './avatarThumb.js';

describe('avatarThumb', () => {
  const did = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
  const cid = 'bafkreigdbgqh4ko3kbkcjmcuq5z2ubnyqeoc5ghuzv5ekzlspeasvx3fma';

  it('asks the CDN for the 128px copy of a full-size avatar', () => {
    expect(
      avatarThumb(`https://cdn.bsky.app/img/avatar/plain/${did}/${cid}@jpeg`),
    ).toBe(
      `https://cdn.bsky.app/img/avatar_thumbnail/plain/${did}/${cid}@jpeg`,
    );
  });

  it('leaves everything else exactly as it was', () => {
    const thumb = `https://cdn.bsky.app/img/avatar_thumbnail/plain/${did}/${cid}@jpeg`;
    expect(avatarThumb(thumb)).toBe(thumb);
    const feed = `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`;
    expect(avatarThumb(feed)).toBe(feed);
    const elsewhere = 'https://example.com/img/avatar/plain/x.jpg';
    expect(avatarThumb(elsewhere)).toBe(elsewhere);
    expect(avatarThumb('')).toBe('');
    expect(avatarThumb(null)).toBeNull();
    expect(avatarThumb(undefined)).toBeUndefined();
  });
});
