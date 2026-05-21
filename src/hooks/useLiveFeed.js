import { useEffect, useRef, useState } from 'react';
import { fetchSnapshot } from '../lib/snapshot.js';

/**
 * Dual-strategy data hook for PDS-backed surfaces.
 *
 *   strategy: 'live-first'
 *     Show a skeleton until the live fetch resolves, then render. On error,
 *     fall back to the snapshot (if `fallbackOnError`) and surface
 *     `status: 'stale'` so callers can render a "showing cached results"
 *     notice. Use for feeds (Home, Posting, Logging) where a snapshot
 *     flash followed by a live update reads as a bug.
 *
 *   strategy: 'snapshot-first'
 *     Render the snapshot the instant it lands; overlay the live result
 *     when it arrives. Use for content where the snapshot is usually
 *     right and the live fetch confirms it (About, Blogging, Creating).
 *
 * `mapItems` runs against both the snapshot and live payloads so the page
 * sees a single render shape regardless of which source produced it.
 *
 * `name` reads `/data/<name>.json` for the snapshot path. For pages
 * stitched from multiple snapshot files, pass `fetchSnapshotOverride`
 * instead (e.g. Blogging combines `blogs.json` + `leaflets.json`).
 *
 * `deps` is the effect dependency array. Pass `[]` for unparameterized
 * pages; pass `[slug]` for routes with a URL parameter, etc.
 *
 *   { items, status: 'loading' | 'ready' | 'stale' | 'error', refreshedAt }
 */
export function useLiveFeed({
  name,
  fetchLive,
  mapItems,
  fetchSnapshotOverride,
  strategy = 'snapshot-first',
  fallbackOnError = true,
  deps = [],
}) {
  const [state, setState] = useState({ items: null, status: 'loading', refreshedAt: null });

  // Latest-callback refs so closures over slugs / params don't trap stale
  // versions, but the effect itself only re-runs when `deps` changes.
  const fetchLiveRef = useRef(fetchLive);
  const mapItemsRef = useRef(mapItems);
  const fetchSnapshotRef = useRef(fetchSnapshotOverride);
  fetchLiveRef.current = fetchLive;
  mapItemsRef.current = mapItems;
  fetchSnapshotRef.current = fetchSnapshotOverride;

  useEffect(() => {
    let cancelled = false;
    setState({ items: null, status: 'loading', refreshedAt: null });

    const apply = (data) => (mapItemsRef.current ? mapItemsRef.current(data) : data);

    const snapshotPromise = fetchSnapshotRef.current
      ? Promise.resolve()
          .then(() => fetchSnapshotRef.current())
          .catch(() => null)
      : name
        ? fetchSnapshot(name).catch(() => null)
        : Promise.resolve(null);
    const livePromise = fetchLiveRef.current
      ? Promise.resolve()
          .then(() => fetchLiveRef.current())
          .then(
            (data) => ({ ok: true, data }),
            (err) => ({ ok: false, err }),
          )
      : Promise.resolve({ ok: false, err: new Error('useLiveFeed: fetchLive is required') });

    async function run() {
      if (strategy === 'snapshot-first') {
        const snap = await snapshotPromise;
        if (!cancelled && snap != null) {
          const mapped = apply(snap);
          // Stay in `loading` if the snapshot didn't contain the requested
          // record (e.g. by-slug lookups on a stale snapshot). The live
          // fetch may still find it; transitioning to 'ready' here would
          // flash a "not found" before live arrives.
          if (mapped != null) {
            setState({ items: mapped, status: 'ready', refreshedAt: new Date() });
          }
        }
        const live = await livePromise;
        if (cancelled) return;
        if (live.ok && live.data != null) {
          setState({ items: apply(live.data), status: 'ready', refreshedAt: new Date() });
          return;
        }
        // Live failed. If snapshot already gave us something we stay at
        // 'ready'; otherwise surface the error.
        setState((prev) => (prev.status === 'loading'
          ? { items: null, status: 'error', refreshedAt: null }
          : prev));
        return;
      }

      // live-first
      const live = await livePromise;
      if (cancelled) return;
      if (live.ok && live.data != null) {
        setState({ items: apply(live.data), status: 'ready', refreshedAt: new Date() });
        return;
      }
      if (fallbackOnError) {
        const snap = await snapshotPromise;
        if (cancelled) return;
        if (snap != null) {
          setState({ items: apply(snap), status: 'stale', refreshedAt: new Date() });
          return;
        }
      }
      setState({ items: null, status: 'error', refreshedAt: null });
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
