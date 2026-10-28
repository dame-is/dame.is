import { describe, it, expect } from 'vitest';
import {
  NONE_SENTINEL,
  filterPostingItems,
  postTypesParam,
  postingCategories,
  postingCounts,
  resolveActivePostingTypes,
} from './postingFilter.js';

const ME = 'did:plc:me';
const OTHER = 'did:plc:someone';
const uri = (did, rkey) => `at://${did}/app.bsky.feed.post/${rkey}`;

const post = (
  rkey,
  {
    replyTo = null,
    embed = null,
    text = 'hello',
    at = '2026-10-01T10:00:00Z',
  } = {},
) => ({
  verb: 'posting',
  atUri: uri(ME, rkey),
  createdAt: at,
  payload: {
    text,
    embed,
    reply: replyTo
      ? { parent: { uri: replyTo }, root: { uri: replyTo } }
      : null,
  },
});

const params = (s = '') => new URLSearchParams(s);
const cats = (item) => Array.from(postingCategories(item) || []).sort();

describe('postingCategories', () => {
  it('files a quote with a link card as a quote and a link, not an image', () => {
    const item = post('a', {
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        media: { $type: 'app.bsky.embed.external#view' },
      },
    });
    expect(cats(item)).toEqual(['link', 'quote']);
  });

  it('files a quote with pictures as a quote and an image', () => {
    const item = post('a', {
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        media: { $type: 'app.bsky.embed.images#view' },
      },
    });
    expect(cats(item)).toEqual(['image', 'quote']);
  });

  it('counts a video with the media, not as text', () => {
    expect(
      cats(post('a', { embed: { $type: 'app.bsky.embed.video#view' } })),
    ).toEqual(['image']);
  });

  it('keeps the plain cases as they were', () => {
    expect(cats(post('a'))).toEqual(['text']);
    expect(
      cats(post('a', { embed: { $type: 'app.bsky.embed.images#view' } })),
    ).toEqual(['image']);
    expect(
      cats(post('a', { embed: { $type: 'app.bsky.embed.external#view' } })),
    ).toEqual(['link']);
    expect(
      cats(post('a', { embed: { $type: 'app.bsky.embed.record#view' } })),
    ).toEqual(['quote']);
    expect(cats(post('a', { replyTo: uri(OTHER, 'x') }))).toEqual(['reply']);
    expect(postingCategories({ verb: 'liking' })).toBeNull();
  });
});

describe('filterPostingItems', () => {
  const root = post('1', { at: '2026-10-01T10:00:00Z' });
  const next = post('2', { replyTo: root.atUri, at: '2026-10-01T10:01:00Z' });
  const last = post('3', { replyTo: next.atUri, at: '2026-10-01T10:02:00Z' });
  const replyToOther = post('4', {
    replyTo: uri(OTHER, 'x'),
    at: '2026-10-01T11:00:00Z',
  });
  const items = [replyToOther, last, next, root];

  it('keeps a thread whole under the default filter', () => {
    // Text-only continuations of Dame's own thread are the thread, not replies.
    const shown = filterPostingItems(items, params(), ME).map((i) => i.atUri);
    expect(shown).toEqual([last.atUri, next.atUri, root.atUri]);
  });

  it('still hides a reply to someone else', () => {
    const shown = filterPostingItems(items, params(), ME);
    expect(shown).not.toContain(replyToOther);
  });

  it('reads every continuation as a reply when no DID is given', () => {
    const shown = filterPostingItems(items, params(), null).map((i) => i.atUri);
    expect(shown).toEqual([root.atUri]);
  });

  it('shows nothing when every type is switched off', () => {
    expect(
      filterPostingItems(items, params(`postTypes=${NONE_SENTINEL}`), ME),
    ).toEqual([]);
  });
});

describe('postingCounts', () => {
  it('counts only standalone replies as replies', () => {
    const root = post('1');
    const next = post('2', { replyTo: root.atUri });
    const other = post('3', { replyTo: uri(OTHER, 'x') });
    expect(postingCounts([root, next, other], ME)).toEqual({
      text: 2,
      reply: 1,
    });
  });
});

describe('postTypesParam', () => {
  it('writes the none sentinel for an empty set, since an empty list means all', () => {
    // Unchecking the last chip must show nothing, not flood back every post.
    expect(postTypesParam(new Set())).toBe(NONE_SENTINEL);
    expect(
      resolveActivePostingTypes(
        params(`postTypes=${postTypesParam(new Set())}`),
      ).size,
    ).toBe(0);
    expect(postTypesParam(new Set(['image', 'link']))).toBe('image,link');
  });

  it('leaves an explicit empty postTypes meaning every type', () => {
    expect(resolveActivePostingTypes(params('postTypes=')).size).toBe(5);
  });
});
