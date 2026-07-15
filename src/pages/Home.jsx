import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Shuffle } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import FeedFilters, {
  feedFilterCounts,
  filterFeed,
  resolveActiveVerbs,
} from '../components/FeedFilters.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import HeroSentence from '../components/HeroSentence.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { photoUrl } from '../lib/inaturalist.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import {
  readFeedCache,
  writeFeedCache,
  isCacheFresh,
  beginRefresh,
  endRefresh,
} from '../lib/feedCache.js';
import { groupByDay } from '../lib/time.js';
import { collapseListens } from '../lib/listenSessions.js';
import { resolvePds } from '../lib/atproto.js';
import { buildUnifiedFeed } from '../lib/feedBuilder.js';
import { groupSelfReplyThreads, threadAwareDateKey } from '../lib/threadGrouping.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { usePublishLatestRecord } from '../hooks/useFeedFooter.jsx';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

const FEED_CACHE_KEY = 'unifiedFeed';
const CACHE_TTL_MS = 30_000;
// First-paint cap per collection — matches AT Proto's per-request
// listRecords ceiling, so each collection lands in a single round trip
// with no extra pagination. Background polls keep the same cap; deeper
// history isn't fetched — scrolling only reveals what's already in memory.
const INITIAL_FETCH_MAX = 100;
// How many items the feed renders on first paint, and how many more each
// auto-reveal adds as the reader nears the bottom. The step is kept well
// taller than a viewport so one reveal pushes the scroll sentinel back out
// of range — it re-fires on the next scroll, never in a runaway loop.
const INITIAL_VISIBLE = 100;
const LOAD_MORE_STEP = 100;
// Snapshot is now a fallback only (shown when the live fetch errors).
// Cap how much of it we render so an old, fat snapshot doesn't dominate
// the page when the network is flaky.
const SNAPSHOT_FALLBACK_MAX = 60;


/**
 * True when every verb in `need` was part of the `have` fetch set — i.e.
 * the data we already hold can satisfy the requested filter without a new
 * live fetch. `have` may be undefined (older cache shape) → not covered.
 */
function verbsCovered(have, need) {
  if (!have) return false;
  const set = have instanceof Set ? have : new Set(have);
  for (const v of need) if (!set.has(v)) return false;
  return true;
}

// The unified snapshot is static per deploy, so memoize the fetch for the
// session: it backs both the instant first paint and the "estimated from
// snapshot" chip counts for verbs we haven't fetched live. At most one
// network round trip per page load; failures clear the memo so a later
// mount can retry.
let _unifiedSnapshotPromise = null;
function loadUnifiedSnapshot() {
  if (!_unifiedSnapshotPromise) {
    _unifiedSnapshotPromise = fetchSnapshot(FEED_CACHE_KEY).catch((err) => {
      _unifiedSnapshotPromise = null;
      throw err;
    });
  }
  return _unifiedSnapshotPromise;
}

/**
 * Per-day summary line shown beside each day header in the home feed,
 * e.g. "59 items, 120 interactions".
 *   - items — real underlying records (listen batches expand to their
 *             `count` so a session of 10 songs reads as 10 items, not 1).
 *   - interactions — sum of like/repost/reply counts across this day's
 *                    posting items; how much activity those posts
 *                    attracted on Bluesky.
 * Parts with a zero count are omitted so quieter days read clean.
 */
function dayStatsLine(items) {
  let count = 0;
  let interactions = 0;
  for (const item of items || []) {
    count += item?.count || 1;
    if (item?.verb === 'posting') {
      const p = item.payload || {};
      interactions += (p.likeCount || 0) + (p.repostCount || 0) + (p.replyCount || 0);
    }
  }
  const parts = [];
  if (count) parts.push(`${count} ${count === 1 ? 'item' : 'items'}`);
  if (interactions) parts.push(`${interactions} ${interactions === 1 ? 'interaction' : 'interactions'}`);
  return parts.join(', ');
}

/**
 * The most recent day's summary line doubles as the live-refresh
 * indicator. While a refresh is confirming the latest activity the line
 * reads "Fetching latest activity…"; once the live result lands it
 * cross-fades to that day's real engagement/stats. This keeps the signal
 * to a single quiet line under the date instead of a separate banner.
 */
