import { useEffect, useState } from 'react';
import { fetchSnapshot, mergeByKey } from '../lib/snapshot.js';

/**
 * Hybrid data hook: synchronous seed (imported JSON) + live refresh on mount.
 *
 *   const { data, status, error } = useSnapshot('unifiedFeed', seed, {
 *     refresh: async () => fetchUnifiedFeedFromAtproto(),
 *     keyFn: (item) => item.atUri,
 *   });
 *
 * `refresh` is optional; without it we just serve the seed and try `/data/<name>.json`.
 * `keyFn` enables de-duped merge of live results into the seed.
 */
export function useSnapshot(name, seed, { refresh, keyFn } = {}) {
  const [data, setData] = useState(seed ?? null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setStatus('refreshing');
      try {
        // Try the static snapshot first if no seed was supplied.
        if (!seed && name) {
          const snap = await fetchSnapshot(name);
          if (!cancelled && snap) setData(snap);
        }
        if (refresh) {
          const live = await refresh();
          if (cancelled) return;
          if (Array.isArray(live) && Array.isArray(seed) && keyFn) {
            setData((prev) => mergeByKey(prev || seed, live, keyFn));
          } else if (live != null) {
            setData(live);
          }
        }
        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e);
        setStatus('error');
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return { data, status, error };
}
