import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader, { DayCounts } from '../components/DayOfLifeHeader.jsx';
import PostingFilters, { filterPostingItems, postingCounts } from '../components/PostingFilters.jsx';
import FeedMore from '../components/FeedMore.jsx';
import QueryNote from '../components/QueryNote.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useFeedWindow } from '../hooks/useFeedWindow.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { newestInstant, usePublishLatestRecord } from '../hooks/useFeedFooter.jsx';
import { formatTime, groupByDay } from '../lib/time.js';
import { getAuthorFeed } from '../lib/atproto.js';
import { blueskyPostToFeedItem } from '../lib/feedBuilder.js';
import { groupSelfReplyThreads, threadAwareDateKey } from '../lib/threadGrouping.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

export default function Posting() {
  const [params] = useSearchParams();
  const { title, intro } = usePageContent('posting');

  const { items, status, refreshedAt } = useLiveFeed({
    name: 'posts',
    strategy: 'live-first',
    // Coming back here (Back from a record, say) redraws the last list at once
    // and refreshes behind it, so the page and its scroll position return on
    // the first frame rather than after a skeleton.
    remember: 'posting',
    fetchLive: () => getAuthorFeed(ME_DID, { max: 200 }),
    mapItems: toPostingItems,
  });

  const { removedUris, active: editActive } = useEditMode();
  const { layout } = useFeedLayout();
  const ledger = layout === 'ledger' && !editActive;
  const loading = status === 'loading';
  // Posts the owner deleted this session drop out at once, chips and all,
  // rather than lingering until a reload as if the delete had failed.
  const safeItems = useMemo(
    () => (items || []).filter((i) => !removedUris.has(i.atUri)),
    [items, removedUris],
  );
  const filtered = useMemo(
    () => filterPostingItems(safeItems, params, ME_DID),
    [safeItems, params],
  );
  const feedWindow = useFeedWindow(filtered, params.toString());
  const { visible } = feedWindow;
  const threaded = useMemo(() => groupSelfReplyThreads(visible, ME_DID), [visible]);
  const groups = groupByDay(threaded, threadAwareDateKey);

  // Feed page: report the newest visible record's time in the global footer.
  usePublishLatestRecord(useMemo(() => newestInstant(filtered), [filtered]));

  // Per-sub-type counts for the modal chips (counts reflect the full
  // unfiltered set so they don't churn as the user toggles). A continuation of
  // one of Dame's own threads counts as what it shows as — text, an image —
  // rather than as a reply, the same as the filter reads it.
  const counts = useMemo(() => postingCounts(safeItems, ME_DID), [safeItems]);

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/posting`}
      headTitle="dame.is posting"
      selectable
    >
      <PostingFilters counts={counts} />
      <QueryNote noun="posts" />
      {loading ? (
        <FeedSkeleton rows={6} label="Loading posts" />
      ) : status === 'error' ? (
        <p className="feed-empty">Live refresh failed and no cached snapshot is available.</p>
      ) : groups.length === 0 ? (
        <p className="feed-empty">{params.get('q') ? 'No posts match that search.' : 'No posts match these filters.'}</p>
      ) : (
        <div className={ledger ? 'feed-ledger' : undefined}>
          <ol className="feed-list reveal-stagger">
            {groups.map((group) => (
              <li key={group.dateKey} className="feed-day-group">
                {/* The day's counts, unlinked: this page is already where
                    "posted" goes. */}
                <DayOfLifeHeader
                  date={group.date}
                  variant={ledger ? 'ledger' : 'default'}
                  meta={<DayCounts items={group.items} link={false} />}
                />
                <ul className="feed-list" style={ledger ? undefined : { marginTop: 'var(--space-3)' }}>
                  {group.items.map((item) => (
                    <FeedItem
                      key={item.atUri}
                      item={item}
                      showVerb={false}
                      layout={ledger ? 'ledger' : 'cards'}
                    />
                  ))}
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
            ? `live refresh failed · snapshot from ${formatTime(refreshedAt)}`
            : `refreshed ${formatTime(refreshedAt)}`}
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
