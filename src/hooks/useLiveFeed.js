import { useEffect, useRef, useState } from 'react';
import { fetchSnapshot } from '../lib/snapshot.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';

// Stable empty set so "nothing new" always returns the same reference —
// page-side memos keyed on `newKeys` then stay stable between refreshes.
const EMPTY_KEYS = new Set();
// How long a freshly-arrived row stays flagged, so the entrance animation
// plays once and unrelated later re-renders (search, filters) don't
// replay it.
const ARRIVAL_HOLD_MS = 1200;
// How long a live-first read runs before its fallback snapshot is fetched
// anyway, so a slow connection that ends in failure still falls back at once.
const LIVE_FALLBACK_HEADSTART_MS = 2500;

const defaultArrivalKey = (item) => item?.atUri;

const LOADING = {
  items: null,
  status: 'loading',
  refreshedAt: null,
  source: null,
};

// What each remembering feed last showed, by its `remember` key and deps (see
// the hook's doc). Bounded because a key with a parameter in its deps can mint
// one entry per value; the feeds that opt in today take none.
const FEED_MEMORY_MAX = 8;
const feedMemory = new Map();

/** The state a remembering feed last showed under `key`, or null. */
export function recallFeed(key) {
  return (key && feedMemory.get(key)) || null;
}

