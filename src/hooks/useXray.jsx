import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';

const XrayContext = createContext(null);

/**
 * Atmosphere X-ray — the site's signature "turn the page inside out" mode.
 *
 * When x-ray is on, every record-backed element on the page reveals the AT
 * Protocol record beneath it: the ledger feed becomes a manifest of at-uris,
 * a document shows the records it's composed from, and any single element can
 * be focused for its full substrate (fields, coordinates, depth stack).
 *
 * State lives here (like edit mode) so the chrome toggle, the feed rows, the
 * page banner, and the desktop reticule all read one source of truth:
 *   - active     — is x-ray on?
 *   - focusUri   — the at-uri of the element currently drilled into (or null).
 *                  Setting it spotlights that element and recedes the rest.
 *
 * The mode is intentionally NOT persisted — it always starts off — but it DOES
 * survive navigation (walking the site in x-ray is half the fun); only the
 * focused element clears on a route change, since a focus made on one page is
 * meaningless on the next.
 */
export function XrayProvider({ children }) {
  const [active, setActive] = useState(false);
  const [focusUri, setFocusUri] = useState(null);
  const location = useLocation();

  // Reflect the mode onto <html data-xray> so CSS can drive the bulk of the
  // reveal declaratively — the same pattern as data-theme / data-font. A
  // second attribute marks whether an element is focused, so the recede-the-
  // rest styling can gate on it without every consumer subscribing.
  useEffect(() => {
    const root = document.documentElement;
    if (active) root.setAttribute('data-xray', 'on');
    else root.removeAttribute('data-xray');
    return () => root.removeAttribute('data-xray');
  }, [active]);

  useEffect(() => {
    const root = document.documentElement;
    if (active && focusUri) root.setAttribute('data-xray-focus', 'on');
    else root.removeAttribute('data-xray-focus');
  }, [active, focusUri]);

  const enter = useCallback(() => setActive(true), []);
  const exit = useCallback(() => {
    setActive(false);
    setFocusUri(null);
  }, []);
  const toggle = useCallback(() => {
    setActive((prev) => {
      if (prev) setFocusUri(null);
      return !prev;
    });
  }, []);

  const focus = useCallback((uri) => setFocusUri(uri || null), []);
  const clearFocus = useCallback(() => setFocusUri(null), []);
  const toggleFocus = useCallback(
    (uri) => setFocusUri((cur) => (cur === uri ? null : uri || null)),
    [],
  );

  // Drop the focused element when the route changes — but keep the mode on.
  useEffect(() => {
    setFocusUri(null);
  }, [location.pathname]);

  // `i` (for inspect) toggles the mode from anywhere (ignoring keystrokes
  // inside inputs). Esc pops a focused element back to the full-page view (a
  // no-op when nothing is focused, and it never preventDefaults, so the
  // dock/modal Esc handlers still work).
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        setFocusUri((f) => (f ? null : f));
        return;
      }
      if (e.key !== 'i' && e.key !== 'I') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const value = useMemo(
    () => ({ active, focusUri, enter, exit, toggle, focus, clearFocus, toggleFocus }),
    [active, focusUri, enter, exit, toggle, focus, clearFocus, toggleFocus],
  );

  return <XrayContext.Provider value={value}>{children}</XrayContext.Provider>;
}

export function useXray() {
  const ctx = useContext(XrayContext);
  if (!ctx) throw new Error('useXray must be used inside <XrayProvider>');
  return ctx;
}
