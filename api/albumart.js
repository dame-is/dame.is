// Vercel serverless function: resolve album art for a play via Apple's
// open iTunes Search/Lookup API.
//
// This exists because iTunes' API does NOT send an `Access-Control-Allow-
// Origin` header, so a browser fetch straight from dame.is is blocked by
// CORS and every lookup fails (blank cover placeholders). Proxying through
// our own origin sidesteps CORS entirely, and — because the response is
// CDN-cached (`s-maxage`) — the first viewer of a track warms the cache for
// everyone else, which also keeps us clear of iTunes' per-IP rate limit.
//
// Identifier ladder, most reliable first (mirrors the client's old logic):
//   1. ISRC        — recording id, universal across services.
//   2. Apple song id — exact match when the play came from Apple Music.
//   3. track + artist — last-resort fuzzy text search.

const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  return res.json();
}

async function resolve({ isrc, appleId, track, artist }) {
  if (isrc) {
    const data = await fetchJson(
      `${ITUNES_LOOKUP}?isrc=${encodeURIComponent(isrc)}&entity=song&limit=1`,
    );
    const hit = (data?.results || []).find((r) => r?.artworkUrl100);
    if (hit) return hit;
  }

  if (appleId) {
    const data = await fetchJson(
      `${ITUNES_LOOKUP}?id=${encodeURIComponent(appleId)}&entity=song&limit=1`,
    );
    const hit = (data?.results || []).find((r) => r?.artworkUrl100);
    if (hit) return hit;
  }

  if (track) {
    const term = [track, artist].filter(Boolean).join(' ');
    const data = await fetchJson(
      `${ITUNES_SEARCH}?term=${encodeURIComponent(term)}&entity=song&limit=1`,
    );
    const hit = (data?.results || []).find((r) => r?.artworkUrl100);
    if (hit) return hit;
  }

  return null;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const isrc = typeof q.isrc === 'string' ? q.isrc : '';
  const appleId = typeof q.appleId === 'string' && /^\d+$/.test(q.appleId) ? q.appleId : '';
  const track = typeof q.track === 'string' ? q.track.trim() : '';
  const artist = typeof q.artist === 'string' ? q.artist.trim() : '';

  if (!isrc && !appleId && !track) {
    return res.status(400).json({ error: 'Pass isrc, appleId, or track.' });
  }

  try {
    const hit = await resolve({ isrc, appleId, track, artist });
    // Cache hits hard and misses briefly: a freshly released track can gain
    // art later, so we don't want to pin an empty result for long.
    if (!hit?.artworkUrl100) {
      res.setHeader('cache-control', 'public, s-maxage=86400, max-age=3600');
      return res.status(200).json({ found: false });
    }
    res.setHeader(
      'cache-control',
      'public, s-maxage=2592000, max-age=86400, stale-while-revalidate=86400',
    );
    return res.status(200).json({
      found: true,
      artworkUrl100: hit.artworkUrl100,
      track: hit.trackName || null,
      artist: hit.artistName || null,
      album: hit.collectionName || null,
    });
  } catch (err) {
    // Don't let the client cache a transient upstream failure.
    res.setHeader('cache-control', 'no-store');
    return res.status(502).json({ error: err?.message || 'album art lookup failed' });
  }
}
