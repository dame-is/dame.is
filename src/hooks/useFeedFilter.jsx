import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Feed-filter *availability* state.
 *
 * The verb-filter panel is triggered from the bottom chrome bar, so the bar
 * needs to know whether the current route exposes filters (only certain
 * feed pages do). Pages that own filterable lists call
 * `useRegisterFeedFilter` while mounted; the chrome bar renders its filter
 * button only while at least one is registered.
 *
 * The open/closed state of the panel itself lives in `useChromePanel`
 * (`panel === 'filter'`) alongside search and info, so all three bottom-chrome
 * panels obey one mutual-exclusion rule.
 */
const FeedFilterContext = createContext(null);

export function FeedFilterProvider({ children }) {
  const [registered, setRegistered] = useState(0);

  // Track registration as a count so concurrent mounts (e.g. during a
  // route crossfade) don't accidentally mark filtering unavailable.
  const register = useCallback(() => {
    setRegistered((n) => n + 1);
    return () => setRegistered((n) => Math.max(0, n - 1));
  }, []);

  const value = useMemo(
    () => ({ available: registered > 0, register }),
    [registered, register],
  );
  return <FeedFilterContext.Provider value={value}>{children}</FeedFilterContext.Provider>;
}

export function useFeedFilter() {
  const ctx = useContext(FeedFilterContext);
  if (!ctx) throw new Error('useFeedFilter must be used inside <FeedFilterProvider>');
  return ctx;
}

/**
 * Call from a filterable page so the chrome bar's filter trigger shows
 * up while it's mounted. Returns nothing; the cleanup is automatic.
 */
export function useRegisterFeedFilter() {
  const { register } = useFeedFilter();
  useEffect(() => register(), [register]);
}
