import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useActionDock } from './useActionDock.jsx';

/**
 * Coordinator for the transient panels that expand up out of the bottom
 * chrome bar — search, filter, and info.
 *
 * The bottom chrome hosts a family of upward-expanding surfaces:
 *   - the nav ActionDock (its own richer, persisted sheet)
 *   - the owner EditSheet (owner-only quick edit)
 *   - these lightweight panels (search / filter / info)
 *
 * They must never stack on top of each other. This context owns a single
 * `panel` string so opening one transient panel closes any other for free,
 * and it coordinates with the dock: opening a panel folds the dock away,
 * and opening the dock folds any panel away. The result is a clear
 * one-at-a-time rule across every bottom-chrome expansion.
 */
const ChromePanelContext = createContext(null);

// The known transient panels. Kept as a constant so callers and tests can
// reason about the full set without magic strings scattered around. `debug`
// (the atmosphere readout) is a panel too now, opened from the inspect HUD's
// "details" affordance rather than living as a sub-view of the nav dock.
export const CHROME_PANELS = ['search', 'filter', 'info', 'guestbook', 'debug', 'sky'];

export function ChromePanelProvider({ children }) {
  const { open: dockOpen, closeDock } = useActionDock();
  const [panel, setPanel] = useState(null);

  const openPanel = useCallback(
    (name) => {
      // The dock and a transient panel share the same slot above the bar;
      // opening a panel wins, so fold the dock away first.
      closeDock();
      setPanel(name);
    },
    [closeDock],
  );

  const closePanel = useCallback(() => setPanel(null), []);

  const togglePanel = useCallback(
    (name) => {
      closeDock();
      setPanel((prev) => (prev === name ? null : name));
    },
    [closeDock],
  );

  // The dock opening wins the bottom chrome — fold any open panel away so the
  // two never coexist. (The reverse direction lives in openPanel/togglePanel.)
  useEffect(() => {
    if (dockOpen) setPanel(null);
  }, [dockOpen]);

  const value = useMemo(
    () => ({ panel, openPanel, closePanel, togglePanel }),
    [panel, openPanel, closePanel, togglePanel],
  );
  return <ChromePanelContext.Provider value={value}>{children}</ChromePanelContext.Provider>;
}

export function useChromePanel() {
  const ctx = useContext(ChromePanelContext);
  if (!ctx) throw new Error('useChromePanel must be used inside <ChromePanelProvider>');
  return ctx;
}
