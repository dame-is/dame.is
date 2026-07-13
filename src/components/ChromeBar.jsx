import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowUp, Bug, Compass, Home, Info, ListFilterPlus, Pencil, Printer, Search, User, X } from 'lucide-react';
import { useChromeBar } from '../hooks/useChromeBar.jsx';
import { nsidFromAtUri, primaryNsid } from '../lib/verbRegistry.js';
import { skyAvatarUrl } from '../lib/skyAvatars.js';
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

// The home handle is a router <Link>; wrap it so it can participate in the
// bottom bar's presence/layout animation (fade in/out, slide to make room).
const MotionLink = motion.create(Link);

// Feed search is built and wired (SearchSheet + the `?q=` filter), but its
// trigger is temporarily hidden from the bottom chrome. Flip this back to
// `true` to restore the search button — nothing else needs to change.
const SEARCH_ENABLED = false;

export default function ChromeBar() {
  const { expanded, toggle } = useChromeBar();
  const { open: dockOpen, toggle: toggleDock } = useActionDock();
  const reduce = useReducedMotion();
  const location = useLocation();
  // Brand mark: the bundled sky-avatar frame for the current Eastern
  // hour — the same art the live Bluesky avatar cycles through, served
  // locally instead of fetched from the profile, so the mark is always
  // in lockstep with the site's own clock (and with the sky theme's
  // palette). useTheme's hour ticks over hourly; while the bottom-bar
  // time chip is overriding the clock, the mark steps with it.
  const { skyHour } = useTheme();
  const targetAvatar = skyAvatarUrl(skyHour);

  // The mark never paints a half-loaded image: an incoming URL is fetched
  // and decoded off-screen, and only swapped in — on the SAME persistent
  // <img> — once it can paint instantly. So an avatar change (the hourly
  // turnover, or stepping the sky-hour chip) holds the previous frame
  // instead of flashing an empty square while the next one loads. A URL
  // that fails to load is never committed; the old frame just stays.
  const [avatar, setAvatar] = useState(null);
  useEffect(() => {
    if (!targetAvatar) {
      setAvatar(null);
      return undefined;
    }
    let cancelled = false;
    const img = new Image();
    const commit = () => {
      if (!cancelled) setAvatar(targetAvatar);
    };
    // decode() resolves once the bitmap is paint-ready (not merely
    // fetched); onload is the fallback where decode isn't supported.
    // Committing twice is a harmless same-value setState.
    img.onload = commit;
    img.src = targetAvatar;
    if (img.decode) img.decode().then(commit).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targetAvatar]);
  const showAvatar = !!avatar;

  const topRef = useRef(null);
  const crumbRef = useRef(null);

  // Tertiary chrome: a breadcrumb that slides down out of the top bar once
  // the page is scrolled away from its top, orienting you to where you are.
  // On day-grouped feed pages (home included) the strip also carries the
  // date header of the section currently scrolled under the chrome, so it
  // reveals on the home page too once you're past the first day header.
  // It folds back up on the way to the top.
  const crumbs = buildCrumbs(location.pathname);
  const scrolledDown = useScrolledDown();
  const dayLabel = useCurrentDayLabel();
  // Individual (detail) pages — anything two or more segments deep, e.g.
  // /blogging/:slug, /creating/:slug, /curating/:slug, or a generic record —
  // pin the breadcrumb open as their standing back-affordance (it replaces
  // the old per-page "← Section" eyebrow), so the trail is always there and a
  // dual-listed doc keeps whichever feed it was opened from as its parent
  // crumb. Feed/index pages keep the scroll-triggered reveal.
  const isDetailPage = crumbs.length >= 2;
  const showBreadcrumb =
    isDetailPage || (scrolledDown && (crumbs.length > 0 || !!dayLabel));

  // Right edge of the strip: the AT Protocol collection you're looking
  // at. On feed pages it tracks the record at the top of the scroll
  // position. Verb routes (/listening, /blogging, …) fall back to their
  // registry collection — the records the feed is OF — rather than the
  // page's own is.dame.page record; only non-verb pages report their
  // backing record (registered by PageShell).
  const { pageRecord } = useEditMode();
  const feedNsid = useTopFeedNsid();
  const routeVerbNsid = primaryNsid(location.pathname.split('/')[1] || '');
  const stripNsid = feedNsid || routeVerbNsid || nsidFromAtUri(pageRecord?.atUri);

  // Publish the top chrome's live occupied bottom as `--chrome-top-h` on
  // <html> — the y-coordinate where the top chrome ends and the content
  // region begins. It's the breadcrumb strip's bottom when the strip is
  // shown (the strip sits below the header), else the header's own
  // bottom. Consumer: the action-dock sheet (fills from here down to
  // the bottom bar so it fully conceals the page and butts against the
  // whole top chrome).
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
      // On individual pages the breadcrumb is pinned open (not just revealed on
      // scroll), so unlike the feed pages — where it slides over already-
      // scrolled content — it would otherwise hang over the top of the page's
      // own content (the title). Publish its height as `--chrome-crumb-pin-h`
      // so the content column can reserve that much extra top padding; 0 on
      // pages where the strip only rides over on scroll.
      const pinnedH = isDetailPage && crumb ? crumb.getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty(
        '--chrome-crumb-pin-h',
        `${Math.max(0, Math.ceil(pinnedH))}px`,
      );
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
  }, [showBreadcrumb, isDetailPage]);

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
                  {/* No key: the element persists across src swaps so the
                      old frame stays painted right up to the instant the
                      pre-decoded next frame replaces it. */}
                  <img
                    className="chrome-mark-img"
                    src={avatar}
                    alt=""
                    onError={() => setAvatar(null)}
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

        {/* Breadcrumb strip stays mounted on every page (home shows just
            the root crumb plus the current day), and the reveal animates
            ONLY transform + opacity — never height. A height:auto animation
            forces a layout measurement/reflow on the frame it starts, and a
            reflow mid-scroll hands scrolling back to the main thread and
            stalls the momentum. transform/opacity run on the compositor and
            can't interrupt the scroll. The strip slides down from behind
            the bar inside a fixed clip (`overflow: hidden` on the wrap)
            instead of growing the box. */}
        <div
          ref={crumbRef}
          id="chrome-bar-tertiary"
          className="chrome-bar-tertiary-wrap"
          inert={showBreadcrumb ? undefined : ''}
          aria-hidden={showBreadcrumb ? undefined : true}
          style={{ pointerEvents: showBreadcrumb ? 'auto' : 'none' }}
        >
          <motion.div
            className={`chrome-bar-row chrome-bar-tertiary ${isDetailPage ? 'is-detail' : ''}`}
            initial={false}
            animate={{ y: showBreadcrumb ? '0%' : '-100%', opacity: showBreadcrumb ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.32, ease: [0.32, 0.72, 0, 1] }}
          >
            {/* On the home page (no crumbs) the day label stands alone in
                the crumb spot; on sub-pages it follows the trail, all
                left-aligned. */}
            {crumbs.length > 0 && (
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
            )}
            {dayLabel && <span className="chrome-crumb-day">{dayLabel}</span>}
            {stripNsid && <span className="chrome-crumb-nsid">{stripNsid}</span>}
          </motion.div>
        </div>
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
  const { skyHourKey, advanceSkyHour } = useTheme();
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
  // The resume (/for-hire) page exposes a print / save-as-PDF control in the
  // bottom bar's page-level cluster — it replaces the old in-page print button
  // and only shows while a resume is on screen.
  const onResumePage =
    location.pathname === '/for-hire' || location.pathname.startsWith('/for-hire/');

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
                {/* Time switcher. The site always runs the hour-tracking
                    sky theme; this chip shows the hour whose palette is on
                    screen, and each tap advances it one hour (wrapping at
                    midnight) so you can walk the sky through the day by
                    hand. */}
                <button
                  type="button"
                  className="chrome-nav chrome-sky-hour"
                  onClick={advanceSkyHour}
                  aria-label={`Advance the sky one hour (showing ${skyHourKey})`}
                  title={`Time of day — tap to advance the sky one hour (showing ${skyHourKey})`}
                >
                  {skyHourKey}
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
                {SEARCH_ENABLED && (
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
                )}
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
                {onResumePage && (
                  <button
                    type="button"
                    className="chrome-nav chrome-print-btn"
                    onClick={() => window.print()}
                    aria-label="Print or save this resume as PDF"
                    title="Print / save as PDF"
                  >
                    <Printer className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                )}
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
        {/* Right cluster. The on-demand controls (count, back, home) fade in
            and out inside a popLayout presence; the persistent scroll-jump and
            menu buttons carry `layout` so they slide over to fill the freed
            space rather than jumping when a control comes or goes. The
            scrolled-past count sits to the LEFT of the back button so the back
            button always lands directly beside the scroll-jump arrow instead
            of being pushed away by the count. */}
        <AnimatePresence mode="popLayout" initial={false}>
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
/** Text of the day header whose section is currently scrolled under the
 *  top chrome, or null while above the first day header (and on pages
 *  without day-grouped feeds). Reads the DOM directly — day headers carry
 *  stable classes on every feed page (home, listening, posting, logging)
 *  — so no page-side wiring is needed. The headers are re-queried on each
 *  scroll frame; a feed renders at most a few dozen of them, and querying
 *  live keeps freshly-loaded groups ("Load more", background refresh)
 *  accurate without observers. */
