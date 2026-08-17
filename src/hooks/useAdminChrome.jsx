// The seam between the admin and the site's bottom chrome bar.
//
// Below the stacked breakpoint the admin stops drawing its own top bar and its
// own action bar and wears the site's chrome instead — one bar for the whole
// site on a phone, which is also the only way to stop the admin's bar and
// Safari's own toolbar from stacking up at the bottom of the screen.
//
// That leaves ChromeBar needing three things it cannot see: which admin surface
// is open, what the surface's primary action is, and what its state is. The
// admin sits far below ChromeBar in the tree, so it publishes them upward
// through this provider, which App.jsx mounts above both.
//
// This is deliberately NOT a revival of `pageEditor`, the context member the
// rebuild removed. That one put a floating bar over the form on every width and
// owned the whole editing surface. This one carries a description of the current
// surface for the chrome to draw, is read only below the breakpoint, and never
// renders anything itself.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const Ctx = createContext(null);

/**
 * The stacked breakpoint, duplicated from src/admin/useAdminShell.jsx on
 * purpose. App.jsx needs it to decide whether to render ChromeBar, and importing
 * it from the admin would pull the whole admin — and with it @atproto/api — into
 * the main bundle, undoing the `lazy()` that keeps it out for every visitor who
 * is not the owner. The two must stay in step; there is a test asserting it.
 */
export const ADMIN_STACK_QUERY = '(max-width: 60rem)';

/** True while the viewport is narrow enough for the admin to stack. */
export function useStackedViewport() {
  const [stacked, setStacked] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(ADMIN_STACK_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(ADMIN_STACK_QUERY);
    const onChange = (event) => setStacked(event.matches);
    mq.addEventListener('change', onChange);
    setStacked(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return stacked;
}

/** Nothing published — what every public route sees. */
const EMPTY = Object.freeze({
  surface: null,
  actions: Object.freeze({}),
  state: null,
});

export function AdminChromeProvider({ children }) {
  // One object rather than three states: the admin publishes them together on
  // every change, and splitting them would let the chrome paint a Save button
  // for one surface beside another surface's dirty sentence for a frame.
  const [published, setPublished] = useState(EMPTY);

  // Stable so an AdminShell effect can depend on it without re-publishing on
  // every render.
  const publish = useCallback((next) => {
    setPublished(next || EMPTY);
  }, []);

  const value = useMemo(() => ({ ...published, publish }), [published, publish]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * What the admin has published for the chrome to draw.
 *
 *   surface  — `{ key, label, icon }` for the open surface, or null off /admin
 *   actions  — `{ primary, secondary[] }`, each `{ id, label, icon, run,
 *              disabled, danger }`. `primary` is the one the chrome draws as a
 *              button; `secondary` fills the actions sheet.
 *   state    — `{ dirty, message, count }` or null. `message` is the full
 *              sentence for the sheet; `count` is the compact form for the chip.
 *   publish  — AdminShell only.
 */
export function useAdminChrome() {
  return useContext(Ctx) || { ...EMPTY, publish: () => {} };
}
