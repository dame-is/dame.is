import { describe, expect, it } from 'vitest';
import { embedMarks, linkHost, THUMB_MAX } from './ratioedEmbed.js';

const images = (n) => ({
  $type: 'app.bsky.embed.images#view',
  images: Array.from({ length: n }, (_, i) => ({
    thumb: `https://cdn.example/t${i}.jpg`,
    fullsize: `https://cdn.example/f${i}.jpg`,
    alt: i === 0 ? 'a cat' : '',
  })),
});

describe('linkHost', () => {
  it('drops the www', () => {
    expect(linkHost('https://www.nytimes.com/x')).toBe('nytimes.com');
  });
  it('keeps other subdomains', () => {
    expect(linkHost('https://blog.example.co.uk/x')).toBe('blog.example.co.uk');
  });
  it('is empty for anything that is not a URL', () => {
    expect(linkHost('not a url')).toBe('');
    expect(linkHost('')).toBe('');
    expect(linkHost(undefined)).toBe('');
  });
});

describe('embedMarks', () => {
  it('says nothing about nothing', () => {
    expect(embedMarks(null)).toEqual([]);
    expect(embedMarks(undefined)).toEqual([]);
    expect(embedMarks({})).toEqual([]);
    expect(embedMarks('app.bsky.embed.images#view')).toEqual([]);
  });

  it('ignores an embed type it does not know', () => {
    expect(embedMarks({ $type: 'com.example.embed.hologram' })).toEqual([]);
  });

  it('counts images and pluralises', () => {
    expect(embedMarks(images(1))[0].label).toBe('1 image');
    expect(embedMarks(images(3))[0].label).toBe('3 images');
  });

  it('carries the author’s alt text through to the thumbnail', () => {
    const [mark] = embedMarks(images(2));
    expect(mark.thumbs[0]).toEqual({ src: 'https://cdn.example/t0.jpg', alt: 'a cat' });
    expect(mark.thumbs[1].alt).toBe('');
  });

  it('caps the thumbnails but not the count', () => {
    const [mark] = embedMarks(images(4));
    expect(mark.count).toBe(4);
    expect(mark.label).toBe('4 images');
    expect(mark.thumbs).toHaveLength(THUMB_MAX);
  });

  it('drops a thumbnail with no URL rather than rendering a broken one', () => {
    const embed = { $type: 'app.bsky.embed.images#view', images: [{ alt: 'x' }, { thumb: 'u' }] };
    expect(embedMarks(embed)[0].thumbs).toEqual([{ src: 'u', alt: '' }]);
  });

  it('says nothing for an images embed carrying no images', () => {
    expect(embedMarks({ $type: 'app.bsky.embed.images#view', images: [] })).toEqual([]);
  });

  it('marks a video, with its poster frame when there is one', () => {
    const [mark] = embedMarks({
      $type: 'app.bsky.embed.video#view',
      thumbnail: 'https://cdn.example/v.jpg',
      alt: 'a clip',
    });
    expect(mark.kind).toBe('video');
    expect(mark.label).toBe('video');
    expect(mark.thumbs).toEqual([{ src: 'https://cdn.example/v.jpg', alt: 'a clip' }]);
  });

  it('marks a video with no poster frame', () => {
    expect(embedMarks({ $type: 'app.bsky.embed.video#view' })[0].thumbs).toEqual([]);
  });

  it('marks a link by its host', () => {
    const [mark] = embedMarks({
      $type: 'app.bsky.embed.external#view',
      external: { uri: 'https://www.theguardian.com/a/b', title: 'A headline' },
    });
    expect(mark).toMatchObject({ kind: 'link', label: 'theguardian.com', thumbs: [] });
  });

  it('falls back to the word when a link has no readable host', () => {
    const embed = { $type: 'app.bsky.embed.external#view', external: { uri: 'nonsense' } };
    expect(embedMarks(embed)[0].label).toBe('link');
  });

  it('names a quoted post by its author', () => {
    const [mark] = embedMarks({
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.embed.record#viewRecord',
        author: { handle: 'mackuba.eu' },
      },
    });
    expect(mark).toMatchObject({ kind: 'quote', label: '@mackuba.eu' });
  });

  it('still marks a quote whose post is gone, blocked or detached', () => {
    const of = (t) =>
      embedMarks({ $type: 'app.bsky.embed.record#view', record: { $type: t } })[0].label;
    expect(of('app.bsky.embed.record#viewNotFound')).toBe('a post that is gone');
    expect(of('app.bsky.embed.record#viewDetached')).toBe('a post that is gone');
    expect(of('app.bsky.embed.record#viewBlocked')).toBe('a blocked post');
  });

  it('names a quoted feed, list and starter pack', () => {
    const of = (record) => embedMarks({ $type: 'app.bsky.embed.record#view', record })[0].label;
    expect(of({ $type: 'app.bsky.feed.defs#generatorView', displayName: 'Quiet Posters' })).toBe(
      'Quiet Posters',
    );
    expect(of({ $type: 'app.bsky.graph.defs#listView', name: 'Bike people' })).toBe('Bike people');
    expect(
      of({ $type: 'app.bsky.graph.defs#starterPackViewBasic', record: { name: 'Newcomers' } }),
    ).toBe('Newcomers');
  });

  it('falls back when a quoted record names nobody', () => {
    expect(embedMarks({ $type: 'app.bsky.embed.record#view', record: {} })[0].label).toBe('a post');
  });

  // The shape the AppView actually returns, taken off a live post: the
  // `recordWithMedia` wrapper has no `$type` on it at all.
  it('unwraps the untyped wrapper a real recordWithMedia arrives in', () => {
    const marks = embedMarks({
      $type: 'app.bsky.embed.recordWithMedia#view',
      media: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://attie.ai/x' } },
      record: {
        record: {
          $type: 'app.bsky.embed.record#viewRecord',
          uri: 'at://did:plc:x/app.bsky.feed.post/y',
          author: { handle: 'quillmatiq.com' },
        },
      },
    });
    expect(marks.map((m) => m.label)).toEqual(['attie.ai', '@quillmatiq.com']);
  });

  it('does not unwrap a view that is a thing in its own right', () => {
    // A starter pack carries its own raw record under `record`. Unwrapping
    // that loses the view type, and with it the name.
    const marks = embedMarks({
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.graph.defs#starterPackViewBasic',
        uri: 'at://did:plc:x/app.bsky.graph.starterpack/y',
        record: { $type: 'app.bsky.graph.starterpack', name: 'Newcomers' },
      },
    });
    expect(marks[0].label).toBe('Newcomers');
  });

  it('marks both halves of a quote with a picture, media first', () => {
    const marks = embedMarks({
      $type: 'app.bsky.embed.recordWithMedia#view',
      media: images(2),
      record: {
        $type: 'app.bsky.embed.record#view',
        record: { $type: 'app.bsky.embed.record#viewRecord', author: { handle: 'why.bsky.team' } },
      },
    });
    expect(marks.map((m) => m.kind)).toEqual(['images', 'quote']);
    expect(marks[1].label).toBe('@why.bsky.team');
  });

  it('keeps the quote when the media half is unrecognised', () => {
    const marks = embedMarks({
      $type: 'app.bsky.embed.recordWithMedia#view',
      media: { $type: 'com.example.embed.hologram' },
      record: { $type: 'app.bsky.embed.record#viewRecord', author: { handle: 'a.b' } },
    });
    expect(marks.map((m) => m.kind)).toEqual(['quote']);
  });

  it('reads the raw record forms too, which name but cannot show', () => {
    const marks = embedMarks({
      $type: 'app.bsky.embed.external',
      external: { uri: 'https://example.com/x' },
    });
    expect(marks).toEqual([{ kind: 'link', count: 1, label: 'example.com', thumbs: [] }]);
  });
});
