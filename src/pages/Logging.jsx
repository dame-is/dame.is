import { useEffect, useState } from 'react';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { groupByDay } from '../lib/time.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

export default function Logging() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('now').then((snap) => {
      if (cancelled || !Array.isArray(snap)) return;
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

  const groups = groupByDay(items, (i) => i.createdAt);

  return (
    <PageShell
      verb="logging"
      title="Logging"
      intro="Status updates, archived. Each entry is one is.dame.now record."
      atUri={`at://${ME_DID}/is.dame.page/logging`}
      headTitle="Logging — Dame is&hellip;"
    >
      {groups.length === 0 ? (
        <p className="feed-empty">No status records yet.</p>
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
