import { useEffect, useState } from 'react';
import { fetchSnapshot } from '../lib/snapshot.js';

/**
 * The first-sighting index — which observations were the first record of
 * their species, and every taxon the archive held at build time.
 *
 * It is one static file per deploy (`/data/firstSightings.json`, ~6 kB,
 * written by writeFirstSightings in scripts/prefetch.mjs), so the fetch is
 * memoized for the session: the home feed and a record page opened from it
 * share a single round trip, and a revisit 304s.
 *
 * Returns `{ ids, taxa }` as Sets, both empty until it resolves and if it
 * never does. Nothing here throws and nothing waits on it — a missing index
 * costs the marks, not the page. Callers hand it to `mergeFirstSightings`
 * along with whatever observations they hold; that's what picks up a lifer
 * logged since the build, which this file can't know about.
 */

const EMPTY = { ids: new Set(), taxa: new Set() };

let cached = null;

function loadFirstSightings() {
  if (!cached) {
    cached = fetchSnapshot('firstSightings')
      .then((snap) => ({
        ids: new Set(Array.isArray(snap?.ids) ? snap.ids : []),
        taxa: new Set(Array.isArray(snap?.taxa) ? snap.taxa : []),
      }))
      .catch(() => {
        // Let a later mount retry rather than caching the failure forever.
        cached = null;
        return EMPTY;
      });
  }
  return cached;
}

export function useFirstSightings() {
  const [index, setIndex] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;
    loadFirstSightings().then((next) => {
      if (!cancelled) setIndex(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return index;
}
