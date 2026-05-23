import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Bug, ChevronLeft, User } from 'lucide-react';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useDebugOverlay } from '../hooks/useDebugOverlay.jsx';
import Modal from './Modal.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import TypefaceToggle from './TypefaceToggle.jsx';
import SignInPanel from './SignInPanel.jsx';
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
  const { open, closeDock } = useActionDock();
  const { openOverlay } = useDebugOverlay();
  // Sheet-replace navigation: the dock has two interchangeable views.
  // The User icon in the menu's tools row pushes to the 'account' view;
  // the back chevron in the account header pops back to 'menu'.
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
      if (view === 'account') setView('menu');
      else closeDock();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, view, closeDock]);

  return (
    <Modal
      open={open}
      onClose={closeDock}
      label="Site menu"
      id="action-dock-panel"
      className="dock-panel"
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
                    onClick={() => {
                      openOverlay();
                      closeDock();
                    }}
                    aria-label="Atmosphere debug"
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
        </AnimatePresence>
      </div>
    </Modal>
  );
}
