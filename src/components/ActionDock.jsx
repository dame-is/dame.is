import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useDebugOverlay } from '../hooks/useDebugOverlay.jsx';
import { useAtUri } from '../hooks/useAtUri.js';
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
  const { open, toggle, closeDock } = useActionDock();
  const { openOverlay } = useDebugOverlay();
  const { atUri } = useAtUri();
  const [copied, setCopied] = useState(false);

  function copyAtUri() {
    if (!atUri) return;
    navigator.clipboard?.writeText(atUri).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {},
    );
  }

  return (
    <>
      <button
        type="button"
        className={`dock-ribbon ${open ? 'is-open' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls="action-dock-panel"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
      >
        <Compass className="dock-ribbon-mark" aria-hidden="true" strokeWidth={1.75} />
        <span className="dock-ribbon-label">{open ? 'close' : 'pages & tools'}</span>
      </button>

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
          </div>
          <button
            type="button"
            className="dock-tool"
            onClick={() => {
              openOverlay();
              closeDock();
            }}
          >
            <span className="dock-tool-label">Atmosphere debug</span>
            <kbd className="dock-tool-key">?</kbd>
          </button>
          <button
            type="button"
            className="dock-tool"
            onClick={copyAtUri}
            disabled={!atUri}
            title={atUri || 'No backing record for this route'}
          >
            <span className="dock-tool-label">{copied ? 'AT URI copied' : 'Copy AT URI'}</span>
            <span className="dock-tool-key">at://</span>
          </button>
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
