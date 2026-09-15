// Albums are derived, not stored, which makes the derivation the thing worth
// testing: the same function runs in the browser, in the build script, and at
// the edge, and a page and the card that links to it agreeing about what an
// album contains depends on it giving one answer.

import { describe, it, expect } from 'vitest';
import {
  albumCardCopy,
  albumIdentity,
  albumPath,
  albumsFromSnapshot,
  albumSlug,
  albumSummaryParts,
  buildAlbums,
  compareAlbumsRecent,
  findAlbum,
  formatListenTime,
} from './albums.js';

const DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
const PROD = 'fm.teal.feed.play';
const ALPHA = 'fm.teal.alpha.feed.play';

/** A play record in the shape listTealPlays and the listening snapshot give. */
const play = (rkey, over = {}, nsid = PROD) => ({
  uri: `at://${DID}/${nsid}/${rkey}`,
  value: {
    $type: nsid,
    trackName: 'Enough for Love',
    artists: [{ artistName: 'Kelela' }],
    releaseName: 'Raven',
    duration: 300,
    playedTime: '2026-03-04T10:00:00Z',
    ...over,
  },
});

/** The same play as a unified-feed item, which is what the pages carry. */
const item = (rkey, over = {}) => {
  const r = play(rkey, over);
  return { atUri: r.uri, payload: r.value, createdAt: r.value.playedTime };
};

describe('albumIdentity', () => {
  it('keys an album on its release and primary artist', () => {
    expect(albumIdentity(play('a').value)).toEqual({
      key: 'raven|kelela',
      title: 'Raven',
      artist: 'Kelela',
    });
  });

  it('folds case and whitespace into the key but not the display text', () => {
    const id = albumIdentity({ releaseName: '  RAVEN ', artists: [{ artistName: 'Kelela' }] });
    expect(id.key).toBe('raven|kelela');
    expect(id.title).toBe('RAVEN');
  });

  it('is nothing for a scrobble that named no release', () => {
    // A play with no releaseName is a single as far as this site can tell, and
    // inventing an album for it would put a made-up page on the map.
    expect(albumIdentity({ trackName: 'Enough for Love' })).toBeNull();
    expect(albumIdentity({ releaseName: '   ' })).toBeNull();
    expect(albumIdentity(null)).toBeNull();
  });

  it('reads the deprecated artistNames spelling too', () => {
    const id = albumIdentity({ releaseName: 'Raven', artistNames: ['Kelela', 'Asmara'] });
    expect(id.key).toBe('raven|kelela');
  });

  it('keeps two records of the same name by different people apart', () => {
    const a = albumIdentity({ releaseName: 'Home', artists: [{ artistName: 'Caribou' }] });
    const b = albumIdentity({ releaseName: 'Home', artists: [{ artistName: 'Rudimental' }] });
    expect(a.key).not.toBe(b.key);
  });
});

describe('albumSlug', () => {
  it('reads as the record it names', () => {
    expect(albumSlug('Raven', 'Kelela')).toBe('raven-by-kelela');
    expect(albumSlug('In Rainbows', 'Radiohead')).toBe('in-rainbows-by-radiohead');
  });

  it('folds punctuation, accents and ampersands', () => {
    expect(albumSlug("Café Bleu", 'The Style Council')).toBe('cafe-bleu-by-the-style-council');
    expect(albumSlug('Rock & Roll', 'X')).toBe('rock-and-roll-by-x');
    expect(albumSlug('!!!', 'Chk Chk Chk')).toBe('chk-chk-chk');
  });

  it('is stable — the same album always addresses the same page', () => {
    expect(albumSlug('Raven', 'Kelela')).toBe(albumSlug('  raven ', 'KELELA'));
  });

  it('falls back to a hash when nothing survives the fold', () => {
    // A title written entirely in a non-Latin script slugs to the empty string,
    // and an album with no address is an album with no page.
    const slug = albumSlug('さよなら', 'はっぴいえんど');
    expect(slug).toMatch(/^album-[a-z0-9]+$/);
    expect(slug).toBe(albumSlug('さよなら', 'はっぴいえんど'));
    expect(slug).not.toBe(albumSlug('さよなら', '別の人'));
  });

  it('has no address for an album with no name at all', () => {
    expect(albumSlug('', '')).toBe('');
    expect(albumPath({ title: '', artist: '' })).toBeNull();
  });
});

