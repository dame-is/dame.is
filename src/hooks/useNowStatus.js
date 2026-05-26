import { useEffect, useRef, useState } from 'react';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { ME_DID, COLLECTIONS } from '../config.js';

/**
 * Latest is.dame.now record. Reads the snapshot, refetches live, then
 * keeps current via the shared 30s refresh tick — same cadence as
 * NowPlaying and the home feed.
 */
export function useNowStatus() {
  const [record, setRecord] = useState(null);
  const [status, setStatus] = useState('idle');
  const cancelledRef = useRef(false);
  const recordRef = useRef(null);

  useEffect(() => {
    cancelledRef.current = false;

    async function refresh() {
      try {
        const pds = await resolvePds(ME_DID);
        const recs = await listRecords(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.now,
          max: 1,
        });
        if (cancelledRef.current) return;
        if (recs?.[0]) {
          recordRef.current = recs[0];
          setRecord(recs[0]);
          setStatus('ready');
        }
      } catch {
        if (!cancelledRef.current) {
          setStatus(recordRef.current ? 'stale' : 'error');
        }
      }
    }

    async function boot() {
      setStatus('loading');
      const seed = await fetchSnapshot('now');
      if (!cancelledRef.current && Array.isArray(seed) && seed[0]) {
        recordRef.current = seed[0];
        setRecord(seed[0]);
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

  return { record, status };
}
