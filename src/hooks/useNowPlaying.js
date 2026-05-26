import { useEffect, useRef, useState } from 'react';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { ME_DID, COLLECTIONS } from '../config.js';

/**
 * Latest fm.teal.* play. Snapshot first paint, then refreshes on the
 * shared 30s tick (alongside NowStatus and the home feed) so all the
 * "live" surfaces update together.
 * Returns a normalized `{ track, artist, playedAt, originUrl, raw }` shape.
 */
export function useNowPlaying() {
  const [play, setPlay] = useState(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function refresh() {
      try {
        const pds = await resolvePds(ME_DID);
        const recs = await listRecords(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.listen,
          max: 1,
        });
        if (!cancelledRef.current && recs?.[0]) setPlay(adopt(recs[0]));
      } catch {
        // keep whatever we had; networks fail.
      }
    }

    async function boot() {
      const seed = await fetchSnapshot('listening');
      if (!cancelledRef.current && Array.isArray(seed) && seed[0]) {
        setPlay(adopt(seed[0]));
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

function adopt(record) {
  if (!record) return null;
  const v = record.value || {};
  const artists = Array.isArray(v.artists) ? v.artists : [];
  return {
    track: v.trackName || v.track || '',
    artist: artists.map((a) => a?.artistName).filter(Boolean).join(', '),
    release: v.releaseName || '',
    originUrl: v.originUrl || null,
    playedAt: v.playedTime || v.playedAt || null,
    atUri: record.uri,
    raw: record,
  };
}
