import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Shuffle, Signature, X } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import FeedFilters, {
  feedFilterCounts,
  filterFeed,
  resolveActiveVerbs,
} from '../components/FeedFilters.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import HeroSentence from '../components/HeroSentence.jsx';
import VerbIcon from '../components/VerbIcon.jsx';
import { verbIndexIntro } from '../lib/recordPlate.js';
import Lightbox from '../components/Lightbox.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { photoUrl } from '../lib/inaturalist.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import {
  readFeedCache,
  writeFeedCache,
  isCacheFresh,
  beginRefresh,
  endRefresh,
} from '../lib/feedCache.js';
import { formatTime, groupByDay } from '../lib/time.js';
import { collapseListens } from '../lib/listenSessions.js';
import { collapseObservations } from '../lib/observationBatches.js';
import { markFirstSightings, mergeFirstSightings } from '../lib/firstSightings.js';
import { resolvePds, getRepoRev } from '../lib/atproto.js';
import {
  buildUnifiedFeed,
  localizeObservationInstants,
} from '../lib/feedBuilder.js';
import {
  assignRowKeys,
  carryOverFailedSources,
  classifyBuild,
  completeSince,
  insertHorizonMarkers,
  isHorizonMarker,
  rebuildVerbs,
  splitYearOnlyWorks,
  trimToHorizons,
} from '../lib/homeFeed.js';
import { longDay } from '../lib/ledger.js';
import { verbsWithEverySourceIn } from '../lib/verbRegistry.js';
import { createSubjectResolver } from '../lib/subjectResolver.js';
import {
  collapseSelfThreads,
  completeSelfThreads,
  groupSelfReplyThreads,
  isSelfThreadRow,
  threadAwareDateKey,
} from '../lib/threadGrouping.js';
import { useThreadBackfill } from '../hooks/useThreadBackfill.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { usePublishLatestRecord } from '../hooks/useFeedFooter.jsx';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll.js';
import { useChromePanelActions } from '../hooks/useChromePanel.jsx';
import { useFirstSightings } from '../hooks/useFirstSightings.js';
import { useNow } from '../hooks/useNow.js';
import { ME_DID } from '../config.js';
import Fleuron from '../components/Fleuron.jsx';
import '../components/Feed.css';

const FEED_CACHE_KEY = 'unifiedFeed';
const CACHE_TTL_MS = 30_000;
// Stable stand-in for "nothing loaded yet", so the memos derived from the feed
// don't re-run on every render while it's still null.
const EMPTY_FEED = [];
// First-paint cap per collection — matches AT Proto's per-request
// listRecords ceiling, so each collection lands in a single round trip
// with no extra pagination. Background polls keep the same cap; deeper
// history isn't fetched — scrolling only reveals what's already in memory,
// and each verb ends at a marker where its capped fetch ran out (see
// trimToHorizons in lib/homeFeed.js).
const INITIAL_FETCH_MAX = 100;
// How many items the feed renders on first paint, and how many more each
// auto-reveal adds as the reader nears the bottom. Collapsing can make a
// step much shorter than it sounds (a hundred plays may be four sessions),
// so the scroll hook re-checks after every reveal rather than counting on
// one step to push the sentinel out of range.
const INITIAL_VISIBLE = 100;
const LOAD_MORE_STEP = 100;
// A partial build (some sources failed) is retried on the next tick, but only
// this many times in a row: a source that keeps failing shouldn't turn every
// 30s tick into a full rebuild. Its rows are carried over meanwhile.
const MAX_PARTIAL_RETRIES = 3;
// The longest one refresh may hold the loop. Every request under it carries
// its own 15s timeout, but a run is dozens of them, some in series, and a
// browser without AbortSignal.timeout gets no timeouts at all — while a run is
// in flight every tick stands down, so one that never settles would freeze the
// feed and leave "Updating…" up for the rest of the visit. Far
// past any real build; the subject caches a slow run warms survive it, so the
// retry after it is faster.
const REFRESH_WATCHDOG_MS = 90_000;
// New arrivals cascade in 60ms apart, up to this many steps — past that they
// arrive together, the way the first-paint reveal stagger tops out.
const ARRIVAL_STAGGER_STEPS = 8;
// Pages a verb's older history lives on, for the marker where the home feed's
// copy of it runs out and the colophon that closes the ledger, which names
// them in this order.
const VERB_PAGE_ORDER = ['posting', 'logging', 'listening', 'mothing', 'blogging', 'creating'];
const VERB_PAGES = new Set(VERB_PAGE_ORDER);


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

