import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowUp, Bug, Compass, Home, Info, ListFilterPlus, Moon, Pencil, Search, Sun, User, X } from 'lucide-react';
import { useChromeBar } from '../hooks/useChromeBar.jsx';
import { useAvatar } from '../hooks/useAvatar.js';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useFeedFilter } from '../hooks/useFeedFilter.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useTheme } from '../hooks/useTheme.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { ME_DID } from '../config.js';
import NowStatus from './NowStatus.jsx';
import NowPlaying from './NowPlaying.jsx';
import ProfileStats from './ProfileStats.jsx';
import LayoutToggle from './LayoutToggle.jsx';
import PaperToggle from './PaperToggle.jsx';
import { PAPER_ENABLED } from '../hooks/usePaper.jsx';
import SearchSheet from './SearchSheet.jsx';
import InfoSheet from './InfoSheet.jsx';
import Footer from './Footer.jsx';
import './ChromeBar.css';

// Per-theme glyph for the toggle button: sun for light, moon for dark.
const THEME_ICON = {
  light: Sun,
  dark: Moon,
};

// The home handle is a router <Link>; wrap it so it can participate in the
// bottom bar's presence/layout animation (fade in/out, slide to make room).
const MotionLink = motion.create(Link);

export default function ChromeBar() {
  const { expanded, toggle } = useChromeBar();
  const { open: dockOpen, toggle: toggleDock } = useActionDock();
  const reduce = useReducedMotion();
  const location = useLocation();
  // Brand mark: Dame's live Bluesky avatar (regenerated hourly to track the
  // sun). While it's loading — or if it ever fails — the mark simply isn't
  // rendered rather than falling back to a glyph.
  const avatar = useAvatar();
  const [avatarBroken, setAvatarBroken] = useState(false);
  const showAvatar = avatar && !avatarBroken;
  // A new hourly avatar URL gets a fresh chance to load — clear any prior
  // load failure whenever the URL turns over.
  useEffect(() => {
    setAvatarBroken(false);
  }, [avatar]);

  const topRef = useRef(null);
  const crumbRef = useRef(null);

  // Tertiary chrome: a breadcrumb that slides down out of the top bar once
  // the page is scrolled away from its top, orienting you to where you are.
  // It only exists off the home page, and folds back up on the way to the top.
  const crumbs = buildCrumbs(location.pathname);
  const scrolledDown = useScrolledDown();
  const showBreadcrumb = crumbs.length > 0 && scrolledDown;

  // Publish the top chrome's live occupied bottom as `--chrome-top-h` on
  // <html> — the y-coordinate where the top chrome ends and the content
  // region begins. It's the breadcrumb strip's bottom when the strip is
  // shown (the strip sits below the header), else the header's own
  // bottom. Consumers: the action-dock sheet (fills from here down to
  // the bottom bar so it fully conceals the page and butts against the
  // whole top chrome) and the custom window scrollbar (inset to the
  // content region between the bars).
  //
  // Measured from getBoundingClientRect().bottom, not summed
  // offsetHeights: the rect gives the real VIEWPORT position, so it
  // absorbs any top inset (iOS safe area / URL bar) that a height sum
  // would miss and leave as a gap. The breadcrumb WRAP is read (not the
  // inner strip) because the wrap isn't transformed — only the strip
  // slides inside it — so the wrap's rect is the settled bottom even
  // mid-animation. Floor so any sub-pixel bias tucks the sheet a hair
  // under the chrome rather than leaving a seam. Re-measures on
  // showBreadcrumb change, size changes, and scroll (the strip reveals
  // on scroll and the iOS URL bar resizes there), rAF-throttled.
  useEffect(() => {
    const el = topRef.current;
    if (!el) return undefined;
    const apply = () => {
      const crumb = crumbRef.current;
      const bottom =
        showBreadcrumb && crumb
          ? crumb.getBoundingClientRect().bottom
          : el.getBoundingClientRect().bottom;
      document.documentElement.style.setProperty('--chrome-top-h', `${Math.max(0, Math.floor(bottom))}px`);
    };
    apply();
    let raf = 0;
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(); });
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (ro) {
      ro.observe(el);
      if (crumbRef.current) ro.observe(crumbRef.current);
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [showBreadcrumb]);

  return (
    <>
      <header
        ref={topRef}
        className={`chrome-bar chrome-bar-top ${expanded ? 'is-expanded' : 'is-collapsed'}`}
        role="banner"
      >
        <div className="chrome-bar-row chrome-bar-primary">
          <div className="chrome-cluster">
            <Link to="/" className="chrome-title">
              {showAvatar && (
                <span className="chrome-mark chrome-mark-avatar" aria-hidden="true">
                  <img
                    key={avatar}
                    className="chrome-mark-img"
                    src={avatar}
                    alt=""
                    onError={() => setAvatarBroken(true)}
                  />
                </span>
              )}
              <span className="chrome-name">dame.is</span>
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

        {/* Breadcrumb stays mounted the whole time we're off the home page,
            and the reveal animates ONLY transform + opacity — never height.
            A height:auto animation forces a layout measurement/reflow on the
            frame it starts, and a reflow mid-scroll hands scrolling back to
            the main thread and stalls the momentum. transform/opacity run on
            the compositor and can't interrupt the scroll. The strip slides
            down from behind the bar inside a fixed clip (`overflow: hidden`
            on the wrap) instead of growing the box. */}
        {crumbs.length > 0 && (
          <div
            ref={crumbRef}
            id="chrome-bar-tertiary"
            className="chrome-bar-tertiary-wrap"
            inert={showBreadcrumb ? undefined : ''}
            aria-hidden={showBreadcrumb ? undefined : true}
            style={{ pointerEvents: showBreadcrumb ? 'auto' : 'none' }}
          >
            <motion.div
              className="chrome-bar-row chrome-bar-tertiary"
              initial={false}
              animate={{ y: showBreadcrumb ? '0%' : '-100%', opacity: showBreadcrumb ? 1 : 0 }}
              transition={{ duration: reduce ? 0 : 0.32, ease: [0.32, 0.72, 0, 1] }}
            >
              <nav className="chrome-breadcrumb" aria-label="Breadcrumb">
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
              </nav>
            </motion.div>
          </div>
        )}
      </header>

      <ChromeBarBottom dockOpen={dockOpen} toggleDock={toggleDock} />
    </>
  );
}