describe('buildAlbums', () => {
  const plays = [
    play('1', { playedTime: '2026-03-04T10:00:00Z' }),
    play('2', { trackName: 'Contact', playedTime: '2026-03-05T10:00:00Z', duration: 240 }),
    play('3', { trackName: 'Contact', playedTime: '2026-03-06T10:00:00Z', duration: 240 }),
    play('4', {
      releaseName: 'In Rainbows',
      trackName: 'Nude',
      artists: [{ artistName: 'Radiohead' }],
      playedTime: '2026-03-07T10:00:00Z',
      duration: 255,
    }),
    // No release: a single, and no album of its own.
    play('5', { releaseName: undefined, trackName: 'Untitled', playedTime: '2026-03-08T10:00:00Z' }),
  ];

  it('groups plays into albums, most played first', () => {
    const albums = buildAlbums(plays);
    expect(albums.map((a) => a.title)).toEqual(['Raven', 'In Rainbows']);
    expect(albums[0].plays).toBe(3);
    expect(albums[0].tracks).toBe(2);
    expect(albums[1].plays).toBe(1);
  });

  it('counts a track once per play and orders tracks by play count', () => {
    const [raven] = buildAlbums(plays);
    expect(raven.trackList.map((t) => [t.name, t.plays])).toEqual([
      ['Contact', 2],
      ['Enough for Love', 1],
    ]);
  });

  it('records the span of an album and the play that closed it', () => {
    const [raven] = buildAlbums(plays);
    expect(raven.firstPlayed).toBe('2026-03-04T10:00:00Z');
    expect(raven.lastPlayed).toBe('2026-03-06T10:00:00Z');
    expect(raven.lastUri).toBe(`at://${DID}/${PROD}/3`);
    expect(raven.seconds).toBe(300 + 240 + 240);
  });

  it('reads feed items and raw records the same way', () => {
    const fromRecords = buildAlbums([play('1'), play('2', { trackName: 'Contact' })]);
    const fromItems = buildAlbums([item('1'), item('2', { trackName: 'Contact' })]);
    expect(fromItems).toEqual(fromRecords);
  });

  it('spans teal.fm’s namespace move — one archive, not two', () => {
    const albums = buildAlbums([
      play('1'),
      play('2', { trackName: 'Contact' }, ALPHA),
    ]);
    expect(albums).toHaveLength(1);
    expect(albums[0].plays).toBe(2);
  });

  it('credits every artist on a play, not just the primary one', () => {
    const albums = buildAlbums([
      play('1', { artists: [{ artistName: 'Kelela' }, { artistName: 'Asmara' }] }),
      play('2', { artists: [{ artistName: 'Kelela' }], trackName: 'Contact' }),
    ]);
    expect(albums[0].artists).toEqual(['Kelela', 'Asmara']);
    expect(albums[0].artist).toBe('Kelela');
  });

  it('prefers the play with the strongest identifier as the art sample', () => {
    // The cover is looked up from one play, and an ISRC resolves exactly where
    // a track-and-artist search only guesses.
    const albums = buildAlbums([play('1'), play('2', { isrc: 'USRC17607839' })]);
    expect(albums[0].sample.isrc).toBe('USRC17607839');
  });

  it('caps the track list where asked, without losing the count', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      play(String(i), { trackName: `Track ${i}`, playedTime: `2026-03-${10 + i}T10:00:00Z` }),
    );
    const [album] = buildAlbums(many, { maxTracks: 5 });
    expect(album.tracks).toBe(12);
    expect(album.trackList).toHaveLength(5);
  });

  it('survives an undated or malformed play rather than poisoning the album', () => {
    const albums = buildAlbums([
      play('1', { playedTime: undefined, duration: 'not a number' }),
      null,
      { uri: 'at://x/y/z' },
    ]);
    expect(albums[0].plays).toBe(1);
    expect(albums[0].seconds).toBe(0);
    expect(albums[0].firstPlayed).toBeNull();
  });

  it('has an alternative order for reading by recency', () => {
    const albums = buildAlbums(plays).sort(compareAlbumsRecent);
    expect(albums.map((a) => a.title)).toEqual(['In Rainbows', 'Raven']);
  });
});