function DayActivityMeta({ checking, stats, reduce }) {
  const fade = {
    initial: reduce ? false : { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: reduce ? 0 : 0.28, ease: 'easeOut' },
  };
  return (
    <AnimatePresence mode="wait" initial={false}>
      {checking ? (
        <motion.span
          key="fetching"
          className="feed-activity-fetching"
          role="status"
          aria-live="polite"
          {...fade}
        >
          Fetching latest activity&hellip;
        </motion.span>
      ) : (
        <motion.span key="stats" {...fade}>
          {stats}
        </motion.span>
      )}
    </AnimatePresence>
  );
}


export default function Home() {
  const [params] = useSearchParams();

  // Which verbs the active filter set actually needs fetched. `replying`
  // is a virtual filter over `posting` records, so it folds onto posting.
  // The default view (DEFAULT_HOME_VERBS) omits `liking`, so that verb —
  // and its slow per-record subject hydration — is never fetched until the
  // user opts in via the filter chips.
  const activeVerbs = useMemo(() => resolveActiveVerbs(params), [params]);
  const fetchVerbs = useMemo(() => {
    const s = new Set();
    for (const v of activeVerbs) s.add(v === 'replying' ? 'posting' : v);
    return s;
  }, [activeVerbs]);
  const fetchVerbsKey = useMemo(
    () => Array.from(fetchVerbs).sort().join(','),
    [fetchVerbs],
  );
  // Latest-value ref so the polling tick / refresh closure always fetch
  // the currently-active verb set without re-subscribing.
  const fetchVerbsRef = useRef(fetchVerbs);
  fetchVerbsRef.current = fetchVerbs;

  // Hydrate synchronously from the in-memory cache so navigating
  // Home → About → Home within the TTL re-renders the feed instantly
  // with no skeleton flash.
  const initialCache = readFeedCache(FEED_CACHE_KEY);
  const [feed, setFeed] = useState(initialCache ? initialCache.items : null);
  const [loadedAt, setLoadedAt] = useState(
    initialCache && initialCache.loadedAt ? new Date(initialCache.loadedAt) : null,
  );
  const [refreshState, setRefreshState] = useState(initialCache ? 'ready' : 'idle');
  // Verbs the most recent *live* result covered. Drives the "checking for
  // recent activity" banner: while a refresh is in flight for verbs we
  // can't yet show (first paint from snapshot, or a newly-enabled verb),
  // we surface the banner; routine 30s background refreshes don't.
  const [liveVerbs, setLiveVerbs] = useState(() => initialCache?.fetchedVerbs || []);
  // What produced the currently-displayed `feed`: 'none' (nothing yet),
  // 'cache' (in-memory hydrate), 'snapshot' (static first paint), or
  // 'live'. The snapshot painter only acts while this is 'none', and a
  // resolved live refresh always wins the race.
  const feedSourceRef = useRef(initialCache ? 'cache' : 'none');
  // The static snapshot, kept around to estimate chip counts for verbs we
  // haven't fetched live (e.g. liking on the default view).
  const [snapshotFeed, setSnapshotFeed] = useState(null);

  const reduce = useReducedMotion();

  // How many items the feed is currently rendering. Starts at
  // INITIAL_VISIBLE and grows by LOAD_MORE_STEP as the reader nears the
  // bottom (an IntersectionObserver sentinel auto-reveals the next window;
  // see below). Resets when the active filter set changes so the user
  // always starts from the top of the new view.
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const filterSig = params.toString();
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [filterSig]);

  // Whether the browser can auto-reveal on scroll. When IntersectionObserver
  // is unavailable we fall back to rendering the manual "Load more" button so
  // those readers can still page through the feed.
  const [ioSupported] = useState(() => typeof IntersectionObserver !== 'undefined');

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

  // HeroSentence registers its imperative shuffle handle here so the
  // shuffle button in the hero CTA row can advance both rotators
  // without owning the hero's state.
  const shuffleRef = useRef(null);

  const runRefresh = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;

    const token = { cancelled: false };
    inflightRef.current = token;

    // Snapshot the verb set for this run so the cache + coverage record
    // it accurately even if the active filter changes mid-flight.
    const verbs = Array.from(fetchVerbsRef.current);

    setRefreshState('refreshing');
    beginRefresh();

    // Strategy: live wins. The static snapshot is painted instantly on
    // first load by a separate effect (see below); here we fetch the
    // live feed and, once it resolves, replace whatever's showing. The
    // snapshot is also the error fallback if the live fetch fails.
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
          verbs,
          // Pull iNaturalist observations newer than the newest mirrored one
          // so brand-new sightings show without waiting for the mirror cron.
          liveObservations: true,
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
      const seed = await loadUnifiedSnapshot().catch(() => null);
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
    feedSourceRef.current = 'live';
    setFeed(nextFeed);
    setLoadedAt(now);
    setRefreshState(nextRefreshState);
    setLiveVerbs(verbs);
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
      fetchedVerbs: verbs,
    });

    if (inflightRef.current === token) inflightRef.current = null;
    endRefresh();
    return nextFeed;
  }, []);

  // Load the prebuilt /data/unifiedFeed.json snapshot once on mount. It
  // serves two jobs: (1) first paint — when there's no usable in-memory
  // cache, render it the instant it lands so the user sees real (if
  // possibly-stale) content instead of a bare skeleton while the live
  // fetch runs; (2) estimated chip counts for verbs we don't fetch live.
  // The snapshot holds every verb, so it can satisfy any filter; the live
  // refresh always wins the first-paint race (guarded by feedSourceRef).
  useEffect(() => {
    let cancelled = false;
    loadUnifiedSnapshot()
      .then((snap) => {
        if (cancelled || !Array.isArray(snap)) return;
        setSnapshotFeed(snap);
        if (feedSourceRef.current !== 'none') return;
        feedSourceRef.current = 'snapshot';
        // Seed seenUris so snapshot rows don't animate; genuinely new
        // items from the live fetch still slide in.
        for (const item of snap) {
          if (item?.atUri) seenUrisRef.current.add(item.atUri);
        }
        setFeed(snap);
        setLoadedAt((cur) => cur || new Date());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger a live refresh on mount and whenever the active verb set
  // changes. Skips the fetch when the in-memory cache is still fresh AND
  // already covers the requested verbs (e.g. narrowing the filter to a
  // subset we've loaded → pure client-side filter, no round trip).
  useEffect(() => {
    const entry = readFeedCache(FEED_CACHE_KEY);
    const fresh = isCacheFresh(FEED_CACHE_KEY, CACHE_TTL_MS);
    const covered = entry && verbsCovered(entry.fetchedVerbs, fetchVerbsRef.current);
    if (!entry || !fresh || !covered) {
      runRefresh();
    }
    return () => {
      if (inflightRef.current) inflightRef.current.cancelled = true;
    };
    // fetchVerbsKey re-runs this when the filter widens; fetchVerbsRef
    // carries the current set into the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchVerbsKey, runRefresh]);

  // Keep the feed alive on the shared 30s refresh tick — same cadence
  // as NowPlaying and NowStatus, so all the "live" surfaces update
  // together. The tick already skips while the tab is hidden and
  // fires on visibility return, so we don't need separate handlers.
  useEffect(() => subscribeRefreshTick(runRefresh), [runRefresh]);

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
  // Show the "checking for recent activity" notice while we don't yet have
  // live-confirmed data for the active verbs — i.e. the very first load
  // (nothing rendered yet) or while a refresh is in flight for verbs the
  // displayed feed can't vouch for (snapshot/cache first paint, or a
  // just-enabled verb). Once a live result covers the active set, routine
  // 30s background refreshes fall back to the quiet footer indicator. The
  // notice replaces the old skeleton placeholder entirely — any content we
  // already have (snapshot/cache) renders beneath it.
  const checking =
    loading ||
    (refreshState === 'refreshing' && !verbsCovered(liveVerbs, fetchVerbs));

  // Chip counts. Verbs covered by the latest live fetch get exact counts
  // from the displayed feed; verbs we haven't fetched live (e.g. liking on
  // the default view) fall back to a count estimated from the static
  // snapshot, flagged so the UI can mark it as approximate.
  const liveCounts = useMemo(() => feedFilterCounts(safeFeed, ME_DID), [safeFeed]);
  const snapshotCounts = useMemo(
    () => (snapshotFeed ? feedFilterCounts(snapshotFeed, ME_DID) : null),
    [snapshotFeed],
  );
  const { counts, estimatedVerbs } = useMemo(() => {
    const liveSet = new Set(liveVerbs);
    // A filter key is "live-known" when its underlying fetch verb was in
    // the latest live result. `replying` is a virtual view of `posting`.
    const isLive = (key) => liveSet.has(key === 'replying' ? 'posting' : key);
    const out = {};
    const est = new Set();
    const keys = new Set([
      ...Object.keys(liveCounts),
      ...(snapshotCounts ? Object.keys(snapshotCounts) : []),
    ]);
    for (const key of keys) {
      if (isLive(key)) {
        if (typeof liveCounts[key] === 'number') out[key] = liveCounts[key];
      } else if (snapshotCounts && typeof snapshotCounts[key] === 'number') {
        out[key] = snapshotCounts[key];
        est.add(key);
      }
    }
    return { counts: out, estimatedVerbs: est };
  }, [liveCounts, snapshotCounts, liveVerbs]);

  // Records the owner deleted this session are dropped optimistically so
  // the feed reflects the change immediately, ahead of the next live fetch
  // (which won't return them anyway).
  const { removedUris, active: editActive } = useEditMode();

  // Which of the two feed layouts to render: the default card view, or
  // the condensed multi-column "ledger" (toggled from the nav dock).
  // Owner edit mode always gets the full cards — the selection UI
  // (per-song listen selection, select marks) lives in the card
  // renderers, so the ledger steps aside while it's active.
  const { layout } = useFeedLayout();
  const ledger = layout === 'ledger' && !editActive;
  const filtered = useMemo(() => {
    const base = filterFeed(safeFeed, params, ME_DID);
    if (!removedUris || removedUris.size === 0) return base;
    return base.filter((item) => !removedUris.has(item.atUri));
  }, [safeFeed, params, removedUris]);
  // Client-side pagination — the user only sees the first `visibleCount`
  // filtered items at a time. Slicing here (before threading / day
  // grouping) means thread chains never get split mid-conversation: each
  // visible window is a clean prefix of the filtered timeline.
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = filtered.length > visible.length;

  // Grow the visible window as the reader nears the bottom. The extra items
  // are already in memory, so this is an instant reveal rather than a fetch;
  // the bottom sentinel drives it via IntersectionObserver, with the manual
  // button kept only as a no-observer fallback (see the feed foot below).
  const loadMore = useCallback(
    () => setVisibleCount((n) => n + LOAD_MORE_STEP),
    [],
  );
  const sentinelRef = useInfiniteScroll(loadMore, { enabled: hasMore });

  // Photographed iNaturalist observations (mothing + observing) currently in
  // view, shaped for the in-feed image lightbox. Tapping an observation row
  // opens this at that observation's index; prev/next then walks every
  // observation on screen — the home-feed cousin of the /mothing grid's
  // lightbox. Keyed by at:// URI so a tapped row maps straight to its slide.
  const observationPhotos = useMemo(() => {
    const images = [];
    const indexByUri = new Map();
    for (const item of visible) {
      if (item.verb !== 'mothing' && item.verb !== 'observing') continue;
      const photo = item.payload?.photos?.[0];
      const large = photo ? photoUrl(photo, 'large') : null;
      if (!large) continue;
      const taxon = item.payload?.taxon || {};
      const name =
        taxon.commonName ||
        taxon.name ||
        (item.verb === 'mothing' ? 'Unidentified moth' : 'Unidentified organism');
      const sci = taxon.name;
      if (item.atUri) indexByUri.set(item.atUri, images.length);
      images.push({
        src: large,
        thumb: photoUrl(photo, 'medium'),
        alt: sci && sci !== name ? `${name} — ${sci}` : name,
        sourceUrl: item.payload?.url || undefined,
        searchUrl: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(large)}`,
      });
    }
    return { images, indexByUri };
  }, [visible]);

  // `lightboxIndex` is the active slide, -1 when closed. A ref carries the
  // latest URI→index map so the open callback stays stable across renders
  // (it's handed to every FeedItem).
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const observationPhotosRef = useRef(observationPhotos);
  observationPhotosRef.current = observationPhotos;
  const openObservationLightbox = useCallback((item) => {
    const idx = observationPhotosRef.current.indexByUri.get(item?.atUri);
    if (typeof idx === 'number' && idx >= 0) setLightboxIndex(idx);
  }, []);

  // The feed has no single backing record, so hand the global footer the
  // newest visible record's instant — it reports "latest record …" in place
  // of the record page's "written … · updated …" pair.
  usePublishLatestRecord(filtered[0]?.createdAt || null);
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

  // The home feed aggregates many records; it has no single is.dame.page/home
  // backing record (none exists, and it isn't in PAGE_REGISTRY), so PageShell
  // gets no `atUri`. Advertising that phantom record made the debug pane's
  // "Edit record" surface a raw PDS "Could not locate record" error and emitted
  // a dead <link rel="alternate"> hint. See pageRkeyForPath in
  // src/hooks/useAtUri.js.
  return (
    <PageShell
      title={<HeroSentence shuffleRef={shuffleRef} />}
      headTitle="dame.is"
      selectable
    >
      <nav className="home-hero-cta" aria-label="Primary destinations">
        <Link className="home-hero-cta-btn home-hero-cta-primary" to="/available">
          Resume
        </Link>
        <Link className="home-hero-cta-btn" to="/creating">
          Projects
        </Link>
        <Link className="home-hero-cta-btn" to="/blogging">
          Blog
        </Link>
        <button
          type="button"
          className="home-hero-cta-btn home-hero-shuffle"
          onClick={() => shuffleRef.current?.()}
          aria-label="Shuffle hero statement"
          title="Shuffle hero statement"
        >
          <Shuffle size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </nav>

      <section className="home-latest">
        <FeedFilters counts={counts} estimatedVerbs={estimatedVerbs} />
        {/* One flex child holds the whole feed body (or the cold-load
            fetching line) so its spacing rides in the wrapper rather than
            in the parent's animatable flex `gap`. */}
        <div className={`home-feed-region${ledger ? ' feed-ledger' : ''}`}>
          {loading || (checking && filtered.length === 0) ? (
            <p className="feed-activity-standalone" role="status" aria-live="polite">
              Fetching latest activity&hellip;
            </p>
          ) : filtered.length === 0 ? (
            <p className="feed-empty">No records match these filters.</p>
          ) : (
            <ol className="feed-list reveal-stagger">
            {groups.map((group, gi) => (
              <li key={group.dateKey} className="feed-day-group">
                <DayOfLifeHeader
                  date={group.date}
                  variant={ledger ? 'ledger' : 'default'}
                  meta={
                    gi === 0 ? (
                      <DayActivityMeta
                        checking={checking}
                        stats={dayStatsLine(group.items)}
                        reduce={reduce}
                      />
                    ) : (
                      dayStatsLine(group.items)
                    )
                  }
                />
                {/* The ledger's day header carries its own bottom rule, so
                    the list sits flush beneath it; the card layout keeps a
                    breathing gap. */}
                <ul
                  className="feed-list"
                  style={ledger ? undefined : { marginTop: 'var(--space-3)' }}
                >
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
                          <FeedItem
                            item={item}
                            layout={ledger ? 'ledger' : 'cards'}
                            onOpenLightbox={ledger ? openObservationLightbox : undefined}
                          />
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              </li>
            ))}
          </ol>
          )}
        </div>
        {!loading && hasMore && (
          ioSupported ? (
            // Invisible tripwire: as it scrolls into range the visible window
            // grows (client-side, instant — the next batch is already loaded).
            <div ref={sentinelRef} className="feed-load-sentinel" aria-hidden="true" />
          ) : (
            <div className="feed-load-more">
              <button
                type="button"
                className="feed-load-more-btn"
                onClick={loadMore}
              >
                Load more
              </button>
            </div>
          )
        )}
      </section>

      <Lightbox
        open={lightboxIndex >= 0}
        index={Math.max(0, lightboxIndex)}
        onClose={() => setLightboxIndex(-1)}
        images={observationPhotos.images}
      />
    </PageShell>
  );
}
