import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import PageShell from '../components/PageShell.jsx';
import FeedFilters, { filterFeed } from '../components/FeedFilters.jsx';
import FeedItem from '../components/FeedItem.jsx';
import FeedLiveStatus from '../components/FeedLiveStatus.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { fetchSnapshot, mergeByKey } from '../lib/snapshot.js';
import {
  readFeedCache,
  writeFeedCache,
  isCacheFresh,
  beginRefresh,
  endRefresh,
} from '../lib/feedCache.js';
import { groupByDay } from '../lib/time.js';
import { resolvePds } from '../lib/atproto.js';
import { buildUnifiedFeed } from '../lib/feedBuilder.js';
import { groupSelfReplyThreads, threadAwareDateKey } from '../lib/threadGrouping.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

const FEED_CACHE_KEY = 'unifiedFeed';
const CACHE_TTL_MS = 30_000;
const POLL_INTERVAL_MS = 60_000;

function dayKey(iso) {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

/**
 * Collapse runs of consecutive `listening` items on the same day into one
 * row with a count, so /  doesn't drown in single-track plays.
 */
function collapseListens(items) {
  const out = [];
  let run = null;
  for (const item of items) {
    if (item.verb === 'listening') {
      const key = dayKey(item.createdAt);
      if (run && run.verb === 'listening' && dayKey(run.createdAt) === key) {
        run.count = (run.count || 1) + 1;
        run.plays.push(item);
        continue;
      }
      run = { ...item, count: 1, plays: [item] };
      out.push(run);
    } else {
      run = null;
      out.push(item);
    }
  }
  return out;
}

export default function Home() {
  const [params] = useSearchParams();

  // Hydrate synchronously from the in-memory cache so navigating
  // Home → About → Home within the TTL re-renders the feed instantly
  // with no skeleton flash.
  const initialCache = readFeedCache(FEED_CACHE_KEY);
  const [feed, setFeed] = useState(initialCache ? initialCache.items : null);
  const [loadedAt, setLoadedAt] = useState(
    initialCache && initialCache.loadedAt ? new Date(initialCache.loadedAt) : null,
  );
  const [refreshState, setRefreshState] = useState(initialCache ? 'ready' : 'idle');

  const reduce = useReducedMotion();

  // URIs we've already shown the user. Anything missing on a refresh is
  // a "new arrival" and gets the slide-in animation. Seeded from cache
  // so the items we hydrated with don't animate on first paint.
  const seenUrisRef = useRef(new Set());
  // URIs whose `motion.li` should run the slide-in. Cleared after each
  // render via a layout effect (see below).
  const [newUris, setNewUris] = useState(() => new Set());
  if (seenUrisRef.current.size === 0 && initialCache?.items) {
    for (const item of initialCache.items) {
      if (item?.atUri) seenUrisRef.current.add(item.atUri);
    }
  }

  // The active refresh — we hold it on a ref so the polling tick can
  // skip if one is already in flight, and `cancelled` cleanup can mark
  // it stale on unmount.
  const inflightRef = useRef(null);

  const runRefresh = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;

    const token = { cancelled: false };
    inflightRef.current = token;

    setRefreshState('refreshing');
    beginRefresh();

    const snapshotPromise = fetchSnapshot(FEED_CACHE_KEY).catch(() => null);

    let live = null;
    let liveError = null;
    try {
      const pds = await resolvePds(ME_DID);
      const result = await buildUnifiedFeed({
        pds,
        me: ME_DID,
        options: {
          warn: (...args) => console.warn('[home]', ...args),
        },
      });
      live = Array.isArray(result?.unified) ? result.unified : null;
    } catch (err) {
      liveError = err;
      console.warn('[home] live refresh failed', err);
    }

    const seed = await snapshotPromise;

    if (token.cancelled) {
      if (inflightRef.current === token) inflightRef.current = null;
      endRefresh();
      return null;
    }

    let nextFeed = null;
    let nextRefreshState = 'ready';

    if (live) {
      nextFeed = Array.isArray(seed) && seed.length
        ? mergeByKey(seed, live, (item) => item?.atUri)
        : live;
    } else if (Array.isArray(seed)) {
      nextFeed = seed;
      if (liveError) nextRefreshState = 'error';
    } else {
      nextFeed = [];
      if (liveError) nextRefreshState = 'error';
    }

    // Diff against what the user has already seen. New URIs animate in;
    // everything else re-renders in place via Motion's `initial={false}`.
    const arrivals = new Set();
    for (const item of nextFeed) {
      const uri = item?.atUri;
      if (uri && !seenUrisRef.current.has(uri)) arrivals.add(uri);
    }

    const now = new Date();
    setFeed(nextFeed);
    setLoadedAt(now);
    setRefreshState(nextRefreshState);
    // Only flag arrivals on background refreshes — the very first load
    // (when seenUris is still empty) shouldn't slide every row in.
    if (seenUrisRef.current.size > 0 && arrivals.size > 0) {
      setNewUris(arrivals);
    }
    for (const uri of arrivals) seenUrisRef.current.add(uri);

    writeFeedCache(FEED_CACHE_KEY, {
      items: nextFeed,
      loadedAt: now.getTime(),
      fetchedAt: Date.now(),
    });

    if (inflightRef.current === token) inflightRef.current = null;
    endRefresh();
    return nextFeed;
  }, []);

  // Initial load / cache hydration → maybe refresh.
  useEffect(() => {
    if (!isCacheFresh(FEED_CACHE_KEY, CACHE_TTL_MS)) {
      runRefresh();
    }
    return () => {
      if (inflightRef.current) inflightRef.current.cancelled = true;
    };
  }, [runRefresh]);

  // Keep the feed alive: poll while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      runRefresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [runRefresh]);

  // Refresh when the tab comes back into focus after being hidden long
  // enough for the cache to go stale.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.hidden) return;
      if (!isCacheFresh(FEED_CACHE_KEY, CACHE_TTL_MS)) runRefresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [runRefresh]);

  // Clear the arrival set once Motion has had a chance to play the
  // entrance animation, so the same items don't re-animate on the next
  // unrelated render (filter change, etc.).
  useEffect(() => {
    if (newUris.size === 0) return undefined;
    const id = setTimeout(() => setNewUris(new Set()), 1200);
    return () => clearTimeout(id);
  }, [newUris]);

  const loading = feed === null;
  const safeFeed = feed || [];

  const counts = useMemo(() => {
    const c = {};
    for (const item of safeFeed) c[item.verb] = (c[item.verb] || 0) + 1;
    return c;
  }, [safeFeed]);

  const filtered = useMemo(() => filterFeed(safeFeed, params), [safeFeed, params]);
  const collapsed = useMemo(() => collapseListens(filtered), [filtered]);
  const threaded = useMemo(() => groupSelfReplyThreads(collapsed, ME_DID), [collapsed]);
  const groups = useMemo(() => groupByDay(threaded, threadAwareDateKey), [threaded]);

  // Stagger delays among the new arrivals (top-down cascade).
  const arrivalIndex = useMemo(() => {
    const map = new Map();
    let i = 0;
    for (const group of groups) {
      for (const item of group.items) {
        if (item?.atUri && newUris.has(item.atUri)) {
          map.set(item.atUri, i++);
        }
      }
    }
    return map;
  }, [groups, newUris]);

  return (
    <PageShell
      title="Latest"
      intro="What Dame has been up to most recently. Powered by the AT Protocol."
      atUri={`at://${ME_DID}/is.dame.page/home`}
      headTitle="Dame is&hellip;"
    >
      <FeedFilters counts={counts} />
      {loading ? (
        <FeedSkeleton rows={8} />
      ) : filtered.length === 0 ? (
        <p className="feed-empty">No records match these filters.</p>
      ) : (
        <ol className="feed-list">
          {groups.map((group) => (
            <li key={group.dateKey} className="feed-day-group">
              <DayOfLifeHeader date={group.date} />
              <ul className="feed-list" style={{ marginTop: 'var(--space-3)' }}>
                <AnimatePresence initial={false}>
                  {group.items.map((item, i) => {
                    const uri = item?.atUri;
                    const isNew = uri ? newUris.has(uri) : false;
                    const stagger = isNew ? (arrivalIndex.get(uri) ?? 0) * 0.06 : 0;
                    return (
                      <motion.li
                        key={uri || `fallback-${group.dateKey}-${i}`}
                        layout
                        initial={isNew && !reduce ? { opacity: 0, y: -24 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: reduce ? 0 : 0.45,
                          ease: [0.22, 0.61, 0.36, 1],
                          delay: reduce ? 0 : stagger,
                        }}
                      >
                        <FeedItem item={item} />
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </li>
          ))}
        </ol>
      )}
      {!loading && loadedAt && (
        <FeedLiveStatus
          refreshState={refreshState}
          loadedAt={loadedAt}
          summary={`${filtered.length} of ${safeFeed.length} records`}
        />
      )}
    </PageShell>
  );
}
