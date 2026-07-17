import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import StateStats from '../components/StateStats.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useStateHistory } from '../hooks/useStateHistory.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { newestInstant, usePublishLatestRecord } from '../hooks/useFeedFooter.jsx';
import { groupByDay } from '../lib/time.js';
import { resolvePds, listRecords, getLatestCommit } from '../lib/atproto.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';

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
  const { samples: stateSamples } = useStateHistory();

  const { active: editActive } = useEditMode();
  const { layout } = useFeedLayout();
  const ledger = layout === 'ledger' && !editActive;
  const loading = status === 'loading';
  const safeItems = items || [];
  const filtered = useMemo(
    () =>
      safeItems.filter((i) => {
        const p = i.payload || {};
        return matchesQuery([p.status, p.text].filter(Boolean).join(' '), q);
      }),
    [safeItems, q],
  );
  const groups = useMemo(() => groupByDay(filtered, (i) => i.createdAt), [filtered]);

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
      {stateSamples.length > 0 && <StateStats samples={stateSamples} />}
      {loading ? (
        <FeedSkeleton rows={5} label="Loading status updates" />
      ) : status === 'error' ? (
        <p className="feed-empty">Live refresh failed and no cached snapshot is available.</p>
      ) : groups.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No status records match that search.' : 'No status records yet.'}
        </p>
      ) : (
        <div className={ledger ? 'feed-ledger' : undefined}>
          <ol className="feed-list reveal-stagger">
            {groups.map((group) => (
              <li key={group.dateKey} className="feed-day-group">
                <DayOfLifeHeader date={group.date} variant={ledger ? 'ledger' : 'default'} />
                <ul className="feed-list" style={ledger ? undefined : { marginTop: 'var(--space-3)' }}>
                  <AnimatePresence initial={false}>
                    {group.items.map((item) => {
                      const uri = item.atUri;
                      const isNew = uri ? newKeys.has(uri) : false;
                      const stagger = isNew ? (arrivalIndex.get(uri) ?? 0) * 0.06 : 0;
                      return (
                        <motion.li
                          key={uri}
                          layout
                          initial={isNew && !reduce ? { opacity: 0, y: -24 } : false}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: reduce ? 0 : 0.45,
                            ease: [0.22, 0.61, 0.36, 1],
                            delay: reduce ? 0 : stagger,
                          }}
                        >
                          <FeedItem item={item} layout={ledger ? 'ledger' : 'cards'} />
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              </li>
            ))}
          </ol>
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
