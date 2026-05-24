import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import PageShell from '../components/PageShell.jsx';
import FeedFilters, { filterFeed } from '../components/FeedFilters.jsx';
import FeedItem from '../components/FeedItem.jsx';
import FeedLiveStatus from '../components/FeedLiveStatus.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
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
// First-paint cap per collection — matches AT Proto's per-request
// listRecords ceiling, so each collection lands in a single round trip
// with no extra pagination. Background polls keep the same cap; deeper
// history isn't fetched, only `Load more` reveals what's already there.
const INITIAL_FETCH_MAX = 100;
// How many items the feed renders before showing the "Load more" CTA,
// and how many additional items each click reveals.
const INITIAL_VISIBLE = 100;
const LOAD_MORE_STEP = 100;
// Snapshot is now a fallback only (shown when the live fetch errors).
// Cap how much of it we render so an old, fat snapshot doesn't dominate
// the page when the network is flaky.
const SNAPSHOT_FALLBACK_MAX = 60;

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

  // How many items the feed is currently rendering. Starts at
  // INITIAL_VISIBLE and grows by LOAD_MORE_STEP each click of the
  // "Load more" CTA at the bottom of the feed. Resets when the active
  // filter set changes so the user always starts from the top of the
  // new view.
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const filterSig = params.toString();
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [filterSig]);

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

    // Strategy: live wins. The prebuilt snapshot is a fallback only —
    // we fetch it lazily and only render it if the live fetch fails.
    // (Showing snapshot first then replacing with live made the feed
    // visibly "twitch" as items reordered.)
    let live = null;
    let liveError = null;
    try {
      const pds = await resolvePds(ME_DID);
      const result = await buildUnifiedFeed({
        pds,
        me: ME_DID,
        options: {
          warn: (...args) => console.warn('[home]', ...args),
          initialMax: INITIAL_FETCH_MAX,
          authorFeedMax: INITIAL_FETCH_MAX,
          skipListMembers: true,
        },
      });
      live = Array.isArray(result?.unified) ? result.unified : null;
    } catch (err) {
      liveError = err;
      console.warn('[home] live refresh failed', err);
    }

    if (token.cancelled) {
      if (inflightRef.current === token) inflightRef.current = null;
      endRefresh();
      return null;
    }

    let nextFeed = null;
    let nextRefreshState = 'ready';

    if (live) {
      nextFeed = live;
    } else {
      // Live failed — fall back to the snapshot, capped so a fat old
      // snapshot doesn't dwarf the user's actual "Load more" history.
      const seed = await fetchSnapshot(FEED_CACHE_KEY).catch(() => null);
      if (token.cancelled) {
        if (inflightRef.current === token) inflightRef.current = null;
        endRefresh();
        return null;
      }
      if (Array.isArray(seed)) {
        nextFeed = seed.slice(0, SNAPSHOT_FALLBACK_MAX);
        nextRefreshState = liveError ? 'stale' : 'ready';
      } else {
        nextFeed = [];
        nextRefreshState = liveError ? 'error' : 'ready';
      }
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
  // "Load more" pagination — the user only sees the first `visibleCount`
  // filtered items at a time. Slicing here (before threading / day
  // grouping) means thread chains never get split mid-conversation: each
  // visible window is a clean prefix of the filtered timeline.
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = filtered.length > visible.length;
  const collapsed = useMemo(() => collapseListens(visible), [visible]);
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
      title={<>dame <span className="gerund">is</span></>}
      intro="A design engineer and artist building tools and making things on the open web."
      atUri={`at://${ME_DID}/is.dame.page/home`}
      headTitle="Dame is&hellip;"
    >
      <section className="home-latest">
        <h2 className="home-latest-title">Latest</h2>
        <FeedFilters counts={counts} />
        {loading ? (
          <FeedSkeleton rows={8} />
        ) : filtered.length === 0 ? (
          <p className="feed-empty">No records match these filters.</p>
        ) : (
          <ol className="feed-list reveal-stagger">
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
        {!loading && hasMore && (
          <div className="feed-load-more">
            <button
              type="button"
              className="feed-load-more-btn"
              onClick={() => setVisibleCount((n) => n + LOAD_MORE_STEP)}
            >
              Load more
              <span className="feed-load-more-count">
                {' '}({visible.length} of {filtered.length})
              </span>
            </button>
          </div>
        )}
        {!loading && loadedAt && (
          <FeedLiveStatus
            refreshState={refreshState}
            loadedAt={loadedAt}
            summary={`${visible.length} of ${filtered.length} shown · ${safeFeed.length} loaded`}
          />
        )}
      </section>
    </PageShell>
  );
}
