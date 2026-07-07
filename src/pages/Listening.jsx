import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { newestInstant, usePublishLatestRecord } from '../hooks/useFeedFooter.jsx';
import { groupByDay } from '../lib/time.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';

export default function Listening() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { title, intro } = usePageContent('listening');

  const { items, status, refreshedAt } = useLiveFeed({
    name: 'listening',
    strategy: 'live-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.listen, max: 500 });
    },
    mapItems: toListeningItems,
  });

  const { removedUris } = useEditMode();
  const loading = status === 'loading';
  const safeItems = items || [];
  const filtered = useMemo(
    () =>
      safeItems.filter((i) => {
        if (removedUris.has(i.atUri)) return false;
        const p = i.payload || {};
        const hay = [
          p.trackName,
          p.releaseName,
          Array.isArray(p.artists) ? p.artists.map((a) => a?.artistName).filter(Boolean).join(' ') : '',
          p.artist,
        ]
          .filter(Boolean)
          .join(' ');
        return matchesQuery(hay, q);
      }),
    [safeItems, q, removedUris],
  );
  const groups = groupByDay(filtered, (i) => i.createdAt);

  // Feed page: report the newest visible record's time in the global footer.
  usePublishLatestRecord(useMemo(() => newestInstant(filtered), [filtered]));

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/listening`}
      headTitle="Listening — Dame is&hellip;"
    >
      {loading ? (
        <FeedSkeleton rows={6} label="Loading plays" />
      ) : status === 'error' ? (
        <p className="feed-empty">Live refresh failed and no cached snapshot is available.</p>
      ) : groups.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No songs match that search.' : 'No plays yet.'}
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

function toListeningItems(records) {
  if (!Array.isArray(records)) return [];
  return records
    .filter((r) => r?.uri && r.value)
    .map((r) => ({
      verb: 'listening',
      atUri: r.uri,
      cid: r.cid,
      createdAt: r.value?.playedTime || r.value?.createdAt || null,
      payload: r.value,
    }));
}
