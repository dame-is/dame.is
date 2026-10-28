import { useEffect, useRef, useState } from 'react';
import { resolvePds, getRecord, isRecordNotFound } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import { effectiveNavRoutes } from '../lib/navRoutes.js';

/* global __NAV_SEED__ */

// The is.dame.nav/self snapshot scripts/prefetch.mjs took at build time, baked
// in by vite.config.js. Null in dev without a prefetch.
const BUILD_SEED = typeof __NAV_SEED__ !== 'undefined' ? __NAV_SEED__ : null;

/**
 * The effective nav-menu routes. Reads the optional is.dame.nav/self override
 * (the build-time snapshot for the first render, then live getRecord) and
 * resolves it against the hardcoded defaults via effectiveNavRoutes — so with
 * no record, a disabled one, or an empty list, the built-in routes show
 * unchanged.
 *
 * The snapshot is the initial state rather than a fetch: fetched, it landed
 * about half a second after the menu was usable, and until then the menu drew
 * the built-in routes (a different list, in a different order) and then
 * reshuffled them under whatever the visitor was about to tap.
 */
export function useNavRoutes() {
  const [record, setRecord] = useState(BUILD_SEED);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    async function boot() {
      // The same file the build baked in, so only worth a request when the
      // build had none to bake.
      if (!BUILD_SEED) {
        const seed = await fetchSnapshot('nav');
        if (!cancelledRef.current && seed?.value) setRecord(seed);
      }
      try {
        const pds = await resolvePds(ME_DID);
        const rec = await getRecord(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.nav,
          rkey: 'self',
        });
        if (!cancelledRef.current && rec?.value) setRecord(rec);
      } catch (err) {
        // The PDS answers a missing record with 400 RecordNotFound: there is
        // no override (any more), so the defaults stand even if the snapshot
        // still carried one. Anything else is the network — keep the snapshot.
        if (!cancelledRef.current && isRecordNotFound(err)) setRecord(null);
      }
    }
    boot();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return effectiveNavRoutes(record);
}
