import { useCallback, useEffect, useState } from 'react';
import { COLLECTIONS } from '../../config.js';

/**
 * Load the full resume working set — every resume version, job, and education
 * record on the signed-in PDS — for the admin studio and tailoring workbench.
 * Records come back as plain `{ uri, value }` objects (JSON round-tripped so
 * drafts can be cloned/mutated safely). `reload()` refetches everything.
 */
export function useResumeBundle(agent, did) {
  const [bundle, setBundle] = useState(null); // { resumes, jobs, education }
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!agent || !did) return undefined;
    setError(null);

    async function listAll(collection) {
      const all = [];
      let cursor;
      do {
        const res = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection,
          limit: 100,
          cursor,
        });
        const data = res?.data || res;
        all.push(...(data?.records || []));
        cursor = data?.cursor;
      } while (cursor);
      // Normalize to plain JSON so state updates can structurally clone freely.
      return all.map((r) => ({ uri: r.uri, cid: r.cid, value: JSON.parse(JSON.stringify(r.value ?? {})) }));
    }

    (async () => {
      try {
        const [resumes, jobs, education] = await Promise.all([
          listAll(COLLECTIONS.resume),
          listAll(COLLECTIONS.resumeJob),
          listAll(COLLECTIONS.resumeEducation),
        ]);
        if (!cancelled) setBundle({ resumes, jobs, education });
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setBundle({ resumes: [], jobs: [], education: [] });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent, did, tick]);

  return {
    resumes: bundle?.resumes || null,
    jobs: bundle?.jobs || null,
    education: bundle?.education || null,
    loading: bundle === null,
    error,
    reload,
  };
}
