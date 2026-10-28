import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
// The three actions alone, in a context whose value never changes. A control
// that only OPENS a panel, like the hero's guestbook button, has no use for
// `panel`, and reading the full context re-rendered it on every panel opening
// and closing, its own included.
const ChromePanelActionsContext = createContext(null);

// The known transient panels. Kept as a constant so callers and tests can
// reason about the full set without magic strings scattered around. `debug`
// (the atmosphere readout) is a panel too now, opened from the inspect HUD's
// "details" affordance rather than living as a sub-view of the nav dock.
// `admin-nav` and `admin-actions` are the two the admin adds below the stacked
// breakpoint: the surface directory, and the state + secondary actions for the
// open surface. `admin-directory` is the owner's admin directory on every
// OTHER route — same button, but its links-only panel is rendered by
// AdminDirectorySheet since no admin shell exists to draw the full one. They
// coordinate with the rest for free — one panel at a time, and opening any
// folds the nav dock away.
export const CHROME_PANELS = [
  'search',
  'filter',
  'info',
  'guestbook',
  'debug',
  'sky',
  'admin-nav',
  'admin-actions',
  'admin-directory',
];

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

  // A panel belongs to the page it was opened over, so navigating closes it —
  // the same rule, and the same reasons, as the dock (see ActionDockProvider).
  // Reset during render, not in an effect, because the incoming page may open
  // one of its own from a mount effect: the guestbook opens its sheet on the
  // way back from signing in, and child effects run before a parent's, so an
  // effect here would close it again in the same commit.
  const { pathname } = useLocation();
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (panel !== null) setPanel(null);
  }

  const actions = useMemo(
    () => ({ openPanel, closePanel, togglePanel }),
    [openPanel, closePanel, togglePanel],
  );
  const value = useMemo(() => ({ panel, ...actions }), [panel, actions]);
  return (
    <ChromePanelActionsContext.Provider value={actions}>
      <ChromePanelContext.Provider value={value}>
        {children}
      </ChromePanelContext.Provider>
    </ChromePanelActionsContext.Provider>
  );
}

export function useChromePanel() {
  const ctx = useContext(ChromePanelContext);
  if (!ctx) throw new Error('useChromePanel must be used inside <ChromePanelProvider>');
  return ctx;
}

/**
 * `{ openPanel, closePanel, togglePanel }` without `panel`, for a component
 * that opens or closes panels but never asks which one is open. Stable for the
 * life of the provider, so reading it re-renders nothing.
 */
export function useChromePanelActions() {
  const ctx = useContext(ChromePanelActionsContext);
  if (!ctx)
    throw new Error(
      'useChromePanelActions must be used inside <ChromePanelProvider>',
    );
  return ctx;
}
