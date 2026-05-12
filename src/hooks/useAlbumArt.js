import { useEffect, useState } from 'react';
import { albumArtFor } from '../lib/albumArt.js';

/**
 * Resolve album art for a play payload. Returns one of:
 *   { status: 'idle' }    — no usable identifiers on the payload yet
 *   { status: 'loading' } — fetch in flight
 *   { status: 'hit', art } — { url, thumbUrl, track, artist, album, source }
 *   { status: 'miss' }    — Apple has no record for this track
 *
 * The underlying lookup is cached in localStorage by `albumArtFor`, so
 * components mount → hit cache synchronously on subsequent visits.
 */
export function useAlbumArt(payload, { size = 600 } = {}) {
  const [state, setState] = useState({ status: 'idle' });

  // Build a stable dependency string so we don't refetch on every render
  // when callers pass a fresh payload object reference each time.
  const depKey = identityKey(payload);

  useEffect(() => {
    if (!depKey) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    albumArtFor(payload, { size }).then((art) => {
      if (cancelled) return;
      setState(art ? { status: 'hit', art } : { status: 'miss' });
    });
    return () => {
      cancelled = true;
    };
    // payload is intentionally excluded; depKey + size capture the
    // identity we care about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, size]);

  return state;
}

function identityKey(payload) {
  if (!payload) return '';
  if (payload.isrc) return `isrc:${payload.isrc}`;
  if (payload.originUrl) return `origin:${payload.originUrl}`;
  const track = payload.trackName || payload.track || '';
  const artist = Array.isArray(payload.artists)
    ? (payload.artists[0]?.artistName || '')
    : (payload.artist || '');
  return track ? `text:${track}|${artist}` : '';
}
