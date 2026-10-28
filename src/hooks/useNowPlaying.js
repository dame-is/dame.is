import { useEffect, useRef, useState } from 'react';
import { resolvePds, getRepoRev } from '../lib/atproto.js';
import { fetchChromeSeed } from '../lib/snapshot.js';
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

// The last play any mount saw. NowPlaying lives in the top chrome's expanded
// row, which unmounts when it collapses; without this every re-open showed a
// "—" that filled in mid-animation.
let lastPlay = null;
// What the last live read was made of, and the repo head it was read at. A
// tick that finds the head unmoved skips the four teal reads, but still has to
// re-judge the status record: it expires on the clock, not on a write.
let lastRead = null; // { rev, record, status }

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
  const [play, setPlayState] = useState(lastPlay);
  const cancelledRef = useRef(false);
  const inflightRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const setPlay = (next) => {
      lastPlay = next;
      setPlayState(next);
    };

    async function refresh() {
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const rev = await getRepoRev(ME_DID).catch(() => null);
        if (rev && lastRead && rev === lastRead.rev) {
          const next = adopt(lastRead.record, lastRead.status);
          if (!cancelledRef.current && next && next.live !== lastPlay?.live) {
            setPlay(next);
          }
          return;
        }
        const pds = await resolvePds(ME_DID);
        // A status read that failed stands on the last status this tab saw
        // (still judged against the clock, so it expires) rather than on
        // "nothing playing", which is what a blip used to look like.
        let statusFailed = false;
        const [status, plays] = await Promise.all([
          fetchTealStatus(pds, { repo: ME_DID }).catch(() => {
            statusFailed = true;
            return lastRead?.status || null;
          }),
          listTealPlays(pds, { repo: ME_DID, max: 1 }).catch(() => null),
        ]);
        const next = adopt(plays?.[0], status);
        // A read that failed in part isn't kept as the answer for this head,
        // or the next ticks would skip the read that could replace it.
        if (plays && !statusFailed) {
          lastRead = { rev, record: plays[0] || null, status };
        }
        if (!cancelledRef.current && next) setPlay(next);
      } catch {
        // keep whatever we had; networks fail.
      } finally {
        inflightRef.current = false;
      }
    }

    // A remembered play is newer than the build's snapshot; skip it. The
    // snapshot only stands in until the live read answers — it never paints
    // over one that got there first.
    if (!lastPlay) {
      fetchChromeSeed('listening').then((seed) => {
        if (cancelledRef.current || lastPlay) return;
        const first = adopt(seed, null);
        if (first) setPlay(first);
      });
    }
    refresh();
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
