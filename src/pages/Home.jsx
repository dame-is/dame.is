import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedFilters, { filterFeed } from '../components/FeedFilters.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { fetchSnapshot, mergeByKey } from '../lib/snapshot.js';
import { groupByDay } from '../lib/time.js';
import { resolvePds } from '../lib/atproto.js';
import { buildUnifiedFeed } from '../lib/feedBuilder.js';
import { groupSelfReplyThreads, threadAwareDateKey } from '../lib/threadGrouping.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

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
  // `null` here means "feed hasn't resolved yet" — distinct from `[]`
  // (loaded, but no records / no matches) so we can show a skeleton on
  // first paint instead of the empty-state copy.
  const [feed, setFeed] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);
  const [refreshState, setRefreshState] = useState('idle');

  // Live-first hydration: kick off both the static `unifiedFeed.json`
  // snapshot (built at deploy time) and the live PDS fetch in parallel,
  // then render whichever resolves first — preferring live so visitors
  // never see records that are minutes stale flash and then update.
  //
  // If the live fetch wins (the common path), the snapshot is only used
  // as a backfill: we merge in any older rows the live cap dropped, but
  // the user never sees the old data appear and then change.
  //
  // If the live fetch fails (network down, PDS unreachable), we fall
  // back to whatever the snapshot returned so the page still renders.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const snapshotPromise = fetchSnapshot('unifiedFeed').catch(() => null);

      setRefreshState('refreshing');
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
      if (cancelled) return;

      if (live) {
        // Merge the snapshot in *behind* the live results so older items
        // beyond the live cap stay visible, but live always wins on dupes.
        const merged = Array.isArray(seed) && seed.length
          ? mergeByKey(seed, live, (item) => item?.atUri)
          : live;
        setFeed(merged);
        setLoadedAt(new Date());
        setRefreshState('ready');
        return;
      }

      // Live failed — fall back to the snapshot so the page still renders.
      if (Array.isArray(seed)) {
        setFeed(seed);
        setLoadedAt(new Date());
      } else {
        setFeed([]);
      }
      setRefreshState(liveError ? 'error' : 'ready');
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

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
                {group.items.map((item, i) => (
                  <FeedItem key={(item.atUri || '') + i} item={item} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {!loading && loadedAt && (
        <p className="gutter feed-loaded-at" style={{ marginTop: 'var(--space-7)', textAlign: 'center' }}>
          {filtered.length} of {safeFeed.length} records ·{' '}
          {refreshState === 'refreshing'
            ? 'fetching live records…'
            : refreshState === 'error'
              ? `live refresh failed · snapshot from ${loadedAt.toLocaleTimeString()}`
              : `refreshed ${loadedAt.toLocaleTimeString()}`}
        </p>
      )}
    </PageShell>
  );
}