describe('findAlbum', () => {
  const albums = buildAlbums([play('1'), play('2', { releaseName: 'In Rainbows', artists: [{ artistName: 'Radiohead' }] })]);

  it('resolves the slug an album computes for itself', () => {
    expect(findAlbum(albums, 'raven-by-kelela').title).toBe('Raven');
    expect(findAlbum(albums, 'in-rainbows-by-radiohead').title).toBe('In Rainbows');
  });

  it('is case-insensitive and tolerant of surrounding space', () => {
    expect(findAlbum(albums, ' RAVEN-BY-KELELA ').title).toBe('Raven');
  });

  it('is nothing for a slug nothing answers to', () => {
    expect(findAlbum(albums, 'not-an-album')).toBeNull();
    expect(findAlbum(albums, '')).toBeNull();
    expect(findAlbum(null, 'raven-by-kelela')).toBeNull();
  });

  it('gives a folded slug to the most-played album that computes it', () => {
    // Two albums CAN fold onto one address; the busier one wins, deterministically.
    const collided = buildAlbums([
      play('1', { releaseName: 'Rock & Roll', artists: [{ artistName: 'X' }] }),
      play('2', { releaseName: 'Rock & Roll', artists: [{ artistName: 'X' }], trackName: 'B' }),
      play('3', { releaseName: 'Rock and Roll', artists: [{ artistName: 'X' }] }),
    ]);
    expect(collided).toHaveLength(2);
    expect(findAlbum(collided, 'rock-and-roll-by-x').plays).toBe(2);
  });

  it('resolves a snapshot album by its stored slug', () => {
    const snapshot = JSON.parse(JSON.stringify({ albums }));
    expect(findAlbum(albumsFromSnapshot(snapshot), 'raven-by-kelela').title).toBe('Raven');
  });
});

describe('albumsFromSnapshot', () => {
  it('reads the wrapper the build writes', () => {
    expect(albumsFromSnapshot({ builtAt: 'x', plays: 2, albums: [{ title: 'Raven' }] })).toHaveLength(1);
  });

  it('is empty rather than broken for anything else', () => {
    expect(albumsFromSnapshot(null)).toEqual([]);
    expect(albumsFromSnapshot({})).toEqual([]);
    expect(albumsFromSnapshot({ albums: [{ title: '' }, null] })).toEqual([]);
  });
});

describe('copy', () => {
  it('rounds listening time to hours and minutes, and says nothing under a minute', () => {
    expect(formatListenTime(0)).toBe('');
    expect(formatListenTime(45)).toBe('');
    expect(formatListenTime(300)).toBe('5 min');
    expect(formatListenTime(3600)).toBe('1 hr');
    expect(formatListenTime(3600 + 14 * 60)).toBe('1 hr 14 min');
  });

  it('summarises an album in three parts', () => {
    const [album] = buildAlbums([play('1'), play('2', { trackName: 'Contact' })]);
    expect(albumSummaryParts(album)).toEqual(['2 plays', '2 tracks', '10 min']);
  });

  it('singularises a one-play album', () => {
    const [album] = buildAlbums([play('1')]);
    expect(albumSummaryParts(album)).toEqual(['1 play', '1 track', '5 min']);
  });

  it('writes the same copy the card and the <head> both use', () => {
    const [album] = buildAlbums([play('1')]);
    const { title, description } = albumCardCopy(album);
    expect(title).toBe('Raven');
    expect(description).toContain('Raven by Kelela');
    expect(description).toContain('1 play');
    expect(description).toContain('March 2026');
  });
});

describe('albumPath', () => {
  it('addresses an album under the listening surface', () => {
    expect(albumPath({ title: 'Raven', artist: 'Kelela' })).toBe('/listening/albums/raven-by-kelela');
  });

  it('prefers a slug the album already carries', () => {
    expect(albumPath({ slug: 'stored-slug', title: 'Raven', artist: 'Kelela' })).toBe(
      '/listening/albums/stored-slug',
    );
  });
});
