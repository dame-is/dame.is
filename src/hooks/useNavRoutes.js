import { useEffect, useRef, useState } from 'react';
import { resolvePds, getRecord } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import { effectiveNavRoutes } from '../lib/navRoutes.js';

/**
 * The effective nav-menu routes. Reads the optional is.dame.nav/self override
 * (snapshot for instant paint, then live getRecord) and resolves it against the
 * hardcoded defaults via effectiveNavRoutes — so with no record, a disabled
 * one, or an empty list, the built-in routes show unchanged.
 */
export function useNavRoutes() {
  const [record, setRecord] = useState(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    async function boot() {
      const seed = await fetchSnapshot('nav');
      if (!cancelledRef.current && seed?.value) setRecord(seed);
      try {
        const pds = await resolvePds(ME_DID);
        const rec = await getRecord(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.nav,
          rkey: 'self',
        });
        if (!cancelledRef.current && rec?.value) setRecord(rec);
      } catch {
        // No override (getRecord 404s until one exists) — defaults stand.
      }
    }
    boot();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return effectiveNavRoutes(record);
}
