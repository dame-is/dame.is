/**
 * The end of a windowed feed (see hooks/useFeedWindow.js): an invisible
 * tripwire that reveals the next window as it scrolls into range, or — where
 * IntersectionObserver isn't available — a "Load more" button. Nothing once
 * the whole feed is showing. Same markup as the home feed's foot, so it shares
 * Feed.css.
 */
export default function FeedMore({
  hasMore,
  loadMore,
  sentinelRef,
  canObserve,
}) {
  if (!hasMore) return null;
  if (canObserve) {
    return (
      <div
        ref={sentinelRef}
        className="feed-load-sentinel"
        aria-hidden="true"
      />
    );
  }
  return (
    <div className="feed-load-more">
      <button type="button" className="btn feed-load-more-btn" onClick={loadMore}>
        Load more
      </button>
    </div>
  );
}
