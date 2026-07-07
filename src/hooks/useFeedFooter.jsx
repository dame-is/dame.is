import { createContext, useContext, useMemo, useState } from 'react';

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
