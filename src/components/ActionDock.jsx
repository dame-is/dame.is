import { NavLink } from 'react-router-dom';
import { Bug } from 'lucide-react';
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
          </div>
        </div>

        <hr className="dock-rule" />

        <div className="dock-section">
          <div className="dock-heading">Account</div>
          <SignInPanel onAction={closeDock} />
        </div>
      </aside>

      {open && <button className="dock-scrim" onClick={closeDock} aria-label="Close menu" tabIndex={-1} />}
    </>
  );
}
