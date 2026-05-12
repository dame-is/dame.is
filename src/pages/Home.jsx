import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedFilters, { filterFeed } from '../components/FeedFilters.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { groupByDay } from '../lib/time.js';
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
  const [feed, setFeed] = useState([]);
  const [loadedAt, setLoadedAt] = useState(null);

  // The unified snapshot is built at prefetch time with every verb's
  // records (and resolved subjects for reference verbs) already merged.
  // We just refetch it once on mount so a recent rebuild surfaces; no
  // per-verb fan-out is needed any more.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const snap = await fetchSnapshot('unifiedFeed');
      if (!cancelled && Array.isArray(snap)) {
        setFeed(snap);
        setLoadedAt(new Date());
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const c = {};
    for (const item of feed) c[item.verb] = (c[item.verb] || 0) + 1;
    return c;
  }, [feed]);

  const filtered = useMemo(() => filterFeed(feed, params), [feed, params]);
  const collapsed = useMemo(() => collapseListens(filtered), [filtered]);
  const groups = useMemo(() => groupByDay(collapsed, (i) => i.createdAt), [collapsed]);

  return (
    <PageShell
      title="Latest"
      intro="What Dame has been up to most recently. Powered by the AT Protocol."
      atUri={`at://${ME_DID}/is.dame.page/home`}
      headTitle="Dame is&hellip;"
    >
      <FeedFilters counts={counts} />
      {filtered.length === 0 ? (
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
      {loadedAt && (
        <p className="gutter feed-loaded-at" style={{ marginTop: 'var(--space-7)', textAlign: 'center' }}>
          {filtered.length} of {feed.length} records · refreshed {loadedAt.toLocaleTimeString()}
        </p>
      )}
    </PageShell>
  );
}
