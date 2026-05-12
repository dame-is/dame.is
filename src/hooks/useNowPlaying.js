import { useEffect, useState } from 'react';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { ME_DID, COLLECTIONS } from '../config.js';

const REFRESH_MS = 4 * 60 * 1000;

/**
 * Latest fm.teal.* play. Snapshot first paint, refresh on mount + every few minutes.
 * Returns a normalized `{ track, artist, playedAt, originUrl, raw }` shape.
 */
export function useNowPlaying() {
  const [play, setPlay] = useState(null);

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

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const seed = await fetchSnapshot('listening');
      if (!cancelled && Array.isArray(seed) && seed[0]) setPlay(adopt(seed[0]));

      async function refresh() {
        try {
          const pds = await resolvePds(ME_DID);
          const recs = await listRecords(pds, {
            repo: ME_DID,
            collection: COLLECTIONS.listen,
            max: 1,
          });
          if (!cancelled && recs?.[0]) setPlay(adopt(recs[0]));
        } catch {
          // keep the seed; networks fail.
        }
      }

      refresh();
      const id = setInterval(refresh, REFRESH_MS);
      return () => clearInterval(id);
    }
    let cleanup;
    run().then((c) => {
      cleanup = c;
    });
    return () => {
      cancelled = true;
      if (typeof cleanup === 'function') cleanup();
    };
  }, []);

  return play;
}
