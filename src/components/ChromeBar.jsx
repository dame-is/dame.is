import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Compass } from 'lucide-react';
import { useChromeBar } from '../hooks/useChromeBar.jsx';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { isRefreshing, subscribeRefresh } from '../lib/feedCache.js';
import NowStatus from './NowStatus.jsx';
import NowPlaying from './NowPlaying.jsx';
import DayOfLifeTicker from './DayOfLifeTicker.jsx';
import ProfileStats from './ProfileStats.jsx';
import './ChromeBar.css';

export default function ChromeBar() {
  const { expanded, toggle } = useChromeBar();
  const { open: dockOpen, toggle: toggleDock } = useActionDock();
  const reduce = useReducedMotion();
  // Pulse the brand mark whenever any live feed is currently refreshing.
  const refreshing = useSyncExternalStore(subscribeRefresh, isRefreshing, () => false);

  return (
    <header className={`chrome-bar ${expanded ? 'is-expanded' : 'is-collapsed'}`} role="banner">
      <div className="chrome-bar-row chrome-bar-primary">
        <div className="chrome-cluster">
          <Link to="/" className="chrome-title">
            <span
              className={`chrome-mark${refreshing ? ' is-refreshing' : ''}`}
              aria-hidden="true"
            >
              &#x2767;
            </span>
            <span className="chrome-name">dame.is</span>
            {refreshing && <span className="chrome-mark-sr-status">Updating live data</span>}
          </Link>
          <div className="chrome-signals chrome-signals-primary">
            <NowStatus />
          </div>
        </div>
        <button
          type="button"
          className={`chrome-nav ${dockOpen ? 'is-open' : ''}`}
          onClick={toggleDock}
          aria-expanded={dockOpen}
          aria-controls="action-dock-panel"
          aria-label={dockOpen ? 'Close menu' : 'Open menu'}
        >
          <Compass className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="chrome-expand"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls="chrome-bar-secondary"
          aria-label={expanded ? 'Collapse atmosphere bar' : 'Expand atmosphere bar'}
        >
          <motion.svg
            className="chrome-expand-glyph"
            aria-hidden="true"
            viewBox="0 0 12 12"
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: reduce ? 0 : 0.25, ease: 'easeOut' }}
          >
            <path
              d="M2.5 4.5 L6 8 L9.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="secondary"
            id="chrome-bar-secondary"
            className="chrome-bar-secondary-wrap"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: reduce ? 0 : 0.36, ease: [0.32, 0.72, 0, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="chrome-bar-row chrome-bar-secondary">
              <motion.div
                className="chrome-signals chrome-signals-secondary"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{
                  duration: reduce ? 0 : 0.28,
                  ease: [0.22, 0.61, 0.36, 1],
                  delay: reduce ? 0 : 0.06,
                }}
              >
                <NowPlaying />
                <DayOfLifeTicker />
                <ProfileStats />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
