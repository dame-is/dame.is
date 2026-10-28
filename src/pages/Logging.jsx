import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import StateStats from '../components/StateStats.jsx';
import FeedMore from '../components/FeedMore.jsx';
import QueryNote from '../components/QueryNote.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useFeedWindow } from '../hooks/useFeedWindow.js';
import { useStateHistory } from '../hooks/useStateHistory.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { newestInstant, usePublishLatestRecord } from '../hooks/useFeedFooter.jsx';
import { groupByDay } from '../lib/time.js';
import { resolvePds, listRecords, getLatestCommit } from '../lib/atproto.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';

// New arrivals cascade in 60ms apart, up to this many steps, as on the home
// feed.
const ARRIVAL_STAGGER_STEPS = 8;
// The state dashboard's opening window (StateStats' first tab).
const DAY_MS = 24 * 3600 * 1000;

export default function Logging() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { title, intro } = usePageContent('logging');
  const reduce = useReducedMotion();

  // `newKeys` are status records that arrived on the latest live refresh, so
  // the page can slide them in.
  const { items, status, refreshedAt, newKeys } = useLiveFeed({
    name: 'now',
    strategy: 'live-first',
    // Coming back here (Back from a record, say) redraws the last list at once
    // and refreshes behind it, so the page and its scroll position return on
    // the first frame rather than after a skeleton.
    remember: 'logging',
    // Refresh on the shared 30s tick like the home feed. getRev skips the
    // listRecords fan-out whenever the repo hasn't advanced.
    live: true,
    getRev: async () => {
      const pds = await resolvePds(ME_DID);
      return (await getLatestCommit(pds, ME_DID))?.rev || null;
    },
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.now, max: 500 });
    },
    mapItems: toLoggingItems,
  });

  // The state dashboard paints from its own snapshot-first history, independent
  // of the status feed's loading state, so it can show the instant it lands.
  // Its box is held from the first frame (StateStats' `loading`), because the
  // history usually lands while the feed below is still a skeleton, and a
  // dashboard dropping in above that skeleton shoved it most of a screen down.
  //
  // The build's snapshot can be days old, and then nothing in it falls inside
  // the dashboard's opening 24 hours: drawn, it is the short "no readings"
  // line for the length of the live read, which collapses the held box and
  // grows it back. So a snapshot with no reading in that window holds the
  // skeleton until the live history lands (or fails, as 'stale').
  const {
    samples: stateSamples,
    status: stateStatus,
    source: stateSource,
  } = useStateHistory();
  const stateLoading =
    stateStatus === 'loading' ||
    (stateStatus === 'ready' &&
      stateSource === 'snapshot' &&
      !hasSampleInLastDay(stateSamples));

  const { removedUris, active: editActive } = useEditMode();
  const { layout } = useFeedLayout();
  const ledger = layout === 'ledger' && !editActive;
  const loading = status === 'loading';
  const safeItems = useMemo(() => items || [], [items]);
  const filtered = useMemo(
    () =>
      safeItems.filter((i) => {
        // Statuses the owner deleted this session go at once, not a tick later.
        if (removedUris.has(i.atUri)) return false;
        const p = i.payload || {};
        return matchesQuery([p.status, p.text].filter(Boolean).join(' '), q);
      }),
    [safeItems, q, removedUris],
  );
  const feedWindow = useFeedWindow(filtered, q);
  const { visible } = feedWindow;
  const groups = useMemo(
    () => groupByDay(visible, (i) => i.createdAt),
    [visible],
  );

  // Top-down stagger order among the new arrivals currently on screen.
  const arrivalIndex = useMemo(() => {
    const map = new Map();
    let i = 0;
    for (const group of groups) {
      for (const item of group.items) {
        const uri = item?.atUri;
        if (uri && newKeys.has(uri)) map.set(uri, i++);
      }
    }
    return map;
  }, [groups, newKeys]);

  // Feed page: report the newest visible record's time in the global footer.
  usePublishLatestRecord(useMemo(() => newestInstant(filtered), [filtered]));

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/logging`}
      headTitle="dame.is logging"
      selectable
    >
      {(stateLoading || stateSamples.length > 0) && (
        <StateStats samples={stateSamples} loading={stateLoading} />
      )}
      <QueryNote noun="status records" />
      {loading ? (
        <FeedSkeleton rows={5} label="Loading status updates" />
      ) : status === 'error' ? (
        <p className="feed-empty">Live refresh failed and no cached snapshot is available.</p>
      ) : groups.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No status records match that search.' : 'No status records yet.'}
        </p>
      ) : (
        // The ledger here is a diary: no heading per day (a one-status day
        // spent two thirds of its height on one), but a running date in the
        // margin of each day's first status, and a full rule above it.
        <div className={ledger ? 'feed-ledger feed-diary' : undefined}>
          <ol className="feed-list reveal-stagger">
            {groups.map((group) => (
              <li key={group.dateKey} className="feed-day-group">
                {!ledger && <DayOfLifeHeader date={group.date} />}
                <ul className="feed-list" style={ledger ? undefined : { marginTop: 'var(--space-3)' }}>
                  {group.items.map((item, i) => {
                    // FeedItem is the list item itself, and memoized, as on the
                    // home feed: no wrapping <li> (a list item inside a list
                    // item), and no layout animation measuring every row's box
                    // on each refresh — just the slide-in a new arrival plays
                    // once, on mount.
                    const uri = item.atUri;
                    const isNew = !reduce && uri ? newKeys.has(uri) : false;
                    const step = isNew
                      ? Math.min(
                          arrivalIndex.get(uri) ?? 0,
                          ARRIVAL_STAGGER_STEPS,
                        )
                      : 0;
                    return (
                      <FeedItem
                        key={uri}
                        item={item}
                        showVerb={!ledger}
                        dayStart={ledger && i === 0 ? group.date : null}
                        layout={ledger ? 'ledger' : 'cards'}
                        arriving={isNew}
                        arrivalDelay={step * 0.06}
                      />
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
          <FeedMore {...feedWindow} />
        </div>
      )}
      {!loading && refreshedAt && (
        <p className="gutter feed-loaded-at" style={{ marginTop: 'var(--space-7)', textAlign: 'center' }}>
          {status === 'stale'
            ? `live refresh failed · snapshot from ${refreshedAt.toLocaleTimeString()}`
            : `refreshed ${refreshedAt.toLocaleTimeString()}`}
        </p>
      )}
    </PageShell>
  );
}

/** Whether the newest of `samples` (oldest first) is from the last 24 hours. */
function hasSampleInLastDay(samples) {
  const newest = samples[samples.length - 1];
  return newest != null && newest.t >= Date.now() - DAY_MS;
}

function toLoggingItems(records) {
  if (!Array.isArray(records)) return [];
  return records
    .filter((r) => r?.uri && r.value)
    .map((r) => ({
      verb: 'logging',
      atUri: r.uri,
      cid: r.cid,
      createdAt: r.value?.createdAt,
      payload: r.value,
    }));
}
