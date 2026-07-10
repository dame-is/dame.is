import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const FeedLayoutContext = createContext(null);
const STORAGE_KEY = 'dame.feedLayout';
const VALID = ['ledger', 'cards'];
const DEFAULT = 'ledger';

/**
 * Resolve the stored layout preference. Only explicit choices count:
 * the brief cards-by-default era auto-wrote `'default'` (the card
 * view's old name) on every visit, so that value — like the retired
 * `dame.density` / `dame.compact` keys, whose denser modes map to
 * today's ledger default anyway — doesn't override it.
 */
function readInitial() {
  if (typeof localStorage === 'undefined') return DEFAULT;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (VALID.includes(stored)) return stored;
  return DEFAULT;
}

export function FeedLayoutProvider({ children }) {
  const [layout, setLayoutState] = useState(readInitial);

  // Persist only on an explicit pick — never the default — so a future
  // change of default reaches everyone who hasn't chosen otherwise.
  const setLayout = useCallback((next) => {
    if (!VALID.includes(next)) return;
    setLayoutState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const value = useMemo(
    () => ({ layout, setLayout, options: VALID }),
    [layout, setLayout],
  );
  return <FeedLayoutContext.Provider value={value}>{children}</FeedLayoutContext.Provider>;
}

export function useFeedLayout() {
  const ctx = useContext(FeedLayoutContext);
  if (!ctx) throw new Error('useFeedLayout must be used inside <FeedLayoutProvider>');
  return ctx;
}
