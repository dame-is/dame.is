import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import FeedSearch, { matchesQuery } from '../components/FeedSearch.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { groupByDay } from '../lib/time.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

export default function Logging() {
  // `null` = snapshot still loading; `[]` = loaded but empty.
  const [items, setItems] = useState(null);
  const [params] = useSearchParams();
  const q = params.get('q') || '';

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('now').then((snap) => {
      if (cancelled) return;
      if (!Array.isArray(snap)) {
        setItems([]);
        return;
      }
      setItems(
        snap
          .filter((r) => r?.uri && r.value)
          .map((r) => ({
            verb: 'logging',
            atUri: r.uri,
            cid: r.cid,
            createdAt: r.value?.createdAt,
            payload: r.value,
          })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = items === null;
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

  return (
    <PageShell
      title="Logging"
      intro="Status updates, archived. Each entry is one is.dame.now record."
      atUri={`at://${ME_DID}/is.dame.page/logging`}
      headTitle="Logging — Dame is&hellip;"
    >
      <div className="feed-filters feed-filters-search-only">
        <FeedSearch label="Search status updates" />
      </div>
      {loading ? (
        <FeedSkeleton rows={5} label="Loading status updates" />
      ) : groups.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No status records match that search.' : 'No status records yet.'}
        </p>
      ) : (
        <ol className="feed-list">
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
    </PageShell>
  );
}
