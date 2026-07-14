import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import WaypointsSheet from '../components/WaypointsSheet.jsx';
import { isAutoWaypointHref } from '../lib/waypoints.js';

const WaypointsModalContext = createContext(null);

/**
 * Global "Open in…" picker for outbound Bluesky links.
 *
 * Rather than wrap every one of the dozens of `bsky.app` links scattered across
 * the site, the provider installs a single capture-phase click listener on the
 * document. When a plain left-click lands on an anchor pointing at a record on
 * Bluesky's web client (bsky.app), it cancels the navigation and opens a modal
 * where the visitor can choose which client to open it in (Bluesky, Anisota,
 * Grain, Leaflet, a dev tool, …). Links to other hosts — anisota.net,
 * leaflet.pub, the Bluesky forks, … — navigate natively; the picker is still
 * reachable for those records via the explicit "Open in…" affordance.
 *
 * Escape hatches:
 *   - Modified clicks (⌘/Ctrl/Shift/Alt, middle-click) are left alone so
 *     "open in new tab" still works.
 *   - Any anchor (or ancestor) carrying `data-no-waypoints` is ignored — the
 *     modal marks its own links this way so its rows don't re-trigger it.
 *   - `download` links are left alone.
 *
 * Consumers can also open the picker imperatively via `useWaypointsModal()`
 * — used by <AturiActions> to turn its "Open in…" affordance into this modal
 * instead of a round-trip to aturi.to.
 */
export function WaypointsModalProvider({ children }) {
  const [href, setHref] = useState(null);

  const openWaypoints = useCallback((target) => {
    if (target) setHref(String(target));
  }, []);
  const close = useCallback(() => setHref(null), []);

  useEffect(() => {
    function onClick(e) {
      // Respect new-tab / new-window intents and non-primary buttons.
      if (e.defaultPrevented) return;
      if (e.button != null && e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = e.target?.closest?.('a[href]');
      if (!anchor) return;
      if (anchor.hasAttribute('download')) return;
      // Opt-out for the modal's own links (and any consumer that wants the
      // native navigation).
      if (anchor.closest('[data-no-waypoints]')) return;

      // Only Bluesky (bsky.app) record/profile links auto-open the picker;
      // every other host (anisota.net, leaflet.pub, the forks, …) navigates
      // natively. Uses the resolved absolute href from the DOM.
      if (!isAutoWaypointHref(anchor.href)) return;

      e.preventDefault();
      setHref(anchor.href);
    }

    // Capture phase so we win before React Router / other handlers, and so a
    // stopPropagation() upstream can't hide the click from us.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const value = useMemo(() => ({ openWaypoints, close }), [openWaypoints, close]);

  return (
    <WaypointsModalContext.Provider value={value}>
      {children}
      <WaypointsSheet open={href != null} href={href} onClose={close} />
    </WaypointsModalContext.Provider>
  );
}

export function useWaypointsModal() {
  const ctx = useContext(WaypointsModalContext);
  if (!ctx) throw new Error('useWaypointsModal must be used inside <WaypointsModalProvider>');
  return ctx;
}
