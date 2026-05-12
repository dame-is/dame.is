// Derive Apple Music + Spotify URLs from a fm.teal.alpha.feed.play record.
//
// We only ever have a single `originUrl` (the service the play came from) and
// some metadata (track, artist, ISRC). For the *other* service we fall back to
// a search URL — opening the search results lets the user pick the right match
// without us having to know the foreign service's track id.

const APPLE_DOMAINS = ['music.apple.com'];
const SPOTIFY_DOMAINS = ['open.spotify.com', 'spotify.com'];

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
  const track = (payload?.trackName || payload?.track || '').trim();
  if (!track) return null;
  const artists = Array.isArray(payload?.artists)
    ? payload.artists.map((a) => a?.artistName).filter(Boolean).join(' ')
    : (payload?.artist || '');
  return [track, artists].filter(Boolean).join(' ');
}

/**
 * Returns `[{ service, label, url, kind }]` for the streaming-service links
 * we can offer. `kind` is `'direct'` when we have a real link to the exact
 * track on that service, `'search'` when we only have a query.
 */
export function musicLinksFor(payload) {
  if (!payload) return [];
  const origin = payload.originUrl || null;
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
