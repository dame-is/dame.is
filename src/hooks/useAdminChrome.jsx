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

/**
 * The two chrome panels the admin adds, and the DOM ids of their bodies. Stated
 * HERE rather than in either half, because the trigger lives in ChromeBar and
 * the panel lives in the admin: the button's `aria-controls` and the panel's
 * `id` have to be the same string, and neither file may import the other.
 * `useChromePanel` knows both names too — see CHROME_PANELS.
 */
export const ADMIN_NAV_PANEL = 'admin-nav';
export const ADMIN_ACTIONS_PANEL = 'admin-actions';
export const ADMIN_NAV_PANEL_ID = 'chrome-admin-nav-sheet';
export const ADMIN_ACTIONS_PANEL_ID = 'chrome-admin-actions-sheet';

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
 *   surface  — `{ key, label, shortLabel }` for the open surface, or null off
 *              /admin. Deliberately NO icon: a surface names its glyph as a
 *              lucide STRING, and resolving a name to a component needs the
 *              whole icon set — `import * as icons from 'lucide-react'` in
 *              ChromeBar would put every icon in the eager bundle for every
 *              visitor. The chrome draws one fixed glyph and takes the name
 *              from `label`.
 *   actions  — `{ primary, more }`. `primary` is the surface's one-tap action —
 *              `{ id, label, run, disabled, busy, danger }` — or null; its
 *              confirm question, if it has one, is already inside `run`, so the
 *              chrome never has to know an action can refuse to run. `more`
 *              counts what is waiting in the `admin-actions` panel, which is
 *              the only thing the chrome needs to decide whether to draw the
 *              button that opens it.
 *   state    — `{ dirty, error, message }`, or null when the surface has
 *              nothing to say. The chrome paints the dot from `dirty`/`error`
 *              and names the button with `message`; the SENTENCE itself is
 *              drawn by the admin, inside the panel, from its own component.
 *   publish  — the admin only. It publishes the whole object at once (see
 *              above) and publishes `null` on unmount.
 *
 * PANELS ARE NOT PUBLISHED. `admin-nav` and `admin-actions` are rendered by the
 * admin, which is the only tree that can draw a surface directory; the chrome
 * only owns the two buttons that toggle them through `useChromePanel`.
 */
export function useAdminChrome() {
  return useContext(Ctx) || { ...EMPTY, publish: () => {} };
}