// One resolver for the whole session so subject hydration (bsky posts,
// profiles, atproto records) keeps its caches across every refresh tick
// instead of starting cold on each rebuild. Passed into buildUnifiedFeed via
// options.subjectResolver; module-level so it survives Home remounts too.
const homeSubjectResolver = createSubjectResolver({
  warn: (...args) => console.warn('[home]', ...args),
});

// The unified snapshot is static per deploy, so memoize the fetch for the
// session: it backs both the instant first paint and the "estimated from
// snapshot" chip counts for verbs we haven't fetched live. At most one
// network round trip per page load; failures clear the memo so a later
// mount can retry. fetchSnapshot reports a miss by resolving null rather
// than rejecting, so a null result is what clears it.
//
// The snapshot is built in UTC, where observation instants can't be put on
// the viewer's clock (see localizeObservationInstants), so that happens
// here, once, on copies — the memoized array is shared with the chip
// estimates.
let _unifiedSnapshotPromise = null;
function loadUnifiedSnapshot() {
  if (!_unifiedSnapshotPromise) {
    _unifiedSnapshotPromise = fetchSnapshot(FEED_CACHE_KEY)
      .then((snap) => {
        if (!Array.isArray(snap)) {
          _unifiedSnapshotPromise = null;
          return null;
        }
        return localizeObservationInstants(snap.map((item) => ({ ...item })));
      })
      .catch(() => {
        _unifiedSnapshotPromise = null;
        return null;
      });
  }
  return _unifiedSnapshotPromise;
}

/**
 * The newest day's header doubles as the live-refresh indicator. While a
 * refresh is confirming the latest activity it notes "Updating…" before the
 * day's folio (one short word: on a phone the line holds the date as well),
 * and the note fades out once the live result lands. This keeps the signal to a quiet aside on the day's own line
 * instead of a separate banner.
 *
 * A refresh that couldn't reach anything leaves the feed as it was and says
 * so here (`stale`), the way the single-collection pages footnote theirs,
 * rather than passing off what's on screen as current.
 */
function DayActivityMeta({ checking, stale, reduce }) {
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
          Updating&hellip;
        </motion.span>
      ) : stale ? (
        <motion.span
          key="stale"
          className="feed-activity-stale"
          role="status"
          aria-live="polite"
          {...fade}
        >
          {stale}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * The row where a verb's copy in the home feed runs out (see
 * insertHorizonMarkers). Verbs with a page of their own point at it.
 */
function HorizonNote({ verb }) {
  return (
    <li className="feed-horizon gutter">
      {VERB_PAGES.has(verb) ? (
        <>
          Earlier <Link to={`/${verb}`}>{verb}</Link> continues on its own page
        </>
      ) : (
        <>Earlier {verb} isn&rsquo;t loaded here</>
      )}
    </li>
  );
}

/**
 * The ledger's end: a fleuron between hairlines, one sentence saying how far
 * back it is whole, and the pages whose own history goes further. `since` is
 * the newest horizon of the verbs on show (completeSince); the first whole day
 * after it is the one named. With no verb cut short, the ledger holds
 * everything, back to its oldest dated row (`oldest`). Only a live build
 * knows where its fetches ran out (`known`): the snapshot painted first is a
 * short prefix of one, so until the live feed lands the mark stands alone.
 */
function LedgerColophon({ known, since, oldest, verbs }) {
  const now = useNow();
  const today = longDay(now, now);
  let line = '';
  if (known && since) {
    // A busy day can use up a kind's whole fetch, and then not even today
    // is whole; the day after the horizon being today reads as just that.
    const first = longDay(since, now, { next: true });
    // Above this line each kind runs back as far as its own fetch reached,
    // so "complete for today" would undersell what's there and "complete"
    // alone would overclaim: say which days hold every kind.
    if (longDay(since, now) === today) line = 'Not even today holds every kind of record yet.';
    else if (first === today) line = 'Only today holds every kind of record.';
    else line = `Every kind of record is here back to ${first}.`;
  } else if (known && oldest) {
    line = `That’s everything, back to ${longDay(oldest, now)}.`;
  }
  const pages = VERB_PAGE_ORDER.filter((v) => verbs.has(v));
  return (
    <footer className="ledger-colophon">
      <p className="ledger-colophon-mark" aria-hidden="true">
        <Fleuron />
      </p>
      {line && <p className="ledger-colophon-line">{line}</p>}
      {since && pages.length > 0 && (
        <p className="ledger-colophon-earlier">
          Earlier:{' '}
          {pages.map((verb, i) => (
            <span key={verb}>
              {i > 0 && ' · '}
              <Link to={`/${verb}`}>{verb}</Link>
            </span>
          ))}
        </p>
      )}
    </footer>
  );
}

/**
 * The hero's guestbook button, split out so the chrome-panel actions it reads
 * stay off the page and its whole feed. They never change, so a sheet opening
 * or closing re-renders nothing here either.
 */
