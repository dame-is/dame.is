import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ChromeBarContext = createContext(null);
const STORAGE_KEY = 'dame.chrome.expanded';
const MOBILE_QUERY = '(max-width: 700px)';

function readInitial() {
  if (typeof window === 'undefined') return true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {}
  // No stored pref: collapsed by default on mobile (the bar sits at the
  // viewport bottom and we want the smaller footprint), expanded on
  // desktop where the secondary signals are part of the everyday view.
  if (typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches) {
    return false;
  }
  return true;
}

export function ChromeBarProvider({ children }) {
  const [expanded, setExpanded] = useState(readInitial);
  // Skip persisting on the very first render so the viewport default
  // doesn't get baked into storage — only deliberate user toggles do.
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
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