function ChromeBarBottom({ dockOpen, toggleDock }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { view, setView } = useActionDock();
  // Search / filter / info all expand up out of this bar as mutually
  // exclusive panels coordinated by useChromePanel (which also folds the
  // nav dock away, and vice versa) — see BottomSheet + useChromePanel.
  const { panel, togglePanel, closePanel } = useChromePanel();
  const searchPanelOpen = panel === 'search';
  const filterPanelOpen = panel === 'filter';
  const infoPanelOpen = panel === 'info';
  const reduce = useReducedMotion();
  const atTop = useAtTopOfPage();
  const scrolledPast = useScrolledPastFeedItems();
  // The footer rides the bottom chrome the way the breadcrumb rides the top:
  // it slides up out of the bar once you reach the last stretch of the page.
  const nearBottom = useNearPageBottom();
  const footerRef = useRef(null);
  const { available: filterAvailable } = useFeedFilter();
  const { theme, cycle: cycleTheme } = useTheme();
  const ThemeIcon = THEME_ICON[theme] || Sun;
  // The edit-mode toggle only exists for the site owner. It sits beside the
  // Info button and flips the site into a selectable "edit mode" (see
  // EditModeBar + useEditMode).
  const { did } = useAtprotoSession();
  const { active: editActive, toggle: toggleEdit, exit: exitEdit } = useEditMode();
  const isOwner = did === ME_DID;
  // Trigger buttons highlight when the corresponding URL state is
  // populated — search has a `?q=`, filter has a custom verb set.
  const searchActive = !!params.get('q');
  const filterCustomized = params.has('verbs');
  const onHomePage = location.pathname === '/';

  // If the route stops exposing filters while the filter panel is open
  // (e.g. navigating away from a feed), fold it away — the trigger button
  // is about to disappear from the bar.
  useEffect(() => {
    if (!filterAvailable && filterPanelOpen) closePanel();
  }, [filterAvailable, filterPanelOpen, closePanel]);

  // Publish the footer strip's height as `--chrome-bottom-footer-h` on
  // <html> so the app shell can reserve matching room below the page
  // content — the mirror of how the fixed bottom bar reserves --chrome-h.
  // Without it the strip, revealed at the page's end, would overlay the
  // last line of content (which, unlike the top, can't scroll out from
  // under it). The strip is always mounted and only slides via transform,
  // so `offsetHeight` is its settled height whether revealed or tucked
  // away. Re-measures on size changes (content reflow, viewport resize).
  useEffect(() => {
    const el = footerRef.current;
    if (!el) return undefined;
    const apply = () => {
      document.documentElement.style.setProperty(
        '--chrome-bottom-footer-h',
        `${Math.max(0, Math.ceil(el.offsetHeight))}px`,
      );
    };
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  // Every page except home gets a back handle in the bottom bar. It walks
  // back through history (mirroring the browser's back button) so you can
  // return to wherever you came from — including home → /blogging → back →
  // home, not just deep sub-pages like /creating/:slug. On a fresh or
  // deep-linked load with no in-app history, it falls back to the breadcrumb
  // parent: the section index for a sub-page, else home.
  const crumbs = buildCrumbs(location.pathname);
  const parentPath = crumbs.length >= 2 ? crumbs[crumbs.length - 2].to : '/';

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

  // Shared enter/exit for the bottom bar's on-demand controls (back, home,
  // the scrolled-past count). They cross-fade rather than sliding in on a
  // transform, and `layout` on the whole right cluster eases the persistent
  // buttons (scroll-jump, menu) over to fill the gap instead of letting them
  // jump — so a control never just pops in or out. `layout` is dropped under
  // reduced-motion so nothing translates.
  const controlFade = {
    initial: reduce ? false : { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: reduce ? 0 : 0.2, ease: [0.22, 0.61, 0.36, 1] },
  };
  const layoutProp = reduce ? undefined : true;

  return (
    <div className="chrome-bar chrome-bar-bottom" role="toolbar" aria-label="Global actions">
      <div className="chrome-bottom-row">
        {/* Left cluster. While the nav dock is open, the page-level controls
            (theme / filter / search / info) hand off to the dock's tools
            (layout / debug / account) — they animate in and temporarily
            take the same spot, then swap back when the dock closes. The
            debug/account tools drive the open sheet's sub-view. */}
        <div className="chrome-bottom-left">
          <AnimatePresence mode="wait" initial={false}>
            {dockOpen ? (
              <motion.div
                key="tools"
                className="chrome-bottom-cluster"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.18, ease: [0.22, 0.61, 0.36, 1] }}
              >
                <LayoutToggle />
                {PAPER_ENABLED && <PaperToggle />}
                <button
                  type="button"
                  className={`chrome-nav chrome-tool-debug ${view === 'debug' ? 'is-open' : ''}`}
                  onClick={() => setView(view === 'debug' ? 'menu' : 'debug')}
                  aria-pressed={view === 'debug'}
                  aria-label="Atmosphere debug"
                  title="Atmosphere debug"
                >
                  <Bug className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`chrome-nav chrome-tool-account ${view === 'account' ? 'is-open' : ''}`}
                  onClick={() => setView(view === 'account' ? 'menu' : 'account')}
                  aria-pressed={view === 'account'}
                  aria-label="Account"
                  title="Account"
                >
                  <User className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="default"
                className="chrome-bottom-cluster"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.18, ease: [0.22, 0.61, 0.36, 1] }}
              >
                <button
                  type="button"
                  className="chrome-nav chrome-theme-toggle"
                  onClick={cycleTheme}
                  aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (current: ${theme})`}
                  title={`Theme: ${theme} — tap to switch`}
                >
                  <ThemeIcon className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                </button>
                {filterAvailable && (
                  <button
                    type="button"
                    className={`chrome-nav chrome-filter ${filterPanelOpen || filterCustomized ? 'is-open' : ''}`}
                    onClick={() => togglePanel('filter')}
                    aria-expanded={filterPanelOpen}
                    aria-controls="chrome-filter-sheet"
                    aria-label={filterPanelOpen ? 'Close filters' : 'Open filters'}
                  >
                    <ListFilterPlus className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                )}
                <button
                  type="button"
                  className={`chrome-nav chrome-search-btn ${searchPanelOpen || searchActive ? 'is-open' : ''}`}
                  onClick={() => togglePanel('search')}
                  aria-expanded={searchPanelOpen}
                  aria-controls="chrome-search-sheet"
                  aria-label={searchActive ? `Search (current query: ${params.get('q')})` : 'Open search'}
                >
                  <Search className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className={`chrome-nav chrome-info-btn ${infoPanelOpen ? 'is-open' : ''}`}
                  onClick={() => togglePanel('info')}
                  aria-expanded={infoPanelOpen}
                  aria-controls="chrome-info-sheet"
                  aria-label="About this site"
                >
                  <Info className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                </button>
                {isOwner && (
                  <button
                    type="button"
                    className={`chrome-nav chrome-edit-btn ${editActive ? 'is-open' : ''}`}
                    onClick={() => {
                      // Entering/leaving edit mode owns the bottom chrome —
                      // fold any open search/filter/info panel away first.
                      closePanel();
                      toggleEdit();
                    }}
                    aria-pressed={editActive}
                    aria-label={editActive ? 'Exit edit mode' : 'Enter edit mode'}
                    title={editActive ? 'Exit edit mode' : 'Edit mode'}
                  >
                    <Pencil className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                )}
                {isOwner && editActive && (
                  <button
                    type="button"
                    className="chrome-nav chrome-edit-exit"
                    onClick={exitEdit}
                    aria-label="Close edit mode without saving"
                    title="Close edit mode"
                  >
                    <X className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="chrome-bottom-spacer" aria-hidden="true" />
        {/* Right cluster. The on-demand controls (back, count, home) fade in
            and out inside a popLayout presence; the persistent scroll-jump and
            menu buttons carry `layout` so they slide over to fill the freed
            space rather than jumping when a control comes or goes. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {!onHomePage && (
            <motion.button
              key="back"
              layout={layoutProp}
              type="button"
              className="chrome-nav chrome-back-btn"
              onClick={goBack}
              aria-label="Go back"
              {...controlFade}
            >
              <ArrowLeft className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
            </motion.button>
          )}
          {scrolledPast > 0 && (
            <motion.span
              key="scroll-count"
              layout={layoutProp}
              className="chrome-scroll-count gutter"
              aria-label={`${scrolledPast} items scrolled past`}
              {...controlFade}
            >
              {scrolledPast}
            </motion.span>
          )}
        </AnimatePresence>
        <motion.button
          layout={layoutProp}
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
        </motion.button>
        <AnimatePresence mode="popLayout" initial={false}>
          {!onHomePage && (
            <MotionLink
              key="home"
              layout={layoutProp}
              to="/"
              className="chrome-nav chrome-home-btn"
              aria-label="Go home"
              onClick={() => {
                // Collapse the open menu on the way home so it animates
                // out (via the dock's AnimatePresence exit) instead of
                // being left open over the freshly-loaded home page.
                if (dockOpen) toggleDock();
              }}
              {...controlFade}
            >
              <Home className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
            </MotionLink>
          )}
        </AnimatePresence>
        <motion.button
          layout={layoutProp}
          type="button"
          className={`chrome-nav chrome-nav-bottom ${dockOpen ? 'is-open' : ''}`}
          onClick={toggleDock}
          aria-expanded={dockOpen}
          aria-controls="action-dock-panel"
          aria-label={dockOpen ? 'Close menu' : 'Open menu'}
        >
          <Compass className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
        </motion.button>
      </div>

      {/* Footer strip: the bottom-bar mirror of the top bar's breadcrumb.
          Anchored to the bar's top edge (bottom: 100%) inside a fixed clip
          and revealed with a pure transform + opacity — never a height
          animation — so the page never reflows mid-scroll. Stays mounted the
          whole time (so its height stays measurable) and only slides up into
          view once you reach the last stretch of the page. */}
      <div
        className="chrome-bar-footer-wrap"
        inert={nearBottom ? undefined : ''}
        aria-hidden={nearBottom ? undefined : true}
        style={{ pointerEvents: nearBottom ? 'auto' : 'none' }}
      >
        <motion.div
          ref={footerRef}
          className="chrome-bar-footer"
          initial={false}
          animate={{ y: nearBottom ? '0%' : '100%', opacity: nearBottom ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.32, ease: [0.32, 0.72, 0, 1] }}
        >
          <Footer />
        </motion.div>
      </div>

      <SearchSheet />
      <InfoSheet />
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
 *  the page and folds back up on return. The threshold is a few hundred px
 *  so the crumb only appears once you've deliberately scrolled into the
 *  page, not on the first small nudge away from the top. */
function useScrolledDown(threshold = 220) {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let frame = 0;
    function onScroll() {
      // Coalesce through rAF so the state flip (and the height animation it
      // drives) never runs synchronously inside the scroll event, keeping
      // momentum scrolling smooth as the breadcrumb expands/collapses.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setDown((window.scrollY || 0) > threshold));
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [threshold]);
  return down;
}

/** True once the window is scrolled into the last `fraction` of its
 *  scrollable range (default 5%, i.e. ~95% down). Drives the footer strip:
 *  it slides up out of the bottom chrome as you reach the page's end and
 *  folds back down on the way up — the vertical mirror of the breadcrumb.
 *
 *  A page too short to meaningfully scroll counts as "at the end" so the
 *  footer stays revealed, matching the old always-in-flow footer. Coalesced
 *  through requestAnimationFrame so the state flip (and the transform it
 *  drives) never runs synchronously inside the scroll event. */
function useNearPageBottom(fraction = 0.05) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    let frame = 0;
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = window.innerHeight || 0;
        const full = Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
        );
        const maxScroll = full - viewport;
        if (maxScroll <= 4) {
          setNear(true);
          return;
        }
        const remaining = maxScroll - (window.scrollY || 0);
        setNear(remaining <= maxScroll * fraction);
      });
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [fraction]);
  return near;
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
