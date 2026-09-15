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
// The identifier ladder itself lives in api/_lib/itunes.js, shared with the OG
// card renderer, which resolves covers with no browser to proxy for.

import { artworkRow, lookupArtwork } from './_lib/itunes.js';

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
    const row = artworkRow(await lookupArtwork({ isrc, appleId, track, artist }));
    // Cache hits hard and misses briefly: a freshly released track can gain
    // art later, so we don't want to pin an empty result for long.
    if (!row) {
      res.setHeader('cache-control', 'public, s-maxage=86400, max-age=3600');
      return res.status(200).json({ found: false });
    }
    res.setHeader(
      'cache-control',
      'public, s-maxage=2592000, max-age=86400, stale-while-revalidate=86400',
    );
    return res.status(200).json({ found: true, ...row });
  } catch (err) {
    // Don't let the client cache a transient upstream failure.
    res.setHeader('cache-control', 'no-store');
    return res.status(502).json({ error: err?.message || 'album art lookup failed' });
  }
}
