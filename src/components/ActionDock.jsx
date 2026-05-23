import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Bug, ChevronLeft, User } from 'lucide-react';
import { useActionDock } from '../hooks/useActionDock.jsx';
import Modal from './Modal.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import TypefaceToggle from './TypefaceToggle.jsx';
import SignInPanel from './SignInPanel.jsx';
import DebugPane from './DebugPane.jsx';
import './ActionDock.css';

const ROUTES = [
  { to: '/', label: 'Home' },
  { to: '/about', label: 'About' },
  { to: '/posting', label: 'Posting' },
  { to: '/logging', label: 'Logging' },
  { to: '/blogging', label: 'Blogging' },
  { to: '/creating', label: 'Creating' },
  { to: '/sharing', label: 'Sharing' },
  { to: '/admin', label: 'Admin' },
];

export default function ActionDock() {
  const { open, openDock, closeDock } = useActionDock();
  // Sheet-replace navigation: the dock has three interchangeable views.
  // 'menu' is the root; the User icon pushes to 'account' and the Bug
  // icon pushes to 'debug'. Each sub-view has a back chevron header.
  const [view, setView] = useState('menu');
  const reduce = useReducedMotion();

  // Always start at the menu view when the dock reopens.
  useEffect(() => {
    if (!open) setView('menu');
  }, [open]);

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

  return (
    <Modal
      open={open}
      onClose={closeDock}
      label="Site menu"
      id="action-dock-panel"
      className={`dock-panel dock-panel-view-${view}`}
      scrimLabel="Close menu"
      closeOnEscape={false}
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
                <div className="dock-heading">Pages</div>
                <nav className="dock-routes">
                  {ROUTES.map((r) => (
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

              <hr className="dock-rule" />

              <div className="dock-section">
                <div className="dock-heading">Tools</div>
                <div className="dock-display-row">
                  <ThemeToggle />
                  <TypefaceToggle />
                  <button
                    type="button"
                    className="dock-tool-icon"
                    onClick={() => setView('debug')}
                    aria-label="Open atmosphere debug"
                    title="Atmosphere debug"
                  >
                    <Bug aria-hidden="true" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="dock-tool-icon"
                    onClick={() => setView('account')}
                    aria-label="Open account"
                    title="Account"
                  >
                    <User aria-hidden="true" strokeWidth={1.75} />
                  </button>
                </div>
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
    </Modal>
  );
}