/** Hold `state` as what the feed under `key` shows, if it shows anything. */
export function rememberFeed(key, state) {
  if (!key || state?.items == null) return;
  feedMemory.delete(key);
  feedMemory.set(key, state);
  while (feedMemory.size > FEED_MEMORY_MAX) {
    feedMemory.delete(feedMemory.keys().next().value);
  }
}

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
 *     If the live fetch fails, the snapshot stays up as `status: 'stale'`.
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
 * `remember` (a key unique to the page) keeps what the feed last showed for
 * the rest of the visit. Coming back to a remembering page then draws that at
 * once, as `ready`, and refreshes behind it, instead of opening on a skeleton
 * for the length of a network round trip — which also had the router's scroll
 * restoration waiting on the round trip before it could put the reader back
 * where they were. Rows already on screen don't slide in again; ones that
 * arrived while the reader was away do. A refresh that fails leaves the
 * remembered rows standing, with the status and time they were fetched at.
 *
 * `source` says where the items on screen came from: 'snapshot' (the build's
 * copy, possibly days old) or 'live'. A page whose snapshot can be too old to
 * draw anything useful can keep its placeholder up while `status` is 'ready'
 * and `source` is 'snapshot', since the live read is then still on its way.
 *
 *   { items, status: 'loading' | 'ready' | 'stale' | 'error', refreshedAt,
 *     source: 'snapshot' | 'live' | null, newKeys: Set<string> }
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
  remember = null,
  deps = [],
}) {
  const memoryKey = remember ? `${remember}|${JSON.stringify(deps)}` : null;
  const [state, setState] = useState(() => recallFeed(memoryKey) || LOADING);
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

  // Arrival bookkeeping, shared by a refresh tick and by the first live read
  // over a remembered paint: flag every key in `mapped` not shown before, so
  // its row slides in, and retire the flags once the entrance has played.
  // `seenKeys` seeds from what is on screen the first time it's needed, so
  // nothing that was already there animates.
  const keysOf = (items) => {
    const getKey = arrivalKeyRef.current || defaultArrivalKey;
    const keys = new Set();
    for (const it of items || []) {
      const k = getKey(it);
      if (k) keys.add(k);
    }
    return keys;
  };
  const flagArrivals = (mapped) => {
    if (!Array.isArray(mapped)) return;
    if (seenKeysRef.current === null) {
      seenKeysRef.current = keysOf(itemsRef.current);
    }
    const seen = seenKeysRef.current;
    const arrivals = new Set();
    for (const k of keysOf(mapped)) if (!seen.has(k)) arrivals.add(k);
    if (arrivals.size === 0) return;
    for (const k of arrivals) seen.add(k);
    setNewKeys(arrivals);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = null;
      setNewKeys(EMPTY_KEYS);
    }, ARRIVAL_HOLD_MS);
  };

  useEffect(() => {
    let cancelled = false;
    didInitRef.current = false;
    lastRevRef.current = null;
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    // A remembered paint stands in for the first one: drawn as it was, and the
    // baseline the first live read's arrivals are measured against.
    const remembered = recallFeed(memoryKey);
    seenKeysRef.current = remembered ? keysOf(remembered.items) : null;
    setState(remembered || LOADING);
    setNewKeys(EMPTY_KEYS);

    const apply = (data) => (mapItemsRef.current ? mapItemsRef.current(data) : data);
    const commit = (next) => {
      setState(next);
      rememberFeed(memoryKey, next);
    };
    // The live read landing. Over a remembered paint it's a refresh, and
    // anything new in it slides in; otherwise it's the first paint, which
    // never animates.
    const settle = (data) => {
      const mapped = apply(data);
      if (remembered) flagArrivals(mapped);
      commit({
        items: mapped,
        status: 'ready',
        refreshedAt: new Date(),
        source: 'live',
      });
    };

    const loadSnapshot = () =>
      fetchSnapshotRef.current
        ? Promise.resolve()
            .then(() => fetchSnapshotRef.current())
            .catch(() => null)
        : name
          ? fetchSnapshot(name).catch(() => null)
          : Promise.resolve(null);
    // Snapshot-first paints from the snapshot, so it starts at once. Live-first
    // only falls back to it, and on a healthy load never reads it at all — yet
    // it used to download and parse it every time (posts.json is 3 MB). So the
    // fallback is fetched only once the live read has failed, or has been out
    // for long enough that a reader on a bad connection deserves the cached copy
    // ready the moment it does.
    let snapshotPromise = null;
    const getSnapshot = () => {
      if (!snapshotPromise) snapshotPromise = loadSnapshot();
      return snapshotPromise;
    };
    // A remembered paint is newer than any snapshot, so neither strategy reads
    // one over it.
    let fallbackTimer = null;
    if (!remembered && strategy === 'snapshot-first') {
      getSnapshot();
    } else if (!remembered && fallbackOnError) {
      fallbackTimer = setTimeout(getSnapshot, LIVE_FALLBACK_HEADSTART_MS);
    }

    // The repo head as the live read starts, so the first tick can tell that
    // nothing has moved since. Read before the listing rather than after it: a
    // write that lands mid-listing then shows up as a newer rev next tick,
    // instead of being masked by a rev that already counts it.
    const revPromise =
      live && getRevRef.current
        ? Promise.resolve()
            .then(() => getRevRef.current())
            .catch(() => null)
        : null;
    const livePromise = fetchLiveRef.current
      ? Promise.resolve()
          .then(() => fetchLiveRef.current())
          .then(
            (data) => ({ ok: true, data }),
            (err) => ({ ok: false, err }),
          )
      : Promise.resolve({ ok: false, err: new Error('useLiveFeed: fetchLive is required') });
    const seedRev = async () => {
      const rev = revPromise ? await revPromise : null;
      if (!cancelled && rev) lastRevRef.current = rev;
    };

    async function run() {
      if (strategy === 'snapshot-first') {
        const snap = remembered ? null : await getSnapshot();
        if (!cancelled && snap != null) {
          const mapped = apply(snap);
          // Stay in `loading` if the snapshot didn't contain the requested
          // record (e.g. by-slug lookups on a stale snapshot). The live
          // fetch may still find it; transitioning to 'ready' here would
          // flash a "not found" before live arrives.
          if (mapped != null) {
            commit({
              items: mapped,
              status: 'ready',
              refreshedAt: new Date(),
              source: 'snapshot',
            });
          }
        }
        const live = await livePromise;
        if (cancelled) return;
        if (live.ok && live.data != null) {
          settle(live.data);
          await seedRev();
          return;
        }
        // Live failed. If the snapshot already gave us something it stays up,
        // now as 'stale' so a page holding out for the live read stops waiting;
        // a remembered live paint keeps its own status. With nothing on screen,
        // surface the error.
        setState((prev) =>
          prev.status === 'loading'
            ? { items: null, status: 'error', refreshedAt: null, source: null }
            : prev.source === 'snapshot'
              ? { ...prev, status: 'stale' }
              : prev,
        );
        return;
      }

      // live-first
      const live = await livePromise;
      clearTimeout(fallbackTimer);
      if (cancelled) return;
      if (live.ok && live.data != null) {
        settle(live.data);
        await seedRev();
        return;
      }
      // What was remembered is newer than the snapshot, and its status and
      // time still say truthfully when it was fetched.
      if (remembered) return;
      if (fallbackOnError) {
        const snap = await getSnapshot();
        if (cancelled) return;
        if (snap != null) {
          commit({
            items: apply(snap),
            status: 'stale',
            refreshedAt: new Date(),
            source: 'snapshot',
          });
          return;
        }
      }
      setState({
        items: null,
        status: 'error',
        refreshedAt: null,
        source: null,
      });
    }

    // `didInit` unblocks the live tick only once the initial load settles
    // (success or failure), so a fast first tick can't race the first paint.
    run().finally(() => {
      if (!cancelled) didInitRef.current = true;
    });
    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
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

        // Diff the refreshed records against everything shown so far — only
        // genuinely new records slide in. React 18 batches these back-to-back
        // updates into one commit, so a new row mounts with its key already in
        // `newKeys` and the entrance animation actually plays (mirrors the
        // home feed's runRefresh).
        flagArrivals(mapped);
        const next = {
          items: mapped,
          status: 'ready',
          refreshedAt: new Date(),
          source: 'live',
        };
        setState(next);
        rememberFeed(memoryKey, next);
        if (rev) lastRevRef.current = rev;
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
