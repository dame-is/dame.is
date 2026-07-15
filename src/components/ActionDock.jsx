import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useNavRoutes } from '../hooks/useNavRoutes.js';
import { usePreventScrollChain } from '../hooks/usePreventScrollChain.js';
import SignInPanel from './SignInPanel.jsx';
import DebugPane from './DebugPane.jsx';
import './ActionDock.css';

export default function ActionDock() {
  // Sheet-replace navigation: the dock has three interchangeable views.
  // 'menu' is the root; the tool buttons (now relocated into the bottom
  // chrome bar) push to 'account' and 'debug'. Each sub-view has a back
  // chevron header. `view`/`setView` live in the dock context so the bar
  // can drive them.
  const { open, view, setView, openDock, closeDock } = useActionDock();
  const routes = useNavRoutes();
  const reduce = useReducedMotion();
  const panelRef = useRef(null);
  // Keep a touch-drag on the open sheet from scrolling the concealed page
  // behind it (the route list often fits without overflowing).
  usePreventScrollChain(panelRef, open);

  // Esc pops the sub-view first; only closes the dock once we're back
  // at the root menu. The Modal's built-in Esc handler is disabled
  // (closeOnEscape={false}) so this handler owns the key.
  // Scrim clicks still go through Modal.onClose → full dock close.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (view !== 'menu') setView('menu');
      else closeDock();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, view, closeDock]);

  // `?` toggles the atmosphere debug view from anywhere in the app
  // (ignoring keystrokes inside text inputs). Opens the dock if needed
  // and jumps straight to the debug sub-view; pressing again from
  // within debug closes the whole dock.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== '?') return;
      const tag = e.target?.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
      if (editing) return;
      e.preventDefault();
      if (open && view === 'debug') {
        closeDock();
      } else {
        setView('debug');
        if (!open) openDock();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, view, openDock, closeDock]);

  if (typeof document === 'undefined') return null;

  // The dock is a sheet that expands UPWARD out of the bottom chrome
  // bar — the mirror of the top bar's expand-down rows. A motion.div
  // pinned above the bar animates height 0 ↔ auto with overflow
  // hidden, so the panel unfurls upward instead of overlaying as a
  // centered modal. A transparent (non-dimming) backdrop below the
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
          <motion.div
            key="dock-sheet"
            className="dock-sheet-wrap"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: reduce ? 0 : 0.34, ease: [0.32, 0.72, 0, 1] }}
          >
            <div
              ref={panelRef}
              id="action-dock-panel"
              className={`dock-panel dock-panel-view-${view}`}
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
                <nav className="dock-routes">
                  {routes.map((r) => (
                    <NavLink
                      key={r.to}
                      to={r.to}
                      end={r.to === '/'}
                      className={({ isActive }) => `dock-route ${isActive ? 'is-active' : ''}`}
                      onClick={closeDock}
                    >
                      <span className="dock-route-label">{r.label}</span>
                      <span className="dock-route-path">{r.to}</span>
                    </NavLink>
                  ))}
                </nav>
              </div>
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

          {view === 'debug' && (
            <motion.div
              key="debug"
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
                  <div className="dock-heading">atmosphere · this page</div>
                </div>
                <DebugPane onClose={closeDock} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
