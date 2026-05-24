import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Feed-filter affordance state.
 *
 * The verb-filter modal is triggered from the bottom chrome bar so it
 * needs a way to (a) know whether the current route exposes filters
 * (only `Home` does today) and (b) signal "open" / "close" without
 * directly importing each other.
 *
 * Pages that own filterable lists call `useRegisterFeedFilter` so the
 * chrome bar can render its filter button only while one is mounted.
 */
const FeedFilterContext = createContext(null);

export function FeedFilterProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [registered, setRegistered] = useState(0);

  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);
  const toggleModal = useCallback(() => setOpen((prev) => !prev), []);

  // Track registration as a count so concurrent mounts (e.g. during a
  // route crossfade) don't accidentally mark filtering unavailable.
  const register = useCallback(() => {
    setRegistered((n) => n + 1);
    return () => setRegistered((n) => Math.max(0, n - 1));
  }, []);

  // The trigger only makes sense while a filterable page is mounted;
  // if the user navigates away while the modal is open, drop it.
  useEffect(() => {
    if (registered === 0 && open) setOpen(false);
  }, [registered, open]);

  const value = useMemo(
    () => ({
      available: registered > 0,
      open,
      openModal,
      closeModal,
      toggleModal,
      register,
    }),
    [registered, open, openModal, closeModal, toggleModal, register],
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
