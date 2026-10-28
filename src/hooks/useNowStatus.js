import { useEffect, useRef, useState } from 'react';
import { resolvePds, listRecords, getRepoRev } from '../lib/atproto.js';
import { fetchChromeSeed } from '../lib/snapshot.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { ME_DID, COLLECTIONS } from '../config.js';

// The last record any mount saw, and the repo head it was read at — the same
// memory useDameState and useNowPlaying keep, so a remount opens on what was
// last shown instead of "—", and doesn't re-read a repo that hasn't moved.
let lastRecord = null;
let lastRev = null;

/**
 * Latest is.dame.now record. Reads the snapshot, refetches live, then
 * keeps current via the shared 30s refresh tick — same cadence as
 * NowPlaying and the home feed.
 *
 * The live read starts at once rather than after the snapshot, which only
 * holds the line until it answers and is dropped if it lands second. Each
 * read first asks for the repo head (one request shared by every live reader
 * on the tick, see getRepoRev) and stops there when nothing has been written
 * since the last one.
 */
export function useNowStatus() {
  const [record, setRecordState] = useState(lastRecord);
  const [status, setStatus] = useState(lastRecord ? 'ready' : 'idle');
  const cancelledRef = useRef(false);
  const recordRef = useRef(lastRecord);
  const inflightRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function refresh() {
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const rev = await getRepoRev(ME_DID).catch(() => null);
        if (rev && rev === lastRev && lastRecord) {
          if (!cancelledRef.current) setStatus('ready');
          return;
        }
        const pds = await resolvePds(ME_DID);
        const recs = await listRecords(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.now,
          max: 1,
        });
        if (cancelledRef.current) return;
        if (recs?.[0]) {
          lastRev = rev;
          lastRecord = recs[0];
          recordRef.current = recs[0];
          setRecordState(recs[0]);
          setStatus('ready');
        }
      } catch {
        if (!cancelledRef.current) {
          setStatus(recordRef.current ? 'stale' : 'error');
        }
      } finally {
        inflightRef.current = false;
      }
    }

    // A remembered record is newer than the build's snapshot; skip it.
    if (!recordRef.current) {
      setStatus('loading');
      fetchChromeSeed('now').then((seed) => {
        if (cancelledRef.current || recordRef.current) return;
        if (seed?.value) {
          recordRef.current = seed;
          setRecordState(seed);
        }
      });
    }
    refresh();
    const unsubscribe = subscribeRefreshTick(refresh);
    return () => {
      cancelledRef.current = true;
      unsubscribe();
    };
  }, []);

  return { record, status };
}