function useCurrentDayLabel() {
  const [label, setLabel] = useState(null);
  const location = useLocation();
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      const headers = document.querySelectorAll('.day-section-header .day-header');
      let current = null;
      if (headers.length) {
        // The strip's own reveal grows --chrome-top-h, which nudges this
        // threshold down a touch once shown — harmless hysteresis at the
        // section boundary.
        const chromeBottom =
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--chrome-top-h'),
          ) || 0;
        for (const h of headers) {
          if (h.getBoundingClientRect().top < chromeBottom + 12) current = h;
          else break;
        }
      }
      setLabel(current ? current.textContent : null);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [location.pathname]);
  return label;
}

/** NSID of the record at the top of the scroll position — the first
 *  record entry still (partly) visible below the chrome — or null on
 *  pages without record lists. Same DOM-driven, rAF-throttled sweep as
 *  useCurrentDayLabel above; entries publish their collection via a
 *  `data-nsid` attribute (FeedItem rows, the /creating grid, the
 *  /blogging table of contents). */
function useTopFeedNsid() {
  const [nsid, setNsid] = useState(null);
  const location = useLocation();
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      const chromeBottom =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--chrome-top-h'),
        ) || 0;
      let current = null;
      for (const el of document.querySelectorAll('[data-nsid]')) {
        const rect = el.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > chromeBottom + 12) {
          current = el.dataset.nsid;
          break;
        }
      }
      setNsid(current);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [location.pathname]);
  return nsid;
}

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
