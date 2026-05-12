import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useChromeBar } from '../hooks/useChromeBar.jsx';
import NowStatus from './NowStatus.jsx';
import NowPlaying from './NowPlaying.jsx';
import DayOfLifeTicker from './DayOfLifeTicker.jsx';
import ProfileStats from './ProfileStats.jsx';
import './ChromeBar.css';

export default function ChromeBar() {
  const { expanded, toggle } = useChromeBar();
  const reduce = useReducedMotion();

  return (
    <header className={`chrome-bar ${expanded ? 'is-expanded' : 'is-collapsed'}`} role="banner">
      <div className="chrome-bar-row chrome-bar-primary">
        <Link to="/" className="chrome-title">
          <span className="chrome-mark">&#x2767;</span>
          <span className="chrome-name">dame.is</span>
        </Link>
        <div className="chrome-signals chrome-signals-primary">
          <NowStatus />
        </div>
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
            className="chrome-bar-row chrome-bar-secondary"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.32, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <div className="chrome-signals chrome-signals-secondary">
              <NowPlaying />
              <DayOfLifeTicker />
              <ProfileStats />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
