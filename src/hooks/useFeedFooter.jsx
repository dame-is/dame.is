import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const FeedFooterContext = createContext(null);

/**
 * Lets a feed page (Home and friends) hand the global <Footer /> the
 * timestamp of the newest record it's currently showing. Feed pages have no
 * single backing record, so the footer's usual "written … · updated …" pair
 * (read from the route's record via useAtUri) has nothing to show; instead it
 * reports when the most recent visible record landed. A page publishes its
 * latest instant on mount and clears it on unmount, so non-feed routes fall
 * straight back to the record-based footer.
 */
export function FeedFooterProvider({ children }) {
  const [latestRecordAt, setLatestRecordAt] = useState(null);
  const value = useMemo(
    () => ({ latestRecordAt, setLatestRecordAt }),
    [latestRecordAt],
  );
  return <FeedFooterContext.Provider value={value}>{children}</FeedFooterContext.Provider>;
}

export function useFeedFooter() {
  return useContext(FeedFooterContext) || { latestRecordAt: null, setLatestRecordAt: () => {} };
}

/**
 * The newest `createdAt` across a list of feed items. Feeds are already
 * sorted newest-first, but this is order-agnostic so a page never has to
 * care. Compared by parsed instant (not string order) since timestamps
 * carry mixed timezone offsets across record types.
 */
export function newestInstant(items) {
  let newest = null;
  let newestMs = -Infinity;
  for (const it of items || []) {
    const t = it?.createdAt;
    if (!t) continue;
    const ms = Date.parse(t);
    if (Number.isFinite(ms) && ms > newestMs) {
      newestMs = ms;
      newest = t;
    }
  }
  return newest;
}

/**
 * Publish `instant` (the newest visible record's timestamp) to the global
 * footer for as long as the calling feed page is mounted, clearing it on
 * unmount so other routes fall back to the record-based footer.
 */
export function usePublishLatestRecord(instant) {
  const { setLatestRecordAt } = useFeedFooter();
  useEffect(() => {
    setLatestRecordAt(instant || null);
    return () => setLatestRecordAt(null);
  }, [instant, setLatestRecordAt]);
}
