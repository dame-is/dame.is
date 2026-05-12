// Album art lookup for fm.teal.alpha.feed.play records.
//
// We have three identifiers to play with on every play, in order of how
// reliably they resolve to the right cover:
//
//   1. ISRC (recording identifier). Universal across services; works
//      regardless of where the play was scrobbled from.
//   2. Apple Music song id (the `?i=…` query param on `originUrl` when the
//      play came from Apple). Exact match when present.
//   3. trackName + first artistName. Last-resort fuzzy text search.
//
// We hit Apple's open iTunes Search/Lookup API for all three. It's free,
// requires no auth, is CORS-friendly, and returns an `artworkUrl100` that
// can be upscaled by swapping the `100x100bb.jpg` segment for a larger
// size — Apple actually serves whatever resolution you ask for.
//
// Results are cached in localStorage so we don't re-hit Apple on every
// re-render or page navigation. Hits are kept for 30 days, misses for 1
// day so a freshly released track can recover once its art is indexed.

const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const CACHE_KEY = 'dame:albumArtCache:v1';
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
  const ttl = entry.url ? HIT_TTL_MS : MISS_TTL_MS;
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
/* Identifier extraction                                               */
/* ------------------------------------------------------------------ */

/**
 * Extract Apple Music's numeric song id from an originUrl like
 *   https://music.apple.com/us/album/hellfire/1613170781?i=1613171030
 * Apple's lookup API takes that song id directly.
 */
function appleSongIdFrom(payload) {
  const origin = payload?.originUrl;
  if (!origin) return null;
  try {
    const u = new URL(origin);
    if (!/(^|\.)music\.apple\.com$/.test(u.hostname)) return null;
    const i = u.searchParams.get('i');
    return i && /^\d+$/.test(i) ? i : null;
  } catch {
    return null;
  }
}

function firstArtist(payload) {
  if (Array.isArray(payload?.artists)) {
    const a = payload.artists.find((x) => x?.artistName);
    return a?.artistName || '';
  }
  return payload?.artist || '';
}

function trackTitle(payload) {
  return (payload?.trackName || payload?.track || '').trim();
}

/**
 * Stable cache key for a payload. Prefers strong identifiers; falls back
 * to a normalized text key so search-based lookups also benefit from the
 * cache.
 */
function cacheKeyFor(payload) {
  const isrc = payload?.isrc;
  if (isrc) return `isrc:${String(isrc).toUpperCase()}`;
  const songId = appleSongIdFrom(payload);
  if (songId) return `apple:${songId}`;
  const track = trackTitle(payload).toLowerCase();
  const artist = firstArtist(payload).toLowerCase();
  if (track && artist) return `text:${track}|${artist}`;
  if (track) return `text:${track}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* iTunes API                                                          */
/* ------------------------------------------------------------------ */

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  return res.json();
}

/**
 * Resolve a payload to a result row from iTunes Search/Lookup. Walks the
 * identifier ladder: ISRC → Apple song id → free-text search.
 */
async function resolveResult(payload) {
  const isrc = payload?.isrc;
  if (isrc) {
    const data = await fetchJson(
      `${ITUNES_LOOKUP}?isrc=${encodeURIComponent(isrc)}&entity=song&limit=1`,
    );
    const hit = (data?.results || []).find((r) => r?.artworkUrl100);
    if (hit) return hit;
  }

  const songId = appleSongIdFrom(payload);
  if (songId) {
    const data = await fetchJson(
      `${ITUNES_LOOKUP}?id=${encodeURIComponent(songId)}&entity=song&limit=1`,
    );
    const hit = (data?.results || []).find((r) => r?.artworkUrl100);
    if (hit) return hit;
  }

  const track = trackTitle(payload);
  const artist = firstArtist(payload);
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

/**
 * Replace the `100x100bb.jpg` (or whatever sized) suffix on Apple's
 * artwork URL with the requested size. Apple serves any size the URL
 * asks for. Falls back to the original URL if the pattern doesn't match.
 */
function upscaleArtwork(url, size) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb(-\d+)?\.(jpg|png|jpeg)$/i, `/${size}x${size}bb.jpg`);
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
  const key = cacheKeyFor(payload);
  if (!key) return null;

  const cached = cacheGet(key);
  if (cached) {
    if (!cached.url) return null;
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
        cacheSet(key, { url: null });
        return null;
      }
      const entry = {
        artworkUrl100: hit.artworkUrl100,
        track: hit.trackName || null,
        artist: hit.artistName || null,
        album: hit.collectionName || null,
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
