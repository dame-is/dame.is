import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ChromeBarContext = createContext(null);
const STORAGE_KEY = 'dame.chrome.expanded';
// Where the atmosphere starts folded. Width alone used to decide it, so a
// phone held sideways (844–932px wide, 390–430px tall) got the desktop
// default and gave over half its screen to chrome before the page began.
// A short screen folds it too, whatever its width.
const COMPACT_QUERY = '(max-width: 700px), (max-height: 500px)';

function readInitial() {
  if (typeof window === 'undefined') return true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {}
  // No stored pref: folded on phones and short screens, open on desktop,
  // where the atmosphere is the masthead at the top of every page (it
  // scrolls away with the page; see ChromeBar).
  if (typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches) {
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

  // The running head's last crumb, as the page names it (a mothing night's
  // day; a record page names its own rkey). Published by PageShell's `crumb` prop and keyed to
  // the path it was set for, so a label never outlives its page.
  const [crumb, setCrumb] = useState(null);

  const value = useMemo(
    () => ({ expanded, open, close, toggle, crumb, setCrumb }),
    [expanded, open, close, toggle, crumb],
  );
  return <ChromeBarContext.Provider value={value}>{children}</ChromeBarContext.Provider>;
}

export function useChromeBar() {
  const ctx = useContext(ChromeBarContext);
  if (!ctx) throw new Error('useChromeBar must be used inside <ChromeBarProvider>');
  return ctx;
}
