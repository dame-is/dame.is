import { useEffect, useRef, useState } from 'react';
import { resolvePds } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import {
  fetchTealStatus,
  listTealPlays,
  playArtistLine,
  playOriginUrl,
  playTrackName,
  playedAtOf,
  statusPlay,
} from '../lib/teal.js';
import { ME_DID } from '../config.js';

/**
 * What dame is listening to. Snapshot first paint, then refreshes on the
 * shared 30s tick (alongside NowStatus and the home feed) so all the
 * "live" surfaces update together.
 *
 * Two teal.fm sources, in order of how well they answer the question:
 *
 *   1. `fm.teal.actor.status` — a singleton the scrobbler keeps pointed at
 *      whatever is playing right now, with an expiry. When it hasn't expired,
 *      it's the truthful answer and `live` is true.
 *   2. the newest play record — what was on last. Always fetched anyway,
 *      because it's the thing with an at:// URI to link to.
 *
 * Both are read across teal's production and alpha namespaces (see
 * src/lib/teal.js), so the signal survives the migration in either direction.
 *
 * Returns `{ track, artist, release, originUrl, playedAt, live, atUri, raw }`.
 */
export function useNowPlaying() {
  const [play, setPlay] = useState(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function refresh() {
      try {
        const pds = await resolvePds(ME_DID);
        const [status, plays] = await Promise.all([
          fetchTealStatus(pds, { repo: ME_DID }).catch(() => null),
          listTealPlays(pds, { repo: ME_DID, max: 1 }).catch(() => []),
        ]);
        const next = adopt(plays?.[0], status);
        if (!cancelledRef.current && next) setPlay(next);
      } catch {
        // keep whatever we had; networks fail.
      }
    }

    async function boot() {
      const seed = await fetchSnapshot('listening');
      if (!cancelledRef.current && Array.isArray(seed) && seed[0]) {
        setPlay(adopt(seed[0], null));
      }
      refresh();
    }

    boot();
    const unsubscribe = subscribeRefreshTick(refresh);
    return () => {
      cancelledRef.current = true;
      unsubscribe();
    };
  }, []);

  return play;
}

/**
 * Normalize a play record (+ an optional status singleton) into one shape.
 *
 * An unexpired status describes the current track, so its metadata wins. The
 * record link only comes along when the status is describing the same track
 * the newest play record is — mid-song the scrobbler has written the status
 * but not yet the play, and linking "now playing" to the *previous* song's
 * record would be worse than not linking at all.
 */
function adopt(record, status) {
  const played = record?.value || null;
  const current = statusPlay(status);
  const value = current || played;
  if (!value) return null;
  const track = playTrackName(value);
  const sameTrack = Boolean(current && played && playTrackName(played) === track);
  return {
    track,
    artist: playArtistLine(value),
    release: value.releaseName || '',
    originUrl: playOriginUrl(value),
    playedAt: playedAtOf(value),
    live: Boolean(current),
    atUri: !current || sameTrack ? record?.uri || null : null,
    raw: record || status,
  };
}
