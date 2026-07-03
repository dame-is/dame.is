import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowUp, Compass, Home, Info, ListFilterPlus, Moon, MoonStar, Search, Sun, SunDim } from 'lucide-react';
import { useChromeBar } from '../hooks/useChromeBar.jsx';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useFeedFilter } from '../hooks/useFeedFilter.jsx';
import { useTheme } from '../hooks/useTheme.jsx';
import { isRefreshing, subscribeRefresh } from '../lib/feedCache.js';
import NowStatus from './NowStatus.jsx';
import NowPlaying from './NowPlaying.jsx';
import ProfileStats from './ProfileStats.jsx';
import SearchModal from './SearchModal.jsx';
import InfoModal from './InfoModal.jsx';
import './ChromeBar.css';

// Per-theme glyph for the cycle button — each of the 4 stops gets a
// distinct sun/moon variant so the current theme is readable at a
// glance instead of being collapsed into a binary sun/moon swap.
const THEME_ICON = {
  'light-mono': Sun,
  light: SunDim,
  'dark-mono': Moon,
  dark: MoonStar,
};

export default function ChromeBar() {
  const { expanded, toggle } = useChromeBar();
  const { open: dockOpen, toggle: toggleDock } = useActionDock();
  const reduce = useReducedMotion();
  const location = useLocation();
  // Pulse the brand mark whenever any live feed is currently refreshing.
  const refreshing = useSyncExternalStore(subscribeRefresh, isRefreshing, () => false);

  // Tertiary chrome: a breadcrumb that slides down out of the top bar once
  // the page is scrolled away from its top, orienting you to where you are.
  // It only exists off the home page, and folds back up on the way to the top.
  const crumbs = buildCrumbs(location.pathname);
  const scrolledDown = useScrolledDown();
  const showBreadcrumb = crumbs.length > 0 && scrolledDown;

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
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {showBreadcrumb && (
            <motion.div
              key="tertiary"
              id="chrome-bar-tertiary"
              className="chrome-bar-tertiary-wrap"
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              transition={{ duration: reduce ? 0 : 0.32, ease: [0.32, 0.72, 0, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <div className="chrome-bar-row chrome-bar-tertiary">
                <motion.nav
                  className="chrome-breadcrumb"
                  aria-label="Breadcrumb"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{
                    duration: reduce ? 0 : 0.24,
                    ease: [0.22, 0.61, 0.36, 1],
                    delay: reduce ? 0 : 0.04,
                  }}
                >
                  <ol className="chrome-crumbs">
                    <li className="chrome-crumb">
                      <Link to="/" className="chrome-crumb-link chrome-crumb-root" aria-label="Home">
                        /
                      </Link>
                    </li>
                    {crumbs.map((c, i) => {
                      const last = i === crumbs.length - 1;
                      return (
                        <li key={c.to} className="chrome-crumb">
                          {i > 0 && (
                            <span className="chrome-crumb-sep" aria-hidden="true">
                              /
                            </span>
                          )}
                          {last ? (
                            <span className="chrome-crumb-current" aria-current="page">
                              {c.label}
                            </span>
                          ) : (
                            <Link to={c.to} className="chrome-crumb-link">
                              {c.label}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </motion.nav>
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
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const reduce = useReducedMotion();
  const atTop = useAtTopOfPage();
  const scrolledPast = useScrolledPastFeedItems();
  const { available: filterAvailable, open: filterOpen, toggleModal: toggleFilter } = useFeedFilter();
  const { theme, cycle: cycleTheme } = useTheme();
  const ThemeIcon = THEME_ICON[theme] || Sun;
  // Trigger buttons highlight when the corresponding URL state is
  // populated — search has a `?q=`, filter has a custom verb set.
  const searchActive = !!params.get('q');
  const filterCustomized = params.has('verbs');
  const onHomePage = location.pathname === '/';
  // A "sub page" is anything nested one level deeper than a section index
  // (e.g. /curating/:slug, /creating/:slug) — those get a back handle in
  // the bottom bar that walks up to the section index (the breadcrumb parent).
  const crumbs = buildCrumbs(location.pathname);
  const isSubPage = crumbs.length >= 2;
  const parentPath = isSubPage ? crumbs[crumbs.length - 2].to : '/';

  function goBack() {
    // Prefer real history so the back button mirrors the browser's, but fall
    // back to the breadcrumb parent when this was a fresh/deep-linked load.
    if (window.history.length > 1) navigate(-1);
    else navigate(parentPath);
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  function scrollToBottom() {
    const h = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    window.scrollTo({ top: h, behavior: reduce ? 'auto' : 'smooth' });
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
        {!onHomePage && (
          <Link
            to="/"
            className="chrome-nav chrome-home-btn"
            aria-label="Go home"
          >
            <Home className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
          </Link>
        )}
        <button
          type="button"
          className={`chrome-nav chrome-info-btn ${infoOpen ? 'is-open' : ''}`}
          onClick={() => setInfoOpen(true)}
          aria-expanded={infoOpen}
          aria-haspopup="dialog"
          aria-label="About this site"
        >
          <Info className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
        </button>
        <div className="chrome-bottom-spacer" aria-hidden="true" />
        {isSubPage && (
          <button
            type="button"
            className="chrome-nav chrome-back-btn"
            onClick={goBack}
            aria-label="Go back"
          >
            <ArrowLeft className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
          </button>
        )}
        <AnimatePresence initial={false}>
          {scrolledPast > 0 && (
            <motion.span
              key="scroll-count"
              className="chrome-scroll-count gutter"
              initial={reduce ? false : { opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: 6 }}
              transition={{ duration: reduce ? 0 : 0.18, ease: 'easeOut' }}
              aria-label={`${scrolledPast} items scrolled past`}
            >
              {scrolledPast}
            </motion.span>
          )}
        </AnimatePresence>
        <button
          type="button"
          className="chrome-nav chrome-scroll-jump"
          onClick={atTop ? scrollToBottom : scrollToTop}
          aria-label={atTop ? 'Scroll to bottom' : 'Scroll to top'}
        >
          {atTop ? (
            <ArrowDown className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
          ) : (
            <ArrowUp className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
          )}
        </button>
        {filterAvailable && (
          <button
            type="button"
            className={`chrome-nav chrome-filter ${filterOpen || filterCustomized ? 'is-open' : ''}`}
            onClick={toggleFilter}
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            aria-label={filterOpen ? 'Close filters' : 'Open filters'}
          >
            <ListFilterPlus className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          className="chrome-nav chrome-theme-toggle"
          onClick={cycleTheme}
          aria-label={`Cycle theme (current: ${theme})`}
          title={`Theme: ${theme} — tap to cycle`}
        >
          <ThemeIcon className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
        </button>
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
      <InfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}

/** Split a pathname into breadcrumb crumbs, each `{ label, to }` where
 *  `to` is the cumulative path up to and including that segment. The home
 *  root (`/`) is rendered separately as the leading slash, so this returns
 *  an empty array on the home page. Segments are URL-decoded for display. */
function buildCrumbs(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs = [];
  let acc = '';
  for (const p of parts) {
    acc += `/${p}`;
    let label = p;
    try {
      label = decodeURIComponent(p);
    } catch {}
    crumbs.push({ label, to: acc });
  }
  return crumbs;
}

/** True once the window is scrolled past `threshold` px from the top.
 *  Drives the tertiary breadcrumb: it slides down as you leave the top of
 *  the page and folds back up on return. Threshold roughly tracks the
 *  chrome bar's own height so the crumb doesn't flicker on tiny nudges. */
function useScrolledDown(threshold = 64) {
  const [down, setDown] = useState(false);
  useEffect(() => {
    function onScroll() {
      setDown((window.scrollY || 0) > threshold);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return down;
}

/** True while the window is scrolled to (or within 1px of) the top.
 *  Drives the scroll-jump button's direction — scroll-to-bottom when
 *  we're already at the top, scroll-to-top otherwise. */
function useAtTopOfPage() {
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    function onScroll() {
      setAtTop((window.scrollY || 0) <= 1);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return atTop;
}

/** Count of `.feed-item` elements whose bottom edge has passed above
 *  the viewport — i.e. items the user has scrolled past. Returns 0 on
 *  pages with no feed, so the count chip naturally hides itself.
 *
 *  Coalesced through requestAnimationFrame so a flurry of scroll
 *  events on a long feed only triggers one DOM walk per frame. Also
 *  recomputes on route change since the feed content swaps out. */
function useScrolledPastFeedItems() {
  const [count, setCount] = useState(0);
  const location = useLocation();
  useEffect(() => {
    let frame = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const items = document.querySelectorAll('.feed-item');
        let n = 0;
        for (const el of items) {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0) n += 1;
        }
        setCount(n);
      });
    }
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [location.pathname]);
  return count;
}
