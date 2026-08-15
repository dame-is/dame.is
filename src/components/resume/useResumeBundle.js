import { useCallback, useEffect, useState } from 'react';
import { COLLECTIONS } from '../../config.js';
import { showOnCreating } from '../../lib/publications.js';

const STANDARD_DOC = 'site.standard.document';

/** Which slot of the loaded bundle a written record belongs in. */
const BUCKET_FOR = {
  [COLLECTIONS.resume]: 'resumes',
  [COLLECTIONS.resumeJob]: 'jobs',
  [COLLECTIONS.resumeEducation]: 'education',
};

/**
 * Load the full resume working set — every resume version, job, and education
 * record on the signed-in PDS, plus the portfolio posts a job's `work` links
 * can point at — for the admin studio and tailoring workbench. Records come
 * back as plain `{ uri, value }` objects (JSON round-tripped so drafts can be
 * cloned/mutated safely). `reload()` refetches everything.
 *
 * Four fully-paginated sweeps is a lot to run twice, and the studio and the
 * workbench are two views of ONE working set — so `StudioPane` hoists the call
 * above both and hands the result down as a `bundle` prop, which survives the
 * `view=resume` → `view=resume-tailor` flip because that pane is never keyed.
 * `provided` is how a component takes that hoisted bundle without becoming
 * unmountable on its own: pass it through and this hook returns it verbatim,
 * fetching nothing; omit it (a test, a future standalone route) and the
 * component still loads its own copy. A hook cannot be called conditionally,
 * so the choice has to live inside one, not around it.
 *
 * @param {object|null} agent      The PDS agent, or null to fetch nothing.
 * @param {string|null} did        The repo DID, or null to fetch nothing.
 * @param {object|null} [provided] A bundle an ancestor already owns.
 */
export function useResumeBundle(agent, did, provided = null) {
  const [bundle, setBundle] = useState(null); // { resumes, jobs, education, documents }
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  /**
   * Write-through. Reflect records the caller has just written to the PDS into
   * the loaded set, without a second four-collection sweep.
   *
   * This exists *because* the bundle is now hoisted. When the studio and the
   * workbench each owned a copy, navigating between them remounted the other
   * one and it refetched; the whole point of hoisting is that it no longer
   * does — which would leave a version you just renamed, saved or duplicated
   * described by a snapshot taken before the write. Duplicating is the sharp
   * case: the workbench opens on a record that, to a stale bundle, does not
   * exist yet, and would render "no such version".
   *
   * @param {{collection: string, uri: string, value: object|null}[]} written
   *        `value: null` means the record was deleted.
   */
  const applyWrites = useCallback((written) => {
    setBundle((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const { collection, uri, value } of written || []) {
        const bucket = BUCKET_FOR[collection];
        if (!bucket || !uri) continue;
        const list = (next[bucket] || []).slice();
        const at = list.findIndex((r) => r.uri === uri);
        // Round-tripped for the same reason the fetch does it: every consumer
        // clones and mutates these values, and the caller's copy is live.
        const record = value ? { uri, value: JSON.parse(JSON.stringify(value)) } : null;
        // Replaced IN PLACE, never removed-and-appended: the studio lists these
        // in bundle order, and saving a version should not move it to the
        // bottom of the list you saved it from.
        if (at >= 0 && record) list[at] = record;
        else if (at >= 0) list.splice(at, 1);
        else if (record) list.push(record);
        next[bucket] = list;
      }
      return next;
    });
  }, []);

  // A boolean rather than `provided` itself: the hoisted bundle is a fresh
  // object on every render of the owner, so depending on its identity would
  // tear down and re-run this effect once per render for no reason.
  const hoisted = Boolean(provided);

  useEffect(() => {
    let cancelled = false;
    if (hoisted || !agent || !did) return undefined;
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
        const [resumes, jobs, education, docs] = await Promise.all([
          listAll(COLLECTIONS.resume),
          listAll(COLLECTIONS.resumeJob),
          listAll(COLLECTIONS.resumeEducation),
          listAll(STANDARD_DOC).catch(() => []),
        ]);
        const documents = docs.filter((r) => showOnCreating(r?.value));
        if (!cancelled) setBundle({ resumes, jobs, education, documents });
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setBundle({ resumes: [], jobs: [], education: [], documents: [] });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent, did, tick, hoisted]);

  // Verbatim, including its `reload` and `applyWrites` — a rename has to refetch
  // and a save has to write through to the bundle the OWNER holds, not to a
  // private second copy this hook never made.
  if (provided) return provided;

  return {
    resumes: bundle?.resumes || null,
    jobs: bundle?.jobs || null,
    education: bundle?.education || null,
    documents: bundle?.documents || null,
    loading: bundle === null,
    error,
    reload,
    applyWrites,
  };
}
