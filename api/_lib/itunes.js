// Apple's open iTunes Search/Lookup API, server-side.
//
// Two callers, one ladder: `api/albumart.js` is the CORS proxy the browser asks
// (Apple sends no `Access-Control-Allow-Origin`, so a direct fetch from dame.is
// is blocked and every cover falls back to a blank square), and `api/og.js`
// resolves a cover while drawing a listening card, where there is no browser to
// ask on its behalf.
//
// Identifier ladder, most reliable first — the same one src/lib/musicIds.js
// extracts from a play:
//   1. ISRC          — recording id, universal across services.
//   2. Apple song id — exact match when the play came from Apple Music.
//   3. track + artist — last-resort fuzzy text search.

const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

/** How long any one iTunes request gets before the caller goes without. */
const ITUNES_TIMEOUT_MS = 4000;

async function fetchJson(url, timeoutMs = ITUNES_TIMEOUT_MS) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  return res.json();
}

/**
 * The first catalogue row carrying artwork for these identifiers, or null.
 * Throws on an upstream failure so the caller can tell a miss (Apple has no
 * such track) from a wobble (don't cache that).
 */
export async function lookupArtwork(
  { isrc, appleId, track, artist },
  { timeoutMs } = {},
) {
  if (isrc) {
    const data = await fetchJson(
      `${ITUNES_LOOKUP}?isrc=${encodeURIComponent(isrc)}&entity=song&limit=1`,
      timeoutMs,
    );
    const hit = (data?.results || []).find((r) => r?.artworkUrl100);
    if (hit) return hit;
  }

  if (appleId) {
    const data = await fetchJson(
      `${ITUNES_LOOKUP}?id=${encodeURIComponent(appleId)}&entity=song&limit=1`,
      timeoutMs,
    );
    const hit = (data?.results || []).find((r) => r?.artworkUrl100);
    if (hit) return hit;
  }

  if (track) {
    const term = [track, artist].filter(Boolean).join(' ');
    const data = await fetchJson(
      `${ITUNES_SEARCH}?term=${encodeURIComponent(term)}&entity=song&limit=1`,
      timeoutMs,
    );
    const hit = (data?.results || []).find((r) => r?.artworkUrl100);
    if (hit) return hit;
  }

  return null;
}

/** `{ artworkUrl100, track, artist, album, albumId }` — what /api/albumart serves. */
export function artworkRow(hit) {
  if (!hit?.artworkUrl100) return null;
  return {
    artworkUrl100: hit.artworkUrl100,
    track: hit.trackName || null,
    artist: hit.artistName || null,
    album: hit.collectionName || null,
    // Apple's id for the RELEASE the matched recording sits on — what a link to
    // the album is built from. `collectionViewUrl` is NOT that link: on a song
    // result it comes back identical to `trackViewUrl`, still carrying the `?i=`
    // that names the song rather than the record it's off.
    albumId: hit.collectionId ? String(hit.collectionId) : null,
  };
}
