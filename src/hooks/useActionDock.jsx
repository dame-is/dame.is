import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { OAUTH_CALLBACK_PATH } from '../config.js';

const ActionDockContext = createContext(null);
const STORAGE_KEY = 'dame.dock.open';

/** Is this page load the return leg of an OAuth round-trip? */
function isOauthReturn() {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith(OAUTH_CALLBACK_PATH);
}

export function ActionDockProvider({ children }) {
  // Remembered per tab, in sessionStorage: a reload with the menu open comes
  // back with it open, and nothing else does. It used to live in localStorage,
  // so a tab closed with the menu open reopened it on the next visit, days
  // later, over whatever shared post the visitor came to read — with the dock's
  // focus trap pulling focus into it.
  const [open, setOpen] = useState(() => {
    // Signing in happens from the dock's own account view, so the dock is open
    // when the flow redirects away — and the stored flag would faithfully
    // reopen it on the way back, leaving the nav expanded over whatever page
    // the callback forwards to. An OAuth round-trip is a departure, not a
    // reload: the visitor left the site and returns somewhere else entirely,
    // so don't restore the sheet they had open when they left. Decided in the
    // initializer rather than closed later so the sheet never flashes open.
    // The persist effect below rewrites the flag to match.
    if (isOauthReturn()) return false;
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      // Storage blocked (a private window, site data off): start closed.
      return false;
    }
  });
  // The dock's active sub-view ('menu' | 'account'). It lives here, not inside
  // <ActionDock>, so the bottom chrome bar's relocated Account tool button can
  // drive it too — tapping Account down in the bar swaps the open sheet's view.
  // (Atmosphere debug used to be a third view; it's now its own DebugSheet.)
  const [view, setView] = useState('menu');

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch {
      // Storage blocked: the dock just won't survive a reload.
    }
  }, [open]);

  // The flag's old home. A '1' left there would otherwise sit forever.
  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage blocked: there's nothing there to clear either.
    }
  }, []);

  // Navigating anywhere closes the menu. The dock's own links already do,
  // but the top chrome's links, the bottom bar's Back and the browser's own
  // history all stay live above the dock's backdrop, and each of them changed
  // the page underneath while leaving the menu drawn over it — so the tap
  // looked like it had done nothing. Pathname only, so a query change (a
  // filter, a search) doesn't count. Reset during render rather than in an
  // effect, so it lands before any effect in the incoming page can open
  // something of its own.
  const { pathname } = useLocation();
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (open) setOpen(false);
  }

  // Always fall back to the root menu once the dock is closed, so it reopens
  // at the top level rather than a stale sub-view.
  useEffect(() => {
    if (!open) setView('menu');
  }, [open]);

  const openDock = useCallback(() => setOpen(true), []);
  const closeDock = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  // The bottom bar's chips that didn't fit it. The bar measures itself and
  // moves its least-needed chips out (ChromeBar's useBarOverflow); the dock
  // draws them at its foot as labelled chips, so nothing the bar offers is
  // lost at 320px or under large text. Each entry is `{ key, label, title,
  // Glyph, run }`, published by the bar only when the set changes.
  const [overflowTools, setOverflowTools] = useState([]);

  const value = useMemo(
    () => ({ open, view, setView, openDock, closeDock, toggle, overflowTools, setOverflowTools }),
    [open, view, openDock, closeDock, toggle, overflowTools],
  );
  return <ActionDockContext.Provider value={value}>{children}</ActionDockContext.Provider>;
}

export function useActionDock() {
  const ctx = useContext(ActionDockContext);
  if (!ctx) throw new Error('useActionDock must be used inside <ActionDockProvider>');
  return ctx;
}
