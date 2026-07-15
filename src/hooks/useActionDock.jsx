import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ActionDockContext = createContext(null);
const STORAGE_KEY = 'dame.dock.open';

export function ActionDockProvider({ children }) {
  const [open, setOpen] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === '1';
  });
  // The dock's active sub-view ('menu' | 'account'). It lives here, not inside
  // <ActionDock>, so the bottom chrome bar's relocated Account tool button can
  // drive it too — tapping Account down in the bar swaps the open sheet's view.
  // (Atmosphere debug used to be a third view; it's now its own DebugSheet.)
  const [view, setView] = useState('menu');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch {}
  }, [open]);

  // Always fall back to the root menu once the dock is closed, so it reopens
  // at the top level rather than a stale sub-view.
  useEffect(() => {
    if (!open) setView('menu');
  }, [open]);

  const openDock = useCallback(() => setOpen(true), []);
  const closeDock = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  const value = useMemo(
    () => ({ open, view, setView, openDock, closeDock, toggle }),
    [open, view, openDock, closeDock, toggle],
  );
  return <ActionDockContext.Provider value={value}>{children}</ActionDockContext.Provider>;
}

export function useActionDock() {
  const ctx = useContext(ActionDockContext);
  if (!ctx) throw new Error('useActionDock must be used inside <ActionDockProvider>');
  return ctx;
}