const GuestbookButton = memo(function GuestbookButton() {
  const { openPanel } = useChromePanelActions();
  return (
    <button
      type="button"
      className="home-hero-cta-btn home-hero-guestbook-btn"
      onClick={() => openPanel('guestbook')}
      aria-label="Sign the guestbook"
      title="Sign the guestbook"
    >
      <Signature size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
});


/**
 * The home ledger. With `verb`, it's that verb's generated index instead
 * (/reposting, /liking, …, see GENERATED_INDEX_VERBS): the same ledger filtered
 * to the one verb, under "dame is reposting" rather than the hero, with a line
 * saying what's filtered and a way back to everything.
 */
export default function Home({ verb: presetVerb = null } = {}) {
  const [rawParams, setParams] = useSearchParams();
  // A preset verb stands in for `?verbs=` until the visitor picks their own.
  const params = useMemo(() => {
    if (!presetVerb || rawParams.has('verbs')) return rawParams;
    const p = new URLSearchParams(rawParams);
    p.set('verbs', presetVerb);
    return p;
  }, [rawParams, presetVerb]);

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
  // Latest-value ref so a partial rebuild can carry over the rows it
  // couldn't fetch from whatever is on screen.
  const feedRef = useRef(feed);
  feedRef.current = feed;
  // Where each verb's capped fetch ran out (see buildUnifiedFeed). Only a
  // live build knows; the snapshot is a short prefix of a deeper build and
  // has none to report.
  const [horizons, setHorizons] = useState(initialCache?.horizons || null);
  const [loadedAt, setLoadedAt] = useState(
    initialCache && initialCache.loadedAt ? new Date(initialCache.loadedAt) : null,
  );
  const [refreshState, setRefreshState] = useState(initialCache ? 'ready' : 'idle');
  // Verbs the most recent *live* result covered. Drives the "checking for
  // recent activity" banner: while a refresh is in flight for verbs we
  // can't yet show (first paint from snapshot, or a newly-enabled verb),
  // we surface the banner; routine 30s background refreshes don't.
  const [liveVerbs, setLiveVerbs] = useState(() => initialCache?.fetchedVerbs || []);
  // Latest-value ref so the background tick can test verb coverage without
  // re-subscribing when `liveVerbs` changes.
  const liveVerbsRef = useRef(liveVerbs);
  liveVerbsRef.current = liveVerbs;
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
  // The repo head (getLatestCommit `rev`) as of our last *successful* live
  // build. The shared 30s tick reads it to skip the ~45-request rebuild when
  // the repo hasn't advanced. Seeded from the in-memory cache, which records
  // the rev it was built at, so coming back to Home within the TTL doesn't
  // cost a full rebuild on the first tick. Null until a live build lands, and
  // cleared again by a failed one so the next tick retries.
  const lastRevRef = useRef(initialCache?.rev || null);
  // Partial builds in a row (see MAX_PARTIAL_RETRIES).
  const partialRetriesRef = useRef(0);

  // HeroSentence registers its imperative shuffle handle here so the
  // shuffle button in the hero CTA row can advance both rotators
  // without owning the hero's state.
  const shuffleRef = useRef(null);

  const runRefresh = useCallback(async ({ force = true } = {}) => {
    if (inflightRef.current) return inflightRef.current;

    // Snapshot the verb set for this run so the cache + coverage record
    // it accurately even if the active filter changes mid-flight. It's what
    // the feed already holds plus what the filter wants (rebuildVerbs), and
    // it rides on the token so a filter change can tell whether this run
    // will already answer it.
    const verbs = rebuildVerbs(liveVerbsRef.current, fetchVerbsRef.current);
    const token = { cancelled: false, verbs };
    inflightRef.current = token;

    // Every way out of this run goes through `finish`, exactly once: it frees
    // the slot for the next tick and, once the run has started the chrome's
    // refresh pulse, stops it. The watchdog is one more way out — it abandons
    // the run the way a cancel does, and the run's own later `finish` is then
    // a no-op, so the pulse's shared counter can't be decremented twice.
    let refreshing = false;
    let settled = false;
    let watchdog = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (inflightRef.current === token) inflightRef.current = null;
      if (refreshing) endRefresh();
    };
    watchdog = setTimeout(() => {
      // A run something else already abandoned (a filter change that started
      // a newer one, or leaving the page) only owes the slot and the pulse:
      // the feed, its note and the rev now belong to whatever replaced it.
      if (!token.cancelled) {
        token.cancelled = true;
        // Rebuild on the next tick whatever the probe says, as after a failure.
        lastRevRef.current = null;
        if (refreshing && feedSourceRef.current !== 'none')
          setRefreshState('stale');
      }
      finish();
    }, REFRESH_WATCHDOG_MS);

    // Cheap change-detection before the expensive rebuild: read the repo head
    // — a single request — up front. On a routine background tick (force=false)
    // we skip the whole ~45-request fan-out when the repo hasn't advanced since
    // our last live build and the feed we're already showing covers the active
    // verbs. Manual/initial and filter-change refreshes pass force=true and
    // always rebuild. getRepoRev shares one getLatestCommit with the chrome's
    // live readers, which ask the same question on the same tick.
    let rev = null;
    try {
      rev = await getRepoRev(ME_DID);
    } catch {
      // A failed probe must never wedge the loop — fall through to a full
      // rebuild (which surfaces its own error / snapshot fallback).
    }

    if (token.cancelled) {
      finish();
      return null;
    }

    // A cache hydrate counts as live here: it was a live build, and its rev
    // is what seeded lastRevRef.
    const canSkip =
      !force &&
      rev &&
      rev === lastRevRef.current &&
      (feedSourceRef.current === 'live' || feedSourceRef.current === 'cache') &&
      verbsCovered(liveVerbsRef.current, fetchVerbsRef.current);
    if (canSkip) {
      // Nothing changed since the last live build — no rebuild, no UI churn.
      feedSourceRef.current = 'live';
      finish();
      return null;
    }

    setRefreshState('refreshing');
    beginRefresh();
    refreshing = true;

    // Strategy: live wins. The static snapshot is painted instantly on
    // first load by a separate effect (see below); here we fetch the
    // live feed and, once it resolves, replace whatever's showing — unless
    // the build couldn't reach anything (see below).
    let result = null;
    let buildError = null;
    try {
      const pds = await resolvePds(ME_DID);
      result = await buildUnifiedFeed({
        pds,
        me: ME_DID,
        options: {
          warn: (...args) => console.warn('[home]', ...args),
          initialMax: INITIAL_FETCH_MAX,
          authorFeedMax: INITIAL_FETCH_MAX,
          skipListMembers: true,
          verbs,
          // Reuse one session-long resolver so subject hydration caches
          // (bsky posts / profiles / atproto records) carry across ticks.
          subjectResolver: homeSubjectResolver,
          // Pull iNaturalist observations newer than the newest mirrored one
          // so brand-new sightings show without waiting for the mirror cron.
          liveObservations: true,
        },
      });
    } catch (err) {
      buildError = err;
      console.warn('[home] live refresh failed', err);
    }

    if (token.cancelled) {
      finish();
      return null;
    }

    // buildUnifiedFeed swallows per-source errors, so with the network down it
    // resolves an empty feed just like an empty repo would; its `failures`
    // tally is what tells the two apart.
    const outcome =
      buildError || !Array.isArray(result?.unified)
        ? 'failed'
        : classifyBuild(result.failures);

    if (outcome === 'failed') {
      // Nothing came back. A feed already on screen stays exactly as it is —
      // replacing it with less would be worse than showing it a little old —
      // and the next tick rebuilds whatever the probe says. Verb coverage,
      // the cache and the rev only ever come from a build that worked.
      lastRevRef.current = null;
      if (feedSourceRef.current !== 'none') {
        setRefreshState('stale');
        finish();
        return null;
      }
      // Nothing on screen yet, so the snapshot is the best there is.
      const seed = await loadUnifiedSnapshot();
      if (token.cancelled) {
        finish();
        return null;
      }
      if (Array.isArray(seed) && feedSourceRef.current === 'none') {
        feedSourceRef.current = 'snapshot';
        for (const item of seed) {
          if (item?.atUri) seenUrisRef.current.add(item.atUri);
        }
        setFeed(seed);
        setLoadedAt((cur) => cur || new Date());
        setRefreshState('stale');
      } else if (feedSourceRef.current === 'none') {
        setFeed([]);
        setRefreshState('error');
      } else {
        setRefreshState('stale');
      }
      finish();
      return null;
    }

    // Some sources failed: keep their rows from what's on screen.
    const nextFeed =
      outcome === 'partial'
        ? carryOverFailedSources(
            feedRef.current,
            result.unified,
            result.failures.labels,
          )
        : result.unified;

    // Diff against what the user has already seen. New URIs animate in;
    // everything else re-renders in place.
    const arrivals = new Set();
    for (const item of nextFeed) {
      const uri = item?.atUri;
      if (uri && !seenUrisRef.current.has(uri)) arrivals.add(uri);
    }

    // The verbs this feed now holds. A partial build counts every verb it asked
    // for except one it ADDED and got nothing for — every source that verb reads
    // failed, and none of its rows were on screen to carry over. Counted in, its
    // chip showed a live zero for records nobody had read; left out, the chip
    // keeps the snapshot's estimate and the next tick asks again. Held anyway
    // once the partial retries run out, the point at which the build's rev is
    // trusted too, so a source that keeps failing can't make every tick a
    // rebuild.
    let held = verbs;
    if (outcome === 'partial') {
      partialRetriesRef.current += 1;
      if (partialRetriesRef.current < MAX_PARTIAL_RETRIES) {
        const had = new Set(liveVerbsRef.current);
        const empty = new Set(
          verbsWithEverySourceIn(
            verbs.filter((v) => !had.has(v)),
            result.failures.labels,
          ),
        );
        if (empty.size) held = verbs.filter((v) => !empty.has(v));
      }
    }

    const now = new Date();
    feedSourceRef.current = 'live';
    setFeed(nextFeed);
    setHorizons(result.horizons || null);
    setLoadedAt(now);
    setRefreshState('ready');
    setLiveVerbs(held);
    liveVerbsRef.current = held;
    // Only flag arrivals on background refreshes — the very first load
    // (when seenUris is still empty) shouldn't slide every row in.
    if (seenUrisRef.current.size > 0 && arrivals.size > 0) {
      setNewUris(arrivals);
    }
    for (const uri of arrivals) seenUrisRef.current.add(uri);

    if (outcome === 'ok') {
      partialRetriesRef.current = 0;
      if (rev) lastRevRef.current = rev;
      writeFeedCache(FEED_CACHE_KEY, {
        items: nextFeed,
        horizons: result.horizons || null,
        loadedAt: now.getTime(),
        fetchedAt: Date.now(),
        fetchedVerbs: verbs,
        rev,
      });
    } else {
      // A partial build is never cached (a remount would hydrate it as a
      // good one), and it's retried on the next tick a few times before
      // its rev is trusted. (The retry count was bumped above.)
      lastRevRef.current =
        partialRetriesRef.current >= MAX_PARTIAL_RETRIES ? rev : null;
    }

    finish();
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
  }, []);

  // Trigger a live refresh on mount and whenever the active verb set
  // changes. On mount, skip it when the in-memory cache is still fresh AND
  // already covers the requested verbs. After that, a filter change only
  // fetches when it asks for a verb the feed doesn't hold: narrowing, or
  // widening back to verbs already loaded, is a pure client-side filter —
  // the 30s tick is what keeps the held data current, whatever its age.
  const verbEffectRanRef = useRef(false);
  useEffect(() => {
    const wanted = fetchVerbsRef.current;
    let needed;
    if (!verbEffectRanRef.current) {
      verbEffectRanRef.current = true;
      const entry = readFeedCache(FEED_CACHE_KEY);
      const fresh = isCacheFresh(FEED_CACHE_KEY, CACHE_TTL_MS);
      needed = !entry || !fresh || !verbsCovered(entry.fetchedVerbs, wanted);
    } else {
      needed = !verbsCovered(liveVerbsRef.current, wanted);
    }
    if (!needed) return;
    // A run already in flight for a set that covers this one will answer
    // it. Anything else is cancelled and its slot cleared up front, so the
    // refresh below isn't swallowed by runRefresh's in-flight guard —
    // otherwise the feed would stall on the old (now-cancelled) request
    // until the next tick.
    const inflight = inflightRef.current;
    if (inflight && !inflight.cancelled && verbsCovered(inflight.verbs, wanted))
      return;
    if (inflight) {
      inflight.cancelled = true;
      inflightRef.current = null;
    }
    runRefresh();
    // fetchVerbsKey re-runs this when the filter changes; fetchVerbsRef
    // carries the current set into the closure.
  }, [fetchVerbsKey, runRefresh]);

  // Leaving the page abandons whatever is in flight. A remount is a mount
  // again for the verb effect above (StrictMode's rehearsal unmount included:
  // otherwise the run cancelled here would never be replaced).
  useEffect(
    () => () => {
      if (inflightRef.current) inflightRef.current.cancelled = true;
      verbEffectRanRef.current = false;
    },
    [],
  );

  // Keep the feed alive on the shared 30s refresh tick — same cadence
  // as NowPlaying and NowStatus, so all the "live" surfaces update
  // together. The tick passes force=false so runRefresh can short-circuit
  // on the cheap getLatestCommit rev check and skip the full ~45-request
  // rebuild whenever the repo hasn't changed. The tick already skips while
  // the tab is hidden and fires on visibility return.
  useEffect(() => {
    const onTick = () => runRefresh({ force: false });
    return subscribeRefreshTick(onTick);
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
  const rawFeed = feed || EMPTY_FEED;
  // Which of these sightings were a lifer — the first record of their species.
  // The feed can't work that out on its own: it holds 100 records per
  // collection, and "has this ever been seen before?" is a question about the
  // whole archive. The index answers it for everything that existed at the
  // last build; merging it against what's actually loaded catches anything
  // logged since, which is when a first most wants saying. See
  // lib/firstSightings.js.
  const firstSightingIndex = useFirstSightings();
  const firstIds = useMemo(
    () => mergeFirstSightings(firstSightingIndex, rawFeed),
    [firstSightingIndex, rawFeed],
  );
  // Settled here, once, rather than in each of the components that draw a
  // sighting — by the time a row reaches one it may have been collapsed into
  // a run, and the run has to be able to count the firsts underneath it.
  const safeFeed = useMemo(() => markFirstSightings(rawFeed, firstIds), [rawFeed, firstIds]);
  // Each verb cut where its capped fetch ran out (see trimToHorizons), before
  // anything is counted or filtered, so the chips count what can be shown.
  const shownFeed = useMemo(
    () => trimToHorizons(safeFeed, horizons),
    [safeFeed, horizons],
  );
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
  const liveCounts = useMemo(
    () => feedFilterCounts(shownFeed, ME_DID),
    [shownFeed],
  );
  const snapshotCounts = useMemo(
    () => (snapshotFeed ? feedFilterCounts(snapshotFeed, ME_DID) : null),
    [snapshotFeed],
  );
  const { counts, estimatedVerbs, cappedVerbs } = useMemo(() => {
    const liveSet = new Set(liveVerbs);
    // The live verbs whose first fetch stopped at INITIAL_FETCH_MAX (their
    // horizons), so the sheet prints "100+" rather than a total-looking 100.
    const capped = new Set(Object.keys(horizons || {}).filter((v) => liveSet.has(v)));
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
    return { counts: out, estimatedVerbs: est, cappedVerbs: capped };
  }, [liveCounts, snapshotCounts, liveVerbs, horizons]);

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
  const kept = useMemo(
    () =>
      removedUris?.size
        ? shownFeed.filter((item) => !removedUris.has(item.atUri))
        : shownFeed,
    [shownFeed, removedUris],
  );
  // One of Dame's self-threads is one entry: when a filter or search lets
  // any of its posts through, the rest come with it.
  const filtered = useMemo(
    () => completeSelfThreads(filterFeed(kept, params, ME_DID), kept, ME_DID),
    [kept, params],
  );
  // Works known only by their year leave the dated timeline (each would head
  // a "January 1" of its own over a "12:00 am") and close the ledger instead,
  // under their years.
  const { dated, yearOnly } = useMemo(() => splitYearOnlyWorks(filtered), [filtered]);
  // The dated feed plus a marker row where each verb's copy runs out.
  const timeline = useMemo(
    () => insertHorizonMarkers(dated, horizons),
    [dated, horizons],
  );
  // How far back the whole ledger can vouch for itself, for its colophon.
  const since = useMemo(() => completeSince(dated, horizons), [dated, horizons]);
  const shownVerbs = useMemo(() => {
    const out = new Set();
    for (const item of filtered) if (item?.verb) out.add(item.verb);
    return out;
  }, [filtered]);
  // Client-side pagination — the user only sees the first `visibleCount`
  // filtered items at a time, a clean prefix of the timeline.
  const windowed = useMemo(
    () => timeline.slice(0, visibleCount),
    [timeline, visibleCount],
  );
  const hasMore = timeline.length > windowed.length;
  // A thread in view comes whole, however far back its first post sits:
  // further down the timeline, past where posting's fetch was trimmed (still
  // loaded, see trimToHorizons), or never loaded at all (fetched here).
  const backfill = useThreadBackfill(windowed, safeFeed, ME_DID);
  const threadPool = useMemo(() => {
    const seen = new Set();
    for (const item of timeline) if (item?.atUri) seen.add(item.atUri);
    const extra = [];
    for (const item of [...safeFeed, ...backfill]) {
      if (item?.verb !== 'posting' || !item.atUri || seen.has(item.atUri)) continue;
      if (removedUris?.has(item.atUri)) continue;
      seen.add(item.atUri);
      extra.push(item);
    }
    return extra.length ? [...timeline, ...extra] : timeline;
  }, [timeline, safeFeed, backfill, removedUris]);
  const visible = useMemo(
    () => completeSelfThreads(windowed, threadPool, ME_DID),
    [windowed, threadPool],
  );

  // Grow the visible window as the reader nears the bottom. The extra items
  // are already in memory, so this is an instant reveal rather than a fetch;
  // the bottom sentinel drives it via IntersectionObserver, with the manual
  // button kept only as a no-observer fallback (see the feed foot below).
  const loadMore = useCallback(
    () => setVisibleCount((n) => n + LOAD_MORE_STEP),
    [],
  );
  const sentinelRef = useInfiniteScroll(loadMore, {
    enabled: hasMore,
    version: visibleCount,
  });

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
      // No source / reverse-search controls: those are the curated galleries'
      // (see Lightbox.jsx). An observation's own record page links out to
      // iNaturalist for anyone who wants the original.
      images.push({
        src: large,
        thumb: photoUrl(photo, 'medium'),
        alt: sci && sci !== name ? `${name} — ${sci}` : name,
        caption: name,
        credit: sci && sci !== name ? sci : undefined,
        recordHref: recordPathFromAtUri(item.atUri) || undefined,
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
  const collapsed = useMemo(() => {
    const listens = collapseListens(visible);
    // Edit mode wants every record individually selectable. A listening batch
    // can stay collapsed — ListenRow owns its own per-song selection — but an
    // observation batch has no selection UI of its own, so its runs stay
    // expanded while the owner is picking things out.
    return editActive ? listens : collapseObservations(listens);
  }, [visible, editActive]);
  // Stable row keys, so a session gaining a play updates in place instead of
  // remounting under the reader (see assignRowKeys). The Map of member → key
  // from the previous pass is what lets a batch keep its key.
  const rowKeysRef = useRef(new Map());
  const keyed = useMemo(() => {
    const { rows, keys } = assignRowKeys(collapsed, rowKeysRef.current);
    rowKeysRef.current = keys;
    return rows;
  }, [collapsed]);
  // The ledger sets each of Dame's self-threads as one row; the cards keep a
  // card per post.
  const threaded = useMemo(() => {
    const grouped = groupSelfReplyThreads(keyed, ME_DID);
    return ledger ? collapseSelfThreads(grouped) : grouped;
  }, [keyed, ledger]);
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

  // What an empty feed says depends on why it's empty: a refresh that
  // reached nothing (on a cold load, or for a type the feed on screen never
  // held), a filter with every type switched off, a search, or a filter that
  // matches nothing — each with the one action that undoes it.
  const unreachable =
    refreshState === 'error' ||
    (refreshState === 'stale' && !verbsCovered(liveVerbs, fetchVerbs));
  const query = (params.get('q') || '').trim();
  const resetFilters = useCallback(() => {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.delete('verbs');
        out.delete('replies');
        return out;
      },
      { replace: true },
    );
  }, [setParams]);
  let empty = null;
  if (unreachable) {
    empty = {
      copy: 'Couldn’t reach the PDS just now.',
      action: 'Try again',
      onAction: () => runRefresh(),
    };
  } else if (activeVerbs.size === 0) {
    empty = {
      copy: 'No record types are selected.',
      action: 'Show defaults',
      onAction: resetFilters,
    };
  } else if (query) {
    empty = { copy: 'No records match that search.' };
  } else {
    empty = {
      copy: 'No records match these filters.',
      action: 'Reset filters',
      onAction: resetFilters,
    };
  }
  // The snapshot is as old as the last deploy, so it gets no "as of" time:
  // the moment it was painted would pass it off as fresher than it is.
  let staleNote = null;
  if (refreshState === 'stale') {
    staleNote =
      feedSourceRef.current === 'snapshot' || !loadedAt
        ? 'live refresh failed · showing the saved snapshot'
        : `live refresh failed · as of ${formatTime(loadedAt)}`;
  }

  // The home feed aggregates many records; it has no single is.dame.page/home
  // backing record (none exists, and it isn't in PAGE_REGISTRY), so PageShell
  // gets no `atUri`. Advertising that phantom record made the debug pane's
  // "Edit record" surface a raw PDS "Could not locate record" error and emitted
  // a dead <link rel="alternate"> hint. See pageRkeyForPath in
  // src/hooks/useAtUri.js.
  // The ledger itself, shared by the home page and the generated verb
  // indexes. The cold-load skeleton, the day groups and the photo lightbox
  // all ride along.
  const feedBody = (
    <>
        {/* One flex child holds the whole feed body (or the cold-load
            fetching line) so its spacing rides in the wrapper rather than
            in the parent's animatable flex `gap`. */}
        <div className={`home-feed-region${ledger ? ' feed-ledger feed-ledger-column' : ''}`}>
          {loading || (checking && filtered.length === 0) ? (
            // Shaped like the ledger (verb | body | time), so the rows land
            // in its place rather than below a status line.
            <FeedSkeleton rows={6} label="Fetching latest activity" ledger={ledger} />
          ) : filtered.length === 0 ? (
            <div className="feed-empty">
              <p>{empty.copy}</p>
              {empty.action && (
                <button
                  type="button"
                  className="feed-load-more-btn"
                  onClick={empty.onAction}
                >
                  {empty.action}
                </button>
              )}
            </div>
          ) : (
            <ol className="feed-list reveal-stagger">
            {groups.map((group, gi) => (
              <li key={group.dateKey} className="feed-day-group">
                <DayOfLifeHeader
                  date={group.date}
                  variant={ledger ? 'ledger' : 'default'}
                  meta={
                    gi === 0 ? (
                      <DayActivityMeta checking={checking} stale={staleNote} reduce={reduce} />
                    ) : null
                  }
                />
                {/* The ledger's day header carries its own bottom rule, so
                    the list sits flush beneath it; the card layout keeps a
                    breathing gap. */}
                <ul
                  className="feed-list"
                  style={ledger ? undefined : { marginTop: 'var(--space-3)' }}
                >
                  {group.items.map((item, i) => {
                    if (isHorizonMarker(item)) {
                      return (
                        <HorizonNote key={item.rowKey} verb={item.horizonVerb} />
                      );
                    }
                    // FeedItem is the list item itself, and memoized: a row
                    // re-renders only when its own item changes, not on every
                    // reveal, refresh or sheet opening. Rows carry no layout
                    // animation — measuring every row's box on each of those
                    // commits was the feed's scroll jank — just the slide-in
                    // a new arrival plays once, on mount.
                    const uri = item?.atUri;
                    const isNew = !reduce && uri ? newUris.has(uri) : false;
                    const step = isNew
                      ? Math.min(arrivalIndex.get(uri) ?? 0, ARRIVAL_STAGGER_STEPS)
                      : 0;
                    // A post that joins a thread already on screen arrives
                    // inside its row: the row stays put and the new post
                    // slides in (a space-separated list keeps the memo).
                    const arrivingPosts =
                      !reduce && !isNew && isSelfThreadRow(item)
                        ? item._thread.posts
                            .filter((post) => newUris.has(post.atUri))
                            .map((post) => post.atUri)
                            .join(' ')
                        : '';
                    return (
                      <FeedItem
                        key={item.rowKey || uri || `fallback-${group.dateKey}-${i}`}
                        item={item}
                        layout={ledger ? 'ledger' : 'cards'}
                        onOpenLightbox={ledger ? openObservationLightbox : undefined}
                        arriving={isNew}
                        arrivalDelay={step * 0.06}
                        arrivingPosts={arrivingPosts || undefined}
                      />
                    );
                  })}
                </ul>
              </li>
            ))}
            {!hasMore && yearOnly.length > 0 && (
              <li className="feed-day-group feed-earlier-works">
                {/* Headed like a day, so the chrome's strip names it. */}
                <header className="day-section-header">
                  <h3 className="day-header">Earlier works</h3>
                  <p className="day-header-meta">dated by their year</p>
                </header>
                <ul className="feed-list">
                  {yearOnly.map((item) => (
                    <FeedItem
                      key={item.rowKey || item.atUri}
                      item={item}
                      layout={ledger ? 'ledger' : 'cards'}
                    />
                  ))}
                </ul>
              </li>
            )}
          </ol>
          )}
          {!loading && !hasMore && filtered.length > 0 && (
            <LedgerColophon
              known={horizons != null}
              since={since}
              oldest={dated[dated.length - 1]?.createdAt || null}
              verbs={shownVerbs}
            />
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
      <Lightbox
        open={lightboxIndex >= 0}
        index={Math.max(0, lightboxIndex)}
        onClose={() => setLightboxIndex(-1)}
        images={observationPhotos.images}
      />
    </>
  );

  if (presetVerb) {
    return (
      <PageShell
        title={
          <>
            dame is <span className="gerund">{presetVerb}</span>
          </>
        }
        intro={verbIndexIntro(presetVerb)}
        headTitle={`dame is ${presetVerb} — dame.is`}
        selectable
      >
        <section className="home-latest">
          <p className="verb-index-filter">
            <span className="small-caps">showing</span>
            <span aria-hidden="true">·</span>
            <span className="verb-index-filter-verb">
              <VerbIcon verb={presetVerb} size={13} />
              {presetVerb}
            </span>
            <span aria-hidden="true">·</span>
            <Link to="/" className="verb-index-filter-clear">
              <X size={12} strokeWidth={1.75} aria-hidden="true" />
              clear
            </Link>
          </p>
          {feedBody}
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={<HeroSentence shuffleRef={shuffleRef} />}
      headTitle="dame.is"
      selectable
    >
      {/* Resume is the one filled button; the guestbook and shuffle ride at
          the end of the row as icon buttons. */}
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
        <GuestbookButton />
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
        <FeedFilters
          counts={counts}
          estimatedVerbs={estimatedVerbs}
          cappedVerbs={cappedVerbs}
          fetchCap={INITIAL_FETCH_MAX}
        />
        {feedBody}
      </section>

    </PageShell>
  );
}
