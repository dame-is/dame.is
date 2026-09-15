// Where a play — or a whole record — can actually be listened to.
//
// The interesting half is `kind`. A `direct` link claims we know exactly which
// thing on that service is meant; a `search` link admits we're handing over a
// query. Getting that wrong sends somebody to the wrong album and tells them it
// is the right one, so the cases below are mostly about which is which.

import { describe, it, expect } from 'vitest';
import { albumLinksFor, musicLinksFor } from './musicLinks.js';

const APPLE_TRACK = 'https://music.apple.com/us/album/juna/1742301413?i=1742301428';
const SPOTIFY_TRACK = 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8';

const play = (over = {}) => ({
  trackName: 'Juna',
  artists: [{ artistName: 'Clairo' }],
  releaseName: 'Charm',
  ...over,
});

const byService = (links) => Object.fromEntries(links.map((l) => [l.service, l]));

describe('musicLinksFor — one play', () => {
  it('links straight to the song it came from, and searches the other service', () => {
    const { apple, spotify } = byService(musicLinksFor(play({ originUri: APPLE_TRACK })));
    expect(apple).toMatchObject({ kind: 'direct', url: APPLE_TRACK });
    expect(spotify.kind).toBe('search');
    expect(spotify.url).toContain(encodeURIComponent('Juna Clairo'));
  });

  it('works the other way round', () => {
    const { apple, spotify } = byService(musicLinksFor(play({ originUri: SPOTIFY_TRACK })));
    expect(spotify).toMatchObject({ kind: 'direct', url: SPOTIFY_TRACK });
    expect(apple.kind).toBe('search');
  });

  it('offers nothing for a play with no track name to search on', () => {
    expect(musicLinksFor({ artists: [{ artistName: 'Clairo' }] })).toEqual([]);
    expect(musicLinksFor(null)).toEqual([]);
  });
});

describe('albumLinksFor', () => {
  const album = { title: 'Charm', artist: 'Clairo', sample: play({ originUri: APPLE_TRACK }) };

  it('links straight to the record when Apple’s id for it is known', () => {
    const { apple } = byService(albumLinksFor(album, { albumId: '1742301413' }));
    expect(apple).toMatchObject({
      kind: 'direct',
      url: 'https://music.apple.com/us/album/1742301413',
    });
  });

  it('falls back to the album hiding inside one of its plays', () => {
    // An Apple track URL is `…/album/{slug}/{albumId}?i={songId}`: the path id
    // is the release, so dropping the query is the album page.
    const { apple } = byService(albumLinksFor(album));
    expect(apple).toMatchObject({
      kind: 'direct',
      url: 'https://music.apple.com/us/album/juna/1742301413',
    });
  });

  it('reads the alpha lexicon’s spelling of the origin too', () => {
    const { apple } = byService(
      albumLinksFor({ ...album, sample: play({ originUrl: APPLE_TRACK }) }),
    );
    expect(apple.kind).toBe('direct');
  });

  it('takes an album URL that is already one, unchanged', () => {
    const { apple } = byService(
      albumLinksFor({
        ...album,
        sample: play({ originUri: 'https://music.apple.com/us/album/charm/1742301413' }),
      }),
    );
    expect(apple.url).toBe('https://music.apple.com/us/album/charm/1742301413');
  });

  it('searches rather than guessing when the origin names no release', () => {
    // A `/song/…` URL carries no album id, and a Spotify track URL says nothing
    // about the record it is off — a link built from either would be a link to
    // the wrong thing, presented as the right one.
    for (const origin of [
      'https://music.apple.com/us/song/juna/1742301428',
      SPOTIFY_TRACK,
      'https://example.com/whatever',
      undefined,
    ]) {
      const { apple } = byService(albumLinksFor({ ...album, sample: play({ originUri: origin }) }));
      expect(apple.kind).toBe('search');
      expect(apple.url).toContain(encodeURIComponent('Charm Clairo'));
    }
  });

  it('always sends Spotify to its album results, never claiming a direct hit', () => {
    const { spotify } = byService(albumLinksFor(album, { albumId: '1742301413' }));
    expect(spotify.kind).toBe('search');
    expect(spotify.url).toBe(
      `https://open.spotify.com/search/${encodeURIComponent('Charm Clairo')}/albums`,
    );
  });

  it('searches on the title alone for a record with no artist', () => {
    const { apple } = byService(albumLinksFor({ title: 'Charm' }));
    expect(apple.url).toContain(encodeURIComponent('Charm'));
  });

  it('offers nothing for an album with no name', () => {
    expect(albumLinksFor({ title: '  ', artist: 'Clairo' })).toEqual([]);
    expect(albumLinksFor(null)).toEqual([]);
  });

  it('gives a play row and an album row the same shape', () => {
    // Both render through <MusicServiceLinks>, so they have to agree.
    const keys = (l) => Object.keys(l).sort();
    expect(albumLinksFor(album).map(keys)).toEqual(
      musicLinksFor(play({ originUri: APPLE_TRACK })).map(keys),
    );
  });
});
