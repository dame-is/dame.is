import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ChromeBarContext = createContext(null);
const STORAGE_KEY = 'dame.chrome.expanded';

function readInitial() {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {}
  // Default: collapsed on small screens, expanded on wider screens.
  return window.matchMedia?.('(min-width: 700px)').matches ?? true;
}

export function ChromeBarProvider({ children }) {
  const [expanded, setExpanded] = useState(readInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0');
    } catch {}
  }, [expanded]);

  const open = useCallback(() => setExpanded(true), []);
  const close = useCallback(() => setExpanded(false), []);
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const value = useMemo(() => ({ expanded, open, close, toggle }), [expanded, open, close, toggle]);
  return <ChromeBarContext.Provider value={value}>{children}</ChromeBarContext.Provider>;
}

export function useChromeBar() {
  const ctx = useContext(ChromeBarContext);
  if (!ctx) throw new Error('useChromeBar must be used inside <ChromeBarProvider>');
  return ctx;
}
