import { useEffect, useRef, useState } from 'react';
import { resolvePds, listRecords, getRepoRev } from '../lib/atproto.js';
import { fetchChromeSeed } from '../lib/snapshot.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { normalizeVitals } from '../lib/vitals.js';
import { ME_DID, COLLECTIONS } from '../config.js';

// The last record any mount saw, so the top chrome's expanded row (which
// unmounts when it collapses) re-opens on what it last showed instead of an
// empty row that fills in mid-animation. And the repo head it was read at, so
// a re-open (or a tick) that finds the repo unmoved doesn't read it again.
let lastRecord = null;
let lastRev = null;

/**
 * Latest is.dame.state record — Dame's current iPhone-sourced state (heart
 * rate, activity, battery, ambient sound, calories). is.dame.state is an
 * append-only log keyed by TID, so the newest record is "right now". Snapshot
 * first paint, then live via listRecords (newest first), kept current on the
 * shared 30s tick — same cadence and same one-record read as NowPlaying, so
 * every "live" surface updates together. The live read doesn't wait on the
 * snapshot, and skips itself when the repo head (see getRepoRev) hasn't moved.
 *
 * Returns `{ vitals, status }`, where `vitals` is a normalized, type-coerced
 * shape (or null before anything loads).
 */
export function useDameState() {
  const [record, setRecordState] = useState(lastRecord);
  const [status, setStatus] = useState(lastRecord ? 'ready' : 'idle');
  const cancelledRef = useRef(false);
  const recordRef = useRef(lastRecord);
  const inflightRef = useRef(false);
  const setRecord = (next) => {
    lastRecord = next;
    setRecordState(next);
  };

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
          collection: COLLECTIONS.state,
          max: 1,
        });
        if (cancelledRef.current) return;
        if (recs?.[0]) {
          lastRev = rev;
          recordRef.current = recs[0];
          setRecord(recs[0]);
          setStatus('ready');
        }
      } catch {
        // listRecords is empty until the first push; keep whatever we had.
        if (!cancelledRef.current) {
          setStatus(recordRef.current ? 'stale' : 'error');
        }
      } finally {
        inflightRef.current = false;
      }
    }

    // A remembered record is newer than the build's snapshot; skip it. The
    // snapshot is only a stand-in until the live read answers, so it never
    // paints over one that got there first.
    if (!recordRef.current) {
      setStatus('loading');
      fetchChromeSeed('state').then((seed) => {
        if (cancelledRef.current || recordRef.current) return;
        if (seed?.value) {
          recordRef.current = seed;
          setRecord(seed);
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

  return { vitals: normalizeVitals(record?.value), status };
}
