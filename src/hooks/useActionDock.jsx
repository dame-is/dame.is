import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { OAUTH_CALLBACK_PATH } from '../config.js';

const ActionDockContext = createContext(null);
const STORAGE_KEY = 'dame.dock.open';

/** Is this page load the return leg of an OAuth round-trip? */
function isOauthReturn() {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith(OAUTH_CALLBACK_PATH);
}

export function ActionDockProvider({ children }) {
  const [open, setOpen] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    // Signing in happens from the dock's own account view, so the dock is open
    // when the flow redirects away — and the stored flag would faithfully
    // reopen it on the way back, leaving the nav expanded over whatever page
    // the callback forwards to. An OAuth round-trip is a departure, not a
    // reload: the visitor left the site and returns somewhere else entirely,
    // so don't restore the sheet they had open when they left. Decided in the
    // initializer rather than closed later so the sheet never flashes open.
    // The persist effect below rewrites the flag to match.
    if (isOauthReturn()) return false;
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
