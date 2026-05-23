import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Bug, User } from 'lucide-react';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useDebugOverlay } from '../hooks/useDebugOverlay.jsx';
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
  const [accountOpen, setAccountOpen] = useState(false);
  const reduce = useReducedMotion();

  // Reset the nested account pane whenever the dock closes so it
  // doesn't reappear pre-expanded the next time the dock opens.
  useEffect(() => {
    if (!open) setAccountOpen(false);
  }, [open]);

  return (
    <>
      <aside
        id="action-dock-panel"
        className={`dock-panel ${open ? 'is-open' : ''}`}
        aria-hidden={!open}
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
              className={`dock-tool-icon ${accountOpen ? 'is-open' : ''}`}
              onClick={() => setAccountOpen((v) => !v)}
              aria-expanded={accountOpen}
              aria-controls="dock-account-pane"
              aria-label={accountOpen ? 'Close account pane' : 'Open account pane'}
              title="Account"
            >
              <User aria-hidden="true" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {accountOpen && (
            <motion.div
              key="account"
              id="dock-account-pane"
              className="dock-account-pane"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.32, ease: [0.32, 0.72, 0, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <hr className="dock-rule" />
              <div className="dock-section">
                <div className="dock-heading">Account</div>
                <SignInPanel onAction={closeDock} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </aside>

      {open && <button className="dock-scrim" onClick={closeDock} aria-label="Close menu" tabIndex={-1} />}
    </>
  );
}
