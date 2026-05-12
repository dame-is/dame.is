import { useEffect, useState } from 'react';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { ME_DID, COLLECTIONS } from '../config.js';

/**
 * Latest is.dame.now record. Reads the snapshot, then refetches live.
 */
export function useNowStatus() {
  const [record, setRecord] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setStatus('loading');
      const seed = await fetchSnapshot('now');
      if (!cancelled && Array.isArray(seed) && seed[0]) setRecord(seed[0]);
      try {
        const pds = await resolvePds(ME_DID);
        const records = await listRecords(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.now,
          max: 1,
        });
        if (!cancelled && records?.[0]) {
          setRecord(records[0]);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus(record ? 'stale' : 'error');
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { record, status };
}
