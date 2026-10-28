import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useChromePanel } from './useChromePanel.jsx';
import { useEditMode } from './useEditMode.jsx';
import { escapeWentToOverlay, hasOpenOverlay } from './useEscapeLayer.js';
import { shortcutBlocked } from '../lib/shortcuts.js';

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

  // `i` (for inspect) toggles the mode from anywhere. It does what the
  // bottom bar's inspect button does, not just the toggle: fold any open panel
  // away and leave the owner's edit mode, which competes for the same rows —
  // the bare toggle left the owner in both modes at once. It stays out of the
  // way of typing, chords, auto-repeat and an open modal (shortcutBlocked), and
  // off /admin, where the button is withheld because there's no public record
  // markup to inspect.
  //
  // Esc pops a focused element back to the full-page view — unless an overlay
  // is open, in which case the press is the overlay's and closes only that.
  // Never preventDefaults.
  const { closePanel } = useChromePanel();
  const { active: editActive, exit: exitEdit } = useEditMode();
  const inAdmin = location.pathname === '/admin';
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (hasOpenOverlay() || escapeWentToOverlay(e)) return;
        setFocusUri((f) => (f ? null : f));
        return;
      }
      if (e.key !== 'i' && e.key !== 'I') return;
      if (inAdmin || shortcutBlocked(e)) return;
      e.preventDefault();
      closePanel();
      if (editActive) exitEdit();
      toggle();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, closePanel, editActive, exitEdit, inAdmin]);

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
