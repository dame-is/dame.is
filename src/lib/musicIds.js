// The identifiers a teal.fm play carries that Apple's catalogue will answer to.
//
// Pulled out of src/lib/albumArt.js so the same ladder can be climbed from
// three places without three copies of it: the browser (which asks our own
// /api/albumart proxy, because Apple sends no CORS header), the proxy itself,
// and the OG card renderer, which resolves a cover server-side and inlines the
// bytes. The order below is the order of how reliably each one lands on the
// right recording — nothing here fetches anything.

import { playArtistNames, playOriginUrl, playTrackName } from './teal.js';

/**
 * Apple Music's numeric SONG id, from an origin URL like
 *   https://music.apple.com/us/album/hellfire/1613170781?i=1613171030
 * The `?i=` is the song; the path id is the album. Apple's lookup API takes the
 * song id directly. Null unless the play actually came from Apple Music.
 */
export function appleSongIdFrom(payload) {
  const origin = playOriginUrl(payload);
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

/**
 * `{ isrc, appleId, track, artist }` for a play — the arguments every lookup
 * here takes. Keys with nothing behind them are left off, so an empty object
 * means the play carries no identifier worth a request.
 */
export function artLookupFor(payload) {
  const out = {};
  if (payload?.isrc) out.isrc = String(payload.isrc);
  const appleId = appleSongIdFrom(payload);
  if (appleId) out.appleId = appleId;
  const track = playTrackName(payload);
  if (track) out.track = track;
  const artist = playArtistNames(payload)[0] || '';
  if (artist) out.artist = artist;
  return out;
}

/**
 * A stable cache key for a play's artwork, preferring strong identifiers and
 * falling back to normalized text so search-based lookups cache too. Null when
 * there is nothing to key on.
 */
export function artCacheKey(payload) {
  const { isrc, appleId, track, artist } = artLookupFor(payload);
  if (isrc) return `isrc:${isrc.toUpperCase()}`;
  if (appleId) return `apple:${appleId}`;
  if (track && artist) return `text:${track.toLowerCase()}|${artist.toLowerCase()}`;
  if (track) return `text:${track.toLowerCase()}`;
  return null;
}

/**
 * Replace the `100x100bb.jpg` (or whatever sized) suffix on Apple's artwork URL
 * with the requested size — Apple serves any size the URL asks for. Falls back
 * to the original URL when the pattern doesn't match.
 */
export function upscaleArtwork(url, size) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb(-\d+)?\.(jpg|png|jpeg)$/i, `/${size}x${size}bb.jpg`);
}
