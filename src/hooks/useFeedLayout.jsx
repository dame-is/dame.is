import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const FeedLayoutContext = createContext(null);
const STORAGE_KEY = 'dame.feedLayout';
// Older builds stored a tri-state density ('normal' | 'compact' | 'tight')
// and, before that, a boolean `dame.compact`. Both fold into the two-mode
// layout below.
const LEGACY_DENSITY_KEY = 'dame.density';
const LEGACY_COMPACT_KEY = 'dame.compact';
const VALID = ['default', 'ledger'];
const DEFAULT = 'default';

/**
 * Migrate the retired density preferences into the two-mode
 * `dame.feedLayout`. Anyone who had opted into a denser view
 * ('compact' / 'tight' / legacy boolean) lands on the ledger layout;
 * everyone else keeps the default. Once `dame.feedLayout` is written,
 * the legacy keys are ignored on subsequent reads.
 */
function readInitial() {
  if (typeof localStorage === 'undefined') return DEFAULT;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (VALID.includes(stored)) return stored;
  const density = localStorage.getItem(LEGACY_DENSITY_KEY);
  if (density === 'compact' || density === 'tight') return 'ledger';
  if (localStorage.getItem(LEGACY_COMPACT_KEY) === 'true') return 'ledger';
  return DEFAULT;
}

export function FeedLayoutProvider({ children }) {
  const [layout, setLayoutState] = useState(readInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, layout);
    } catch {}
  }, [layout]);

  const setLayout = useCallback((next) => {
    if (!VALID.includes(next)) return;
    setLayoutState(next);
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
