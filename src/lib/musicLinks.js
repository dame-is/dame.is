// Derive Apple Music + Spotify URLs from a teal.fm play record, or from an
// album's worth of them.
//
// We only ever have a single origin URL (the service the play came from) and
// some metadata (track, artist, ISRC). For the *other* service we fall back to
// a search URL — opening the search results lets the user pick the right match
// without us having to know the foreign service's track id.

import { playArtistNames, playOriginUrl, playTrackName } from './teal.js';

const APPLE_DOMAINS = ['music.apple.com'];
const SPOTIFY_DOMAINS = ['open.spotify.com', 'spotify.com'];

// Apple addresses its catalogue per storefront and the lookup API answers from
// the US one by default, so that's the store these links open in. Apple
// redirects a visitor to their own store when the release exists there.
const APPLE_STOREFRONT = 'us';

function hostMatches(url, domains) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Build a "track artist" search query string. Returns `null` if there's not
 * enough metadata to bother sending the user to a search page.
 */
function searchQuery(payload) {
  const track = playTrackName(payload);
  if (!track) return null;
  return [track, playArtistNames(payload).join(' ')].filter(Boolean).join(' ');
}

/**
 * Returns `[{ service, label, url, kind }]` for the streaming-service links
 * we can offer. `kind` is `'direct'` when we have a real link to the exact
 * track on that service, `'search'` when we only have a query.
 */
export function musicLinksFor(payload) {
  if (!payload) return [];
  const origin = playOriginUrl(payload);
  const query = searchQuery(payload);
  const encoded = query ? encodeURIComponent(query) : null;

  const apple = hostMatches(origin, APPLE_DOMAINS)
    ? { service: 'apple', label: 'Apple Music', url: origin, kind: 'direct' }
    : encoded
      ? {
          service: 'apple',
          label: 'Apple Music',
          url: `https://music.apple.com/us/search?term=${encoded}`,
          kind: 'search',
        }
      : null;

  const spotify = hostMatches(origin, SPOTIFY_DOMAINS)
    ? { service: 'spotify', label: 'Spotify', url: origin, kind: 'direct' }
    : encoded
      ? {
          service: 'spotify',
          label: 'Spotify',
          url: `https://open.spotify.com/search/${encoded}`,
          kind: 'search',
        }
      : null;

  return [apple, spotify].filter(Boolean);
}

/**
 * The Apple Music ALBUM page an Apple track URL sits on, or null.
 *
 *   https://music.apple.com/us/album/juna/1742301413?i=1742301428
 *
 * The path id is the release and the `?i=` query names one song on it, so
 * dropping the query is the album. A `/song/…` URL carries no release id at
 * all and gets nothing back rather than a link to the wrong thing.
 */
function appleAlbumUrlFrom(url) {
  if (!hostMatches(url, APPLE_DOMAINS)) return null;
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^(.*\/album\/(?:[^/]+\/)?\d+)\/?$/);
    return m ? `${u.origin}${m[1]}` : null;
  } catch {
    return null;
  }
}

/**
 * Returns `[{ service, label, url, kind }]` for one ALBUM — the same shape
 * `musicLinksFor` gives a track, so both render through the same component.
 *
 * An album has no origin URL of its own; the plays do. Apple gets a real link
 * whenever we know the release: from `albumId` (Apple's own id for it, which
 * comes back with the artwork lookup) or, failing that, from the album URL
 * hiding inside one of its plays' Apple track links. Spotify is always a
 * search — its track URLs say nothing about the release they're off, and there
 * is no unauthenticated way to ask.
 */
export function albumLinksFor(album, { albumId = null } = {}) {
  const title = String(album?.title || '').trim();
  if (!title) return [];
  const artist = String(album?.artist || '').trim();
  const term = [title, artist].filter(Boolean).join(' ');
  const encoded = encodeURIComponent(term);

  const appleDirect =
    (albumId && `https://music.apple.com/${APPLE_STOREFRONT}/album/${encodeURIComponent(albumId)}`) ||
    appleAlbumUrlFrom(playOriginUrl(album?.sample));

  return [
    appleDirect
      ? { service: 'apple', label: 'Apple Music', url: appleDirect, kind: 'direct' }
      : {
          service: 'apple',
          label: 'Apple Music',
          url: `https://music.apple.com/${APPLE_STOREFRONT}/search?term=${encoded}`,
          kind: 'search',
        },
    {
      service: 'spotify',
      label: 'Spotify',
      // The `/albums` tab, so the results are releases rather than the loose
      // tracks a bare query leads with.
      url: `https://open.spotify.com/search/${encoded}/albums`,
      kind: 'search',
    },
  ];
}
