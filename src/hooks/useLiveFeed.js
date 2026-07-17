import { useEffect, useRef, useState } from 'react';
import { fetchSnapshot } from '../lib/snapshot.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';

// Stable empty set so "nothing new" always returns the same reference —
// page-side memos keyed on `newKeys` then stay stable between refreshes.
const EMPTY_KEYS = new Set();
// How long a freshly-arrived row stays flagged, so the entrance animation
// plays once and unrelated later re-renders (search, layout toggle) don't
// replay it.
const ARRIVAL_HOLD_MS = 1200;

const defaultArrivalKey = (item) => item?.atUri;

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
 * `live` opts the surface into the shared 30s refresh tick (the same one
 * NowPlaying, NowStatus and the home feed ride), so new records appear
 * without a reload. On each live refresh the fresh records are diffed
 * against what's already on screen and their keys returned as `newKeys`,
 * so the page can slide them in (see the home feed's arrival animation).
 * The very first paint never animates. `getRev` is an optional
 * `async () => string` probe (repo head rev via getLatestCommit); when it
 * returns the same rev as the last live fetch, the tick skips the — possibly
 * multi-page — `fetchLive` call entirely, so an idle page costs one cheap
 * request per tick instead of re-paginating the whole collection.
 * `arrivalKey` derives the identity used for arrival diffing (default the
 * record's `atUri`).
 *
 *   { items, status: 'loading' | 'ready' | 'stale' | 'error', refreshedAt,
 *     newKeys: Set<string> }
 */
export function useLiveFeed({
  name,
  fetchLive,
  mapItems,
  fetchSnapshotOverride,
  strategy = 'snapshot-first',
  fallbackOnError = true,
  live = false,
  getRev = null,
  arrivalKey = defaultArrivalKey,
  deps = [],
}) {
  const [state, setState] = useState({ items: null, status: 'loading', refreshedAt: null });
  // Keys that arrived on the most recent live refresh (empty on first paint
  // and between refreshes). Held separate from `state` so a snapshot/cache
  // repaint can't accidentally flag arrivals.
  const [newKeys, setNewKeys] = useState(EMPTY_KEYS);

  // Latest-callback refs so closures over slugs / params don't trap stale
  // versions, but the effect itself only re-runs when `deps` changes.
  const fetchLiveRef = useRef(fetchLive);
  const mapItemsRef = useRef(mapItems);
  const fetchSnapshotRef = useRef(fetchSnapshotOverride);
  const getRevRef = useRef(getRev);
  const arrivalKeyRef = useRef(arrivalKey);
  fetchLiveRef.current = fetchLive;
  mapItemsRef.current = mapItems;
  fetchSnapshotRef.current = fetchSnapshotOverride;
  getRevRef.current = getRev;
  arrivalKeyRef.current = arrivalKey;

  // Mirror the currently-displayed items so the first live poll can seed its
  // "already seen" set from the initial paint without threading it through
  // the (multi-exit-path) initial load.
  const itemsRef = useRef(null);
  itemsRef.current = state.items;

  // Live-polling coordination. `didInit` gates polling until the initial
  // load settles; `inflight` prevents overlapping ticks; `lastRev` is the
  // repo head as of our last successful live fetch (for the getRev skip);
  // `seenKeys` is every key shown so far (null until first seeded);
  // `clearTimer` retires the arrival highlight after the entrance plays.
  const didInitRef = useRef(false);
  const inflightRef = useRef(false);
  const lastRevRef = useRef(null);
  const seenKeysRef = useRef(null);
  const clearTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    didInitRef.current = false;
    lastRevRef.current = null;
    seenKeysRef.current = null;
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setState({ items: null, status: 'loading', refreshedAt: null });
    setNewKeys(EMPTY_KEYS);

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

    // `didInit` unblocks the live tick only once the initial load settles
    // (success or failure), so a fast first tick can't race the first paint.
    run().finally(() => {
      if (!cancelled) didInitRef.current = true;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Live surfaces re-fetch on the shared 30s tick so new records appear
  // without a reload. The tick already pauses while the tab is hidden and
  // fires on visibility return. A cheap getRev probe (when provided) skips
  // the full re-fetch whenever the repo head hasn't advanced since our last
  // live build — cheap-request-per-tick instead of re-paginating idly.
  useEffect(() => {
    if (!live) return undefined;
    let cancelled = false;

    const poll = async () => {
      if (cancelled || inflightRef.current || !didInitRef.current) return;
      inflightRef.current = true;
      try {
        let rev = null;
        if (getRevRef.current) {
          try {
            rev = await getRevRef.current();
          } catch {
            rev = null; // probe failed — fall through and re-fetch
          }
          if (cancelled) return;
          if (rev && rev === lastRevRef.current) return; // repo unchanged
        }

        let data;
        try {
          data = await fetchLiveRef.current();
        } catch {
          return; // transient failure — keep current data, retry next tick
        }
        if (cancelled) return;
        const mapped = mapItemsRef.current ? mapItemsRef.current(data) : data;
        if (mapped == null) return;

        // Diff the refreshed records against everything shown so far. The
        // first poll seeds from the initial paint (via itemsRef) so nothing
        // that was already on screen slides in — only genuinely new records.
        const getKey = arrivalKeyRef.current || defaultArrivalKey;
        if (seenKeysRef.current === null) {
          const seed = new Set();
          for (const it of itemsRef.current || []) {
            const k = getKey(it);
            if (k) seed.add(k);
          }
          seenKeysRef.current = seed;
        }
        const seen = seenKeysRef.current;
        const arrivals = new Set();
        for (const it of mapped) {
          const k = getKey(it);
          if (k && !seen.has(k)) arrivals.add(k);
        }

        // React 18 batches these back-to-back updates into one commit, so a
        // new row mounts with its key already in `newKeys` and the entrance
        // animation actually plays (mirrors the home feed's runRefresh).
        setState({ items: mapped, status: 'ready', refreshedAt: new Date() });
        if (rev) lastRevRef.current = rev;
        if (arrivals.size > 0) {
          for (const k of arrivals) seen.add(k);
          setNewKeys(arrivals);
          if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
          clearTimerRef.current = setTimeout(() => {
            clearTimerRef.current = null;
            setNewKeys(EMPTY_KEYS);
          }, ARRIVAL_HOLD_MS);
        }
      } finally {
        inflightRef.current = false;
      }
    };

    const unsubscribe = subscribeRefreshTick(poll);
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, ...deps]);

  // Retire any pending arrival-highlight timer on unmount.
  useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    },
    [],
  );

  return { ...state, newKeys };
}
