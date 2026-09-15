// Album art lookup for teal.fm play records — the browser half.
//
// The identifiers a play carries (ISRC, Apple song id, track + artist) and the
// order to try them in live in src/lib/musicIds.js, because the same ladder is
// climbed server-side by the /api/albumart proxy and by the OG card renderer.
// This module is what a component calls: cache, de-duplicate, ask the proxy.
//
// The lookup goes through our own `/api/albumart` serverless proxy rather
// than hitting iTunes from the browser directly: Apple's API sends no CORS
// header, so a direct fetch is blocked and every cover falls back to a
// blank placeholder. The proxy also CDN-caches results, so the first viewer
// of a track warms the art for everyone. Apple returns an `artworkUrl100`
// that can be upscaled by swapping the `100x100bb.jpg` segment for a larger
// size — Apple serves whatever resolution the URL asks for.
//
// Results are also cached in localStorage so we don't re-hit the proxy on
// every re-render or page navigation. Hits are kept for 30 days, misses for
// 1 day so a freshly released track can recover once its art is indexed.

import { artCacheKey, artLookupFor, upscaleArtwork } from './musicIds.js';

const ALBUM_ART_ENDPOINT = '/api/albumart';
// v2: v1 read/wrote the cache on mismatched fields (stored `artworkUrl100`,
// checked `url`), so every hit was read back as a miss and covers vanished
// on reload. Bumping the key discards those poisoned entries.
const CACHE_KEY = 'dame:albumArtCache:v2';
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

// In-flight de-duplication. Two components asking for the same key in the
// same tick should share one fetch.
const inflight = new Map();

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be unavailable (private mode, quota); ignore.
  }
}

function cacheGet(key) {
  if (!key) return undefined;
  const cache = readCache();
  const entry = cache[key];
  if (!entry) return undefined;
  const ttl = entry.artworkUrl100 ? HIT_TTL_MS : MISS_TTL_MS;
  if (Date.now() - (entry.t || 0) > ttl) return undefined;
  return entry;
}

function cacheSet(key, entry) {
  if (!key) return;
  const cache = readCache();
  cache[key] = { ...entry, t: Date.now() };
  writeCache(cache);
}

/* ------------------------------------------------------------------ */
/* iTunes API                                                          */
/* ------------------------------------------------------------------ */

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`album art ${res.status}`);
  return res.json();
}

/**
 * Resolve a payload to an artwork row via our `/api/albumart` proxy, which
 * walks the identifier ladder (ISRC → Apple song id → free-text search)
 * server-side. Returns a row with `artworkUrl100`, or null on a miss.
 */
async function resolveResult(payload) {
  const params = new URLSearchParams(artLookupFor(payload));
  if (![...params.keys()].length) return null;

  const data = await fetchJson(`${ALBUM_ART_ENDPOINT}?${params}`);
  return data?.found && data.artworkUrl100 ? data : null;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve album art for a play payload. Returns
 *   { url, thumbUrl, track, artist, album, source: 'itunes' }
 * on a hit, or `null` on a miss. Cached aggressively in localStorage.
 *
 * Pass `{ size }` to control the artwork resolution (default 600).
 */
export async function albumArtFor(payload, { size = 600 } = {}) {
  const key = artCacheKey(payload);
  if (!key) return null;

  const cached = cacheGet(key);
  if (cached) {
    if (!cached.artworkUrl100) return null;
    return {
      ...cached,
      url: upscaleArtwork(cached.artworkUrl100, size),
      thumbUrl: upscaleArtwork(cached.artworkUrl100, 100),
    };
  }

  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const hit = await resolveResult(payload);
      if (!hit?.artworkUrl100) {
        cacheSet(key, { artworkUrl100: null });
        return null;
      }
      const entry = {
        artworkUrl100: hit.artworkUrl100,
        track: hit.track || null,
        artist: hit.artist || null,
        album: hit.album || null,
        source: 'itunes',
      };
      cacheSet(key, entry);
      return {
        ...entry,
        url: upscaleArtwork(hit.artworkUrl100, size),
        thumbUrl: upscaleArtwork(hit.artworkUrl100, 100),
      };
    } catch {
      // Don't poison the cache on transient network errors — let the next
      // call retry.
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
