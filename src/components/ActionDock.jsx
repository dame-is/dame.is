import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useNavRoutes } from '../hooks/useNavRoutes.js';
import { usePreventScrollChain } from '../hooks/usePreventScrollChain.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { useEscapeLayer } from '../hooks/useEscapeLayer.js';
import { useScrollLock } from '../hooks/useScrollLock.js';
import { useOverlayHistory } from '../hooks/useOverlayHistory.js';
import SignInPanel from './SignInPanel.jsx';
import RouteList from './RouteList.jsx';
import { SHEET_SLIDE } from './BottomSheet.jsx';
import './ActionDock.css';

export default function ActionDock() {
  // Sheet-replace navigation: the dock has two interchangeable views. 'menu'
  // is the root; the account tool button (relocated into the bottom chrome
  // bar) pushes to 'account', which has a back chevron header. `view`/`setView`
  // live in the dock context so the bar can drive them. (The atmosphere-debug
  // readout used to be a third view here; it's now its own sheet — see
  // DebugSheet — reached from the inspect HUD.)
  const { open, view, setView, closeDock, overflowTools } = useActionDock();
  const routes = useNavRoutes();
  // An open sheet keeps the route list it opened with. The live is.dame.nav
  // read can land while it's open and reorder or drop rows, and a row that
  // moves under a finger costs the tap: WebKit only clicks when the link under
  // the finger as it lifts is the one it landed on, so the tap does nothing (or
  // opens the neighbour) and has to be repeated. The next open shows whatever
  // changed. Set during render, so the list is pinned on the render that opens
  // the sheet rather than one commit later.
  const [openRoutes, setOpenRoutes] = useState(open ? routes : null);
  if (open && !openRoutes) setOpenRoutes(routes);
  else if (!open && openRoutes) setOpenRoutes(null);
  const shownRoutes = openRoutes ?? routes;
  const reduce = useReducedMotion();
  const navigate = useNavigate();

  // A route tapped in the menu closes the sheet first and navigates two frames
  // later. Done together, the next page's render held the main thread before
  // the sheet's closing slide could start, so on a phone the menu sat fully
  // open for a beat and then vanished. Once the slide has started it's the
  // browser's to run (a transform), and the new page can take its time
  // underneath. A modified click (new tab, new window) is left to the link.
  const goTo = useCallback(
    (event, to) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) {
        closeDock();
        return;
      }
      event.preventDefault();
      closeDock();
      requestAnimationFrame(() => requestAnimationFrame(() => navigate(to)));
    },
    [closeDock, navigate],
  );
  const panelRef = useRef(null);
  // Keep a touch-drag on the open sheet from scrolling the concealed page
  // behind it (the route list often fits without overflowing).
  usePreventScrollChain(panelRef, open);
  // …and a wheel or PageDown over it, which that hook doesn't see.
  useScrollLock(open);
  // Back folds the menu away rather than leaving the page (MOB-04).
  useOverlayHistory(open, closeDock);
  // Focus into the dock on open, trap Tab within it, restore focus on close.
  // Escape stays owned by the handler below (it pops the sub-view first).
  useFocusTrap(panelRef, { active: open });
  // The menu is set at the bottom of the sheet, by the thumb, and on a short
  // phone (with the tools that didn't fit the bar under it) it can outgrow
  // the sheet. Open it scrolled to its end, so what's by the thumb is what's
  // in view; the top of the list is a scroll up. Before paint, so it never
  // shows the other end first.
  const toolCount = overflowTools.length;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || view !== 'menu' || !panel) return;
    if (panel.scrollHeight > panel.clientHeight) panel.scrollTop = panel.scrollHeight;
  }, [open, view, toolCount]);
  // The sheet doesn't move for the on-screen keyboard: the account view's
  // sign-in field sits where the keyboard can't reach it instead. See
  // .dock-panel-view-account in ActionDock.css.

  // Esc pops the sub-view first; only closes the dock once we're back
  // at the root menu — and only while the dock is the top overlay.
  useEscapeLayer(open, () => {
    if (view !== 'menu') setView('menu');
    else closeDock();
  });

  if (typeof document === 'undefined') return null;

  // The dock is a sheet that rises UPWARD out of the bottom chrome
  // bar — the mirror of the top bar's expand-down rows. A clip pinned
  // above the bar holds the panel, which slides up out of it
  // (SHEET_SLIDE, shared with every bottom sheet) instead of overlaying
  // as a centered modal. The slide is a transform the browser runs off
  // the main thread, so tapping a route closes the sheet smoothly even
  // while the next page renders underneath it. A transparent (non-dimming) backdrop below the
  // bars catches outside clicks to close, keeping the toolbar itself
  // tappable. Portalled to <body> so no transformed feed ancestor can
  // trap its fixed positioning.
  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="dock-backdrop"
            className="dock-backdrop"
            onClick={closeDock}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="dock-sheet" className="dock-sheet-wrap">
            <motion.div
              ref={panelRef}
              id="action-dock-panel"
              className={`dock-panel dock-panel-view-${view}`}
              {...SHEET_SLIDE}
              transition={{ ...SHEET_SLIDE.transition, duration: reduce ? 0 : SHEET_SLIDE.transition.duration }}
              role="dialog"
              aria-label="Site menu"
            >
              <div className="dock-stage">
        <AnimatePresence initial={false} mode="wait">
          {view === 'menu' && (
            <motion.div
              key="menu"
              initial={{ x: -16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -16, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.18, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <div className="dock-section">
                <div className="dock-heading">Dame is&hellip;</div>
                <RouteList routes={shownRoutes} onNavigate={goTo} />
              </div>
              {/* The bottom bar's chips that didn't fit it (at 320px, or under
                  large text), by the thumb at the foot of the sheet, each with
                  its word. The bar publishes them; each runs what the chip
                  would have. */}
              {overflowTools.length > 0 && (
                <div className="dock-section dock-overflow">
                  <div className="dock-heading" id="dock-overflow-heading">
                    Tools that didn&rsquo;t fit the bar
                  </div>
                  <div className="dock-overflow-row" role="group" aria-labelledby="dock-overflow-heading">
                    {overflowTools.map((tool) => {
                      const Glyph = tool.glyph;
                      return (
                        <button
                          key={tool.key}
                          type="button"
                          className="dock-overflow-tool"
                          onClick={tool.run}
                          title={tool.title}
                        >
                          <span className="dock-overflow-face" aria-hidden="true">
                            {tool.face || (Glyph && <Glyph strokeWidth={1.75} />)}
                          </span>
                          <span className="dock-overflow-word">{tool.word}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'account' && (
            <motion.div
              key="account"
              initial={{ x: 16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 16, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.18, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <div className="dock-section">
                <div className="dock-subhead">
                  <button
                    type="button"
                    className="dock-tool-icon dock-back"
                    onClick={() => setView('menu')}
                    aria-label="Back to menu"
                    title="Back"
                  >
                    <ChevronLeft aria-hidden="true" strokeWidth={1.75} />
                  </button>
                  <div className="dock-heading">Account</div>
                </div>
                <SignInPanel onAction={closeDock} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
