import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import FeedSearch, { matchesQuery } from '../components/FeedSearch.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { groupByDay } from '../lib/time.js';
import { getAuthorFeed } from '../lib/atproto.js';
import { blueskyPostToFeedItem } from '../lib/feedBuilder.js';
import { groupSelfReplyThreads, threadAwareDateKey } from '../lib/threadGrouping.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

export default function Posting() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';

  const { items, status, refreshedAt } = useLiveFeed({
    name: 'posts',
    strategy: 'live-first',
    fetchLive: () => getAuthorFeed(ME_DID, { max: 200 }),
    mapItems: toPostingItems,
  });

  const loading = status === 'loading';
  const safeItems = items || [];
  const filtered = useMemo(
    () => safeItems.filter((i) => matchesQuery(i.payload?.text, q)),
    [safeItems, q],
  );
  const threaded = useMemo(() => groupSelfReplyThreads(filtered, ME_DID), [filtered]);
  const groups = groupByDay(threaded, threadAwareDateKey);

  return (
    <PageShell
      title="Posting"
      intro="Bluesky posts, freshest first, grouped by day-of-life."
      atUri={`at://${ME_DID}/is.dame.page/posting`}
      headTitle="Posting — Dame is&hellip;"
    >
      <div className="feed-filters feed-filters-search-only">
        <FeedSearch label="Search posts" />
      </div>
      {loading ? (
        <FeedSkeleton rows={6} label="Loading posts" />
      ) : status === 'error' ? (
        <p className="feed-empty">Live refresh failed and no cached snapshot is available.</p>
      ) : groups.length === 0 ? (
        <p className="feed-empty">{q ? 'No posts match that search.' : 'No posts yet.'}</p>
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

/**
 * Reshape `getAuthorFeed` rows into FeedItem payloads. Reposts are
 * surfaced under the dedicated `reposting` verb (and their own per-record
 * pages), so /posting only shows posts Dame actually authored —
 * `blueskyPostToFeedItem` already drops them by returning null.
 *
 * The snapshot file stores the same `getAuthorFeed` envelope shape, so
 * this mapper handles both inputs uniformly.
 */
function toPostingItems(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => blueskyPostToFeedItem(row))
    .filter((item) => item && item.atUri);
}
