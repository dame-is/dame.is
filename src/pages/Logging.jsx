import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { newestInstant, usePublishLatestRecord } from '../hooks/useFeedFooter.jsx';
import { groupByDay } from '../lib/time.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';

export default function Logging() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { title, intro } = usePageContent('logging');

  const { items, status, refreshedAt } = useLiveFeed({
    name: 'now',
    strategy: 'live-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.now, max: 500 });
    },
    mapItems: toLoggingItems,
  });

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
  const groups = groupByDay(filtered, (i) => i.createdAt);

  // Feed page: report the newest visible record's time in the global footer.
  usePublishLatestRecord(useMemo(() => newestInstant(filtered), [filtered]));

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/logging`}
      headTitle="Logging — Dame is&hellip;"
    >
      {loading ? (
        <FeedSkeleton rows={5} label="Loading status updates" />
      ) : status === 'error' ? (
        <p className="feed-empty">Live refresh failed and no cached snapshot is available.</p>
      ) : groups.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No status records match that search.' : 'No status records yet.'}
        </p>
      ) : (
        <ol className="feed-list reveal-stagger">
          {groups.map((group) => (
            <li key={group.dateKey} className="feed-day-group">
              <DayOfLifeHeader date={group.date} />
              <ul className="feed-list" style={{ marginTop: 'var(--space-3)' }}>
                {group.items.map((item) => (
                  <FeedItem key={item.atUri} item={item} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
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
