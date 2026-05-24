import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ArrowUp, Compass, Search, SlidersHorizontal } from 'lucide-react';
import { useChromeBar } from '../hooks/useChromeBar.jsx';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useFeedFilter } from '../hooks/useFeedFilter.jsx';
import { isRefreshing, subscribeRefresh } from '../lib/feedCache.js';
import NowStatus from './NowStatus.jsx';
import NowPlaying from './NowPlaying.jsx';
import DayOfLifeTicker from './DayOfLifeTicker.jsx';
import ProfileStats from './ProfileStats.jsx';
import SearchModal from './SearchModal.jsx';
import './ChromeBar.css';

export default function ChromeBar() {
  const { expanded, toggle } = useChromeBar();
  const { open: dockOpen, toggle: toggleDock } = useActionDock();
  const reduce = useReducedMotion();
  // Pulse the brand mark whenever any live feed is currently refreshing.
  const refreshing = useSyncExternalStore(subscribeRefresh, isRefreshing, () => false);

  return (
    <>
      <header
        className={`chrome-bar chrome-bar-top ${expanded ? 'is-expanded' : 'is-collapsed'}`}
        role="banner"
      >
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
            className={`chrome-nav chrome-nav-top ${dockOpen ? 'is-open' : ''}`}
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
                  <ProfileStats />
                  <DayOfLifeTicker />
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <ChromeBarBottom dockOpen={dockOpen} toggleDock={toggleDock} />
    </>
  );
}

function ChromeBarBottom({ dockOpen, toggleDock }) {
  const [params] = useSearchParams();
  const [searchOpen, setSearchOpen] = useState(false);
  const reduce = useReducedMotion();
  const scrolledDown = useScrolledDown(400);
  const { available: filterAvailable, open: filterOpen, toggleModal: toggleFilter } = useFeedFilter();
  // Trigger buttons highlight when the corresponding URL state is
  // populated — search has a `?q=`, filter has a custom verb set.
  const searchActive = !!params.get('q');
  const filterCustomized = params.has('verbs');

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  return (
    <div className="chrome-bar chrome-bar-bottom" role="toolbar" aria-label="Global actions">
      <div className="chrome-bottom-row">
        <button
          type="button"
          className={`chrome-nav chrome-search-btn ${searchOpen || searchActive ? 'is-open' : ''}`}
          onClick={() => setSearchOpen(true)}
          aria-expanded={searchOpen}
          aria-haspopup="dialog"
          aria-label={searchActive ? `Search (current query: ${params.get('q')})` : 'Open search'}
        >
          <Search className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
        </button>
        <div className="chrome-bottom-spacer" aria-hidden="true" />
        <AnimatePresence initial={false}>
          {scrolledDown && (
            <motion.button
              key="scroll-top"
              type="button"
              className="chrome-nav chrome-scroll-top"
              onClick={scrollToTop}
              aria-label="Scroll to top"
              initial={reduce ? false : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              transition={{ duration: reduce ? 0 : 0.18, ease: 'easeOut' }}
            >
              <ArrowUp className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
            </motion.button>
          )}
        </AnimatePresence>
        {filterAvailable && (
          <button
            type="button"
            className={`chrome-nav chrome-filter ${filterOpen || filterCustomized ? 'is-open' : ''}`}
            onClick={toggleFilter}
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            aria-label={filterOpen ? 'Close filters' : 'Open filters'}
          >
            <SlidersHorizontal className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          className={`chrome-nav chrome-nav-bottom ${dockOpen ? 'is-open' : ''}`}
          onClick={toggleDock}
          aria-expanded={dockOpen}
          aria-controls="action-dock-panel"
          aria-label={dockOpen ? 'Close menu' : 'Open menu'}
        >
          <Compass className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
        </button>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

/** Tracks whether the window has scrolled past `threshold` pixels.
 *  Used to gate the scroll-to-top button so it only appears when it
 *  actually has somewhere to scroll to. */
function useScrolledDown(threshold) {
  const [down, setDown] = useState(false);
  useEffect(() => {
    function onScroll() {
      setDown(window.scrollY > threshold);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return down;
}
