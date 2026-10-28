import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowUp, Compass, Ellipsis, Home, Info, LayoutGrid, ListFilterPlus, Microscope, Pencil, Printer, Search, Type, User, X } from 'lucide-react';
import { useChromeBar } from '../hooks/useChromeBar.jsx';
import { nsidFromAtUri, primaryNsid } from '../lib/verbRegistry.js';
import { skyMarkUrl } from '../lib/skyAvatars.js';
import { buildCrumbs, parentPathFor } from '../lib/breadcrumbs.js';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useXray } from '../hooks/useXray.jsx';
import { useFeedFilter } from '../hooks/useFeedFilter.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import {
  ADMIN_ACTIONS_PANEL,
  ADMIN_ACTIONS_PANEL_ID,
  ADMIN_NAV_PANEL,
  ADMIN_NAV_PANEL_ID,
  useAdminChrome,
} from '../hooks/useAdminChrome.jsx';
import { useTheme } from '../hooks/useTheme.jsx';
import { useFont, FONT_SWITCHER_ENABLED } from '../hooks/useFont.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { COLLECTIONS, ME_DID } from '../config.js';
import NowStatus from './NowStatus.jsx';
import NowPlaying from './NowPlaying.jsx';
import ProfileStats from './ProfileStats.jsx';
import VitalsPanel from './VitalsPanel.jsx';
import DayOfLifeTicker from './DayOfLifeTicker.jsx';
import LayoutToggle from './LayoutToggle.jsx';
import PaperToggle from './PaperToggle.jsx';
import { PAPER_ENABLED } from '../hooks/usePaper.jsx';
import SearchSheet from './SearchSheet.jsx';
import AdminDirectorySheet, {
  ADMIN_DIRECTORY_PANEL,
  ADMIN_DIRECTORY_PANEL_ID,
} from './AdminDirectorySheet.jsx';
import InfoSheet from './InfoSheet.jsx';
import GuestbookSheet from './GuestbookSheet.jsx';
import DebugSheet from './DebugSheet.jsx';
import SkyHourSheet from './SkyHourSheet.jsx';
import Footer from './Footer.jsx';
import './ChromeBar.css';

// The home handle is a router <Link>; wrap it so it can participate in the
// bottom bar's presence/layout animation (fade in/out, slide to make room).
const MotionLink = motion.create(Link);

// Feed search is built and wired (SearchSheet + the `?q=` filter), but its
// trigger is temporarily hidden from the bottom chrome. Flip this back to
// `true` to restore the search button — nothing else needs to change.
const SEARCH_ENABLED = false;

// How long the top chrome's size has to hold still before `--chrome-top-h`
// is republished after a resize (see the effect that publishes it).
const SIZE_SETTLE_MS = 120;

// An element's viewport bottom without its own translateY. The breadcrumb
// strip rides the expanded tier's slide on a transform, and the published
// chrome height should be where the strip settles, not where it is mid-slide.
function settledBottom(node) {
  const bottom = node.getBoundingClientRect().bottom;
  const transform = getComputedStyle(node).transform;
  if (!transform || transform === 'none') return bottom;
  return bottom - new DOMMatrixReadOnly(transform).m42;
}

export default function ChromeBar() {
  const { expanded, toggle } = useChromeBar();
  const { open: dockOpen, toggle: toggleDock } = useActionDock();
  const reduce = useReducedMotion();
  const primaryRef = useRef(null);
  const tierWrapRef = useRef(null);
  const tierInnerRef = useRef(null);
  const tierMode = useTierSlide({
    expanded,
    reduce,
    primaryRef,
    wrapRef: tierWrapRef,
    innerRef: tierInnerRef,
    // Everything below the tier rides along with its edge: the page and the
    // breadcrumb strip. (Called from an effect, after crumbRef exists.)
    followers: () => [document.getElementById('main-content'), crumbRef.current],
  });
  const tierSliding = tierMode === 'opening' || tierMode === 'closing';
  const location = useLocation();
  // Brand mark: the bundled sky-avatar frame for the current Eastern
  // hour — the same art the live Bluesky avatar cycles through, served
  // locally instead of fetched from the profile, so the mark is always
  // in lockstep with the site's own clock (and with the sky theme's
  // palette). useTheme's hour ticks over hourly; while the bottom-bar
  // time chip is overriding the clock, the mark steps with it; and while
  // the admin SkyThemeStudio is previewing an hour, the mark follows
  // that too (via skyDisplayHour) so it matches the palette being tuned.
  // `showSkyMark` is the owner's switch for the mark (is.dame.sky/self →
  // `showMark`, flipped in the admin Sky theme studio). Off, the site name
  // stands alone in the top chrome.
  const { skyDisplayHour, showSkyMark } = useTheme();
  // The small copy of the frame (skyMarkUrl): the mark is about 23px, and the
  // full frame is ~360 KB.
  const targetAvatar = showSkyMark ? skyMarkUrl(skyDisplayHour) : null;

  // The mark never paints a half-loaded image: an incoming URL is fetched
  // and decoded off-screen, and only swapped in — on the SAME persistent
  // <img> — once it can paint instantly. So an avatar change (the hourly
  // turnover, or stepping the sky-hour chip) holds the previous frame
  // instead of flashing an empty square while the next one loads. A URL
  // that fails to load is never committed; the old frame just stays.
  //
  // The mark's box is drawn from the first paint, empty until the first frame
  // decodes, so the site name beside it never moves. Only a frame that fails
  // with nothing before it to hold takes the box away.
  const [avatar, setAvatar] = useState(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => {
    if (!targetAvatar) {
      setAvatar(null);
      return undefined;
    }
    let cancelled = false;
    const img = new Image();
    const commit = () => {
      if (cancelled) return;
      setAvatar(targetAvatar);
      setAvatarFailed(false);
    };
    // decode() resolves once the bitmap is paint-ready (not merely
    // fetched); onload is the fallback where decode isn't supported.
    // Committing twice is a harmless same-value setState.
    img.onload = commit;
    img.onerror = () => {
      if (!cancelled) setAvatarFailed(true);
    };
    img.src = targetAvatar;
    if (img.decode) img.decode().then(commit).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targetAvatar]);
  const showMarkBox = !!targetAvatar && (!!avatar || !avatarFailed);

  const topRef = useRef(null);
  const crumbRef = useRef(null);
  const breadcrumbRef = useRef(null);
  const nsidRef = useRef(null);

  // Tertiary chrome: a breadcrumb that slides down out of the top bar once
  // the page is scrolled away from its top, orienting you to where you are.
  // On day-grouped feed pages (home included) the strip also carries the
  // date header of the section currently scrolled under the chrome, so it
  // reveals on the home page too once you're past the first day header.
  // It folds back up on the way to the top.
  const crumbs = buildCrumbs(location.pathname);
  const scrolledDown = useScrolledDown();
  // The path whose page is actually on screen, which for the length of the
  // route transition's exit fade is still the one being left. The sweeps
  // below read the page's DOM, so they follow this rather than the URL; see
  // useMountedPathname.
  const pinDetailRef = useRef(crumbs.length >= 2);
  const applyChromeSizeRef = useRef(null);
  const mountedPath = useMountedPathname((path) => {
    pinDetailRef.current = buildCrumbs(path).length >= 2;
    applyChromeSizeRef.current?.();
  });
  const dayLabel = useCurrentDayLabel(mountedPath);
  // Individual (detail) pages — anything two or more segments deep, e.g.
  // /blogging/:slug, /creating/:slug, /curating/:slug, or a generic record —
  // pin the breadcrumb open as their standing back-affordance (it replaces
  // the old per-page "← Section" eyebrow), so the trail is always there and a
  // dual-listed doc keeps whichever feed it was opened from as its parent
  // crumb. Feed/index pages keep the scroll-triggered reveal.
  const isDetailPage = crumbs.length >= 2;
  const showBreadcrumb =
    isDetailPage || (scrolledDown && (crumbs.length > 0 || !!dayLabel));
  // On detail pages the trail and its record NSID share one row when they fit
  // and the NSID drops to its own line beneath the trail when they don't (see
  // the `.is-detail` wrap rules in ChromeBar.css). Tracked here so the strip
  // can echo the mobile LISTENING TO / FOLLOWED BY stack — a dashed divider
  // with matching spacing between the rows — but ONLY once the NSID has truly
  // fallen to its own line, never while it rides the trail's line. Measured
  // just below.
  const [nsidWrapped, setNsidWrapped] = useState(false);

  // Right edge of the strip: the AT Protocol collection you're looking
  // at. On feed pages it tracks the record at the top of the scroll
  // position.
  //
  // Otherwise the page's own record (registered by PageShell) answers, and the
  // verb registry only overrides it on a verb index — where that record is the
  // is.dame.page holding the page's own copy rather than the records the feed
  // is OF. A non-verb page keeps reporting is.dame.page, which is the truth
  // there.
  //
  // The registry used to win on every verb route, which mislabelled record
  // pages: /creating serves both the legacy is.dame.creating.work and
  // site.standard.document, and the registry names only the first, so every
  // standard doc was captioned with a lexicon it isn't.
  const { pageRecord } = useEditMode();
  const feedNsid = useTopFeedNsid(mountedPath);
  const routeVerbNsid = primaryNsid(location.pathname.split('/')[1] || '');
  // Only this page's own record: the last page's lingers until this one
  // registers (the same guard ChromeBarBottom's edit button uses).
  const pageRecordNsid =
    pageRecord?.path === location.pathname
      ? nsidFromAtUri(pageRecord.atUri)
      : null;
  const stripNsid =
    feedNsid ||
    (pageRecordNsid && pageRecordNsid !== COLLECTIONS.page ? pageRecordNsid : routeVerbNsid) ||
    pageRecordNsid;

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
  // showBreadcrumb change, scroll (the strip reveals on scroll and the iOS
  // URL bar resizes there), rAF-throttled, and on size changes once they
  // settle (see below).
  //
  // Both values are custom properties on <html>, and changing one restyles
  // every element on the page whether anything reads it or not. So they're
  // only written when they actually change.
  //
  // A layout effect, so a hard load of a detail page lays out with the pinned
  // strip's room already reserved; from a passive effect the first frame could
  // paint with the title under the strip and then jump 38px (71 on a phone).
  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el) return undefined;
    const rootStyle = document.documentElement.style;
    const publish = (name, value) => {
      if (rootStyle.getPropertyValue(name) !== value) rootStyle.setProperty(name, value);
    };
    const apply = () => {
      const crumb = crumbRef.current;
      const bottom =
        showBreadcrumb && crumb
          ? settledBottom(crumb)
          : el.getBoundingClientRect().bottom;
      publish('--chrome-top-h', `${Math.max(0, Math.floor(bottom))}px`);
      // On individual pages the breadcrumb is pinned open (not just revealed on
      // scroll), so unlike the feed pages — where it slides over already-
      // scrolled content — it would otherwise hang over the top of the page's
      // own content (the title). Publish its height as `--chrome-crumb-pin-h`
      // so the content column can reserve that much extra top padding; 0 on
      // pages where the strip only rides over on scroll.
      //
      // Keyed to the page that's mounted (pinDetailRef), not to the URL: the
      // padding is on `.main`, which also holds the page being faded out, and
      // switching it at the click shoved that page down by the strip's height
      // as it left. useMountedPathname calls back in here the moment the
      // incoming page is in the DOM, before it paints.
      const pinnedH =
        pinDetailRef.current && crumb
          ? crumb.getBoundingClientRect().height
          : 0;
      publish('--chrome-crumb-pin-h', `${Math.max(0, Math.ceil(pinnedH))}px`);
    };
    applyChromeSizeRef.current = apply;
    apply();
    let raf = 0;
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(); });
    };
    // Size changes wait until the header stops resizing. Opening or closing
    // the atmosphere row animates the header's height for ~360ms, and
    // publishing every frame of that restyled the whole page each frame
    // (~2,900 elements on the home feed): the stutter on expand/collapse.
    // The sheets reading these only need where the chrome ends up.
    let settle = 0;
    const scheduleSettled = () => {
      clearTimeout(settle);
      settle = setTimeout(apply, SIZE_SETTLE_MS);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleSettled) : null;
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
      clearTimeout(settle);
      if (applyChromeSizeRef.current === apply) {
        applyChromeSizeRef.current = null;
      }
    };
  }, [showBreadcrumb, isDetailPage]);

  // Detect whether the detail-page NSID has wrapped onto its own line beneath
  // the trail (vs. riding the trail's line), so the wrapped strip can pick up
  // the same dashed divider + tightened spacing as the LISTENING TO / FOLLOWED
  // BY stack. CSS can't select on flex-wrap, so we read it: the NSID is on its
  // own line once its top edge sits at/below the trail's vertical midpoint (on
  // a shared, center-aligned line the two boxes straddle the same midline).
  // Critically, the wrapped divider is drawn as the TRAIL's border-bottom (it
  // spans the full column, since the trail grows to fill the row once alone on
  // its line) — nothing here forces the wrap, so this stays a faithful read of
  // the natural layout and flips back when the trail + NSID fit again.
  useEffect(() => {
    if (!isDetailPage) {
      setNsidWrapped(false);
      return undefined;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const trail = breadcrumbRef.current;
      const nsid = nsidRef.current;
      if (!trail || !nsid) {
        setNsidWrapped(false);
        return;
      }
      const t = trail.getBoundingClientRect();
      const n = nsid.getBoundingClientRect();
      setNsidWrapped(n.top >= (t.top + t.bottom) / 2);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    schedule();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (ro) {
      if (breadcrumbRef.current) ro.observe(breadcrumbRef.current);
      if (nsidRef.current) ro.observe(nsidRef.current);
    }
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [isDetailPage, stripNsid, location.pathname]);

  return (
    <>
      <header
        ref={topRef}
        className={`chrome-bar chrome-bar-top ${expanded ? 'is-expanded' : 'is-collapsed'}`}
        role="banner"
      >
        <div ref={primaryRef} className="chrome-bar-row chrome-bar-primary">
          <div className="chrome-cluster">
            <Link to="/" className="chrome-title">
              {showMarkBox && (
                <span className="chrome-mark chrome-mark-avatar" aria-hidden="true">
                  {/* No key: the element persists across src swaps so the
                      old frame stays painted right up to the instant the
                      pre-decoded next frame replaces it. */}
                  {avatar && (
                    <img
                      className="chrome-mark-img"
                      src={avatar}
                      alt=""
                      onError={() => {
                        setAvatar(null);
                        setAvatarFailed(true);
                      }}
                    />
                  )}
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
            {/* Rotation is a CSS transition keyed to the header's
                is-expanded class, so it runs on the compositor. */}
            <svg className="chrome-expand-glyph" aria-hidden="true" viewBox="0 0 12 12">
              <path
                d="M2.5 4.5 L6 8 L9.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* The expanded tier. It opens and closes with compositor-only
            animations (see useTierSlide): while sliding it rides over the
            page as an overlay pinned under the primary row, and only joins
            the header's flow once it's fully open. */}
        {tierMode !== 'closed' && (
          <div
            ref={tierWrapRef}
            id="chrome-bar-secondary"
            className={`chrome-bar-secondary-wrap${tierSliding ? ' is-sliding' : ''}`}
            inert={tierMode === 'closing' ? '' : undefined}
            aria-hidden={tierMode === 'closing' ? true : undefined}
          >
            <div ref={tierInnerRef} className="chrome-bar-secondary-inner">
              <div className="chrome-bar-row chrome-bar-secondary">
                <div className="chrome-signals chrome-signals-secondary">
                  <NowPlaying />
                  <ProfileStats />
                  {/* Day of life joins the LISTENING TO / FOLLOWED BY stack —
                      but only on mobile. On desktop it lives at the right edge
                      of the vitals bar below instead; this copy is hidden there
                      via CSS (and the vitals-bar copy is hidden on mobile). */}
                  <DayOfLifeTicker />
                </div>
              </div>
              {/* Second expanded tier: the iPhone state / vitals bar. It
                  reveals together with the LISTENING TO / FOLLOWED BY row
                  above; its own top hairline and deep surface make it read as
                  a distinct bar rather than a wrapped continuation of that
                  row. */}
              <div className="chrome-bar-row chrome-bar-state">
                <div className="chrome-signals chrome-signals-state">
                  <VitalsPanel />
                </div>
              </div>
            </div>
          </div>
        )}

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
            className={`chrome-bar-row chrome-bar-tertiary ${isDetailPage ? 'is-detail' : ''} ${nsidWrapped ? 'is-nsid-wrapped' : ''}`}
            initial={false}
            animate={{ y: showBreadcrumb ? '0%' : '-100%', opacity: showBreadcrumb ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.32, ease: [0.32, 0.72, 0, 1] }}
          >
            {/* On the home page (no crumbs) the day label stands alone in
                the crumb spot; on sub-pages it follows the trail, all
                left-aligned. */}
            {crumbs.length > 0 && (
              <nav className="chrome-breadcrumb" aria-label="Breadcrumb" ref={breadcrumbRef}>
                <ol className="chrome-crumbs">
                  <li className="chrome-crumb">
                    <Link to="/" className="chrome-crumb-link chrome-crumb-root" aria-label="Home">
                      /
                    </Link>
                  </li>
                  {crumbs.map((c, i) => {
                    const last = i === crumbs.length - 1;
                    return (
                      <li key={c.path} className="chrome-crumb">
                        {i > 0 && (
                          <span className="chrome-crumb-sep" aria-hidden="true">
                            /
                          </span>
                        )}
                        {last ? (
                          <span className="chrome-crumb-current" aria-current="page">
                            {c.label}
                          </span>
                        ) : c.to ? (
                          <Link to={c.to} className="chrome-crumb-link">
                            {c.label}
                          </Link>
                        ) : (
                          // A segment no page answers (see breadcrumbs.js):
                          // still part of where you are, just not somewhere to go.
                          <span className="chrome-crumb-text">{c.label}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            )}
            {dayLabel && <span className="chrome-crumb-day">{dayLabel}</span>}
            {stripNsid && (
              <span className="chrome-crumb-nsid" ref={nsidRef}>
                {stripNsid}
              </span>
            )}
          </motion.div>
        </div>
      </header>

      <ChromeBarBottom
        dockOpen={dockOpen}
        toggleDock={toggleDock}
        mountedPath={mountedPath}
      />
    </>
  );
}

// Memoised: ChromeBar re-renders as the page scrolls (the breadcrumb's day
// label and record NSID track the scroll), and none of that reaches down here.
const ChromeBarBottom = memo(function ChromeBarBottom({
  dockOpen,
  toggleDock,
  mountedPath,
}) {
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
  const skyPanelOpen = panel === 'sky';
  const reduce = useReducedMotion();
  const atTop = useAtTopOfPage();
  const { digits: scrolledPastDigits, store: scrolledPastStore } =
    useScrolledPastFeedItems(mountedPath);
  // The footer rides the bottom chrome the way the breadcrumb rides the top:
  // it slides up out of the bar once you reach the last stretch of the page.
  // `short` is a page with nothing to scroll, settled as such.
  const { near: nearBottom, short: pageTooShort } = useNearPageBottom();
  const footerRef = useRef(null);
  const { available: filterAvailable } = useFeedFilter();
  const { skyHourKey, advanceSkyHour } = useTheme();
  const { serifOnly, toggle: toggleFont } = useFont();
  // The edit-mode toggle only exists for the site owner. It sits beside the
  // Info button and flips the site into a selectable "edit mode" (see
  // EditModeBar + useEditMode).
  const { did } = useAtprotoSession();
  const {
    active: editActive,
    toggle: toggleEdit,
    exit: exitEdit,
    pageRecord,
    selectionPage,
    editSheet,
    openEditSheet,
    closeEditSheet,
  } = useEditMode();
  const { active: xrayActive, toggle: toggleXray, exit: exitXray } = useXray();
  const isOwner = did === ME_DID;
  // The owner's edit record for THIS page, if any — guarded on the stamped path
  // so a stale value can't leak across a route change, and on the owner's repo
  // (only those are editable). Home has no such record, so it stays null.
  const pageEditUri =
    pageRecord &&
    pageRecord.path === location.pathname &&
    String(pageRecord.atUri).startsWith(`at://${ME_DID}/`)
      ? pageRecord.atUri
      : null;
  // The pencil reads as "open" both in select/moderation mode and while a
  // page editor it opened directly is showing.
  const chromeEditOpen = editActive || !!editSheet;
  // Trigger buttons highlight when the corresponding URL state is
  // populated — search has a `?q=`, filter has a custom set: verbs on home,
  // post types on /posting, kinds of work on /creating.
  const searchActive = !!params.get('q');
  const filterCustomized = FILTER_PARAMS.some((k) => params.has(k));
  const onHomePage = location.pathname === '/';
  // The admin SkyThemeStudio has its own hour bar for tuning; the chip keeps
  // its tap-to-advance behavior there instead of opening the SkyHourSheet.
  const inSkyStudio = location.pathname === '/admin' && params.get('view') === 'sky';
  // The admin workbench owns its own editing surface: Save / Delete ride on the
  // pane's status strip, and there is no public record markup to inspect. Two of
  // the bottom bar's buttons are therefore withheld there — see their call sites.
  const inAdmin = location.pathname === '/admin';
  // …and below the stacked breakpoint, where the admin stops drawing furniture
  // of its own, this bar grows admin controls instead: the state/actions pair
  // in the left cluster here, plus the owner's standing admin button by the
  // compass. Everything drawn from them is a plain string or a plain function
  // published upward through AdminChromeProvider: no admin module is imported
  // here, and none may be — the admin transitively pulls in @atproto/api,
  // which App.jsx keeps out of the eager bundle with a `lazy()` for every
  // visitor who is not the owner. The panels the admin pair opens are rendered
  // by the admin itself (AdminChromePanels.jsx), for the same reason; the
  // standing button's off-admin panel is AdminDirectorySheet, whose body is
  // its own lazy chunk under the same rule.
  const { surface: adminSurface, actions: adminActions, state: adminState } = useAdminChrome();
  const adminNavOpen = panel === ADMIN_NAV_PANEL;
  const adminActionsOpen = panel === ADMIN_ACTIONS_PANEL;
  const adminDirectoryOpen = panel === ADMIN_DIRECTORY_PANEL;
  const adminPrimary = adminActions?.primary || null;
  // The state button is the way to everything the bar has no room for — the full
  // sentence, the way out of a record or a selection, and the ⋯ menu — so it is
  // drawn whenever there is either. A dot alone is a legitimate reason to draw
  // it: "there is unsaved work here" is the one thing the owner must be able to
  // see without opening anything.
  const showAdminState = !!adminSurface && (!!adminState || (adminActions?.more || 0) > 0);
  // The resume (/available) page exposes a print / save-as-PDF control in the
  // bottom bar's page-level cluster — it replaces the old in-page print button
  // and only shows while a resume is on screen.
  const onResumePage =
    location.pathname === '/available' || location.pathname.startsWith('/available/');

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
  // parent: the nearest section that's a page, else home.
  const parentPath = parentPathFor(buildCrumbs(location.pathname));

  function goBack() {
    // Prefer real history so the back button mirrors the browser's, but only
    // history made on this site. `history.length` counts the whole tab, so a
    // visitor who followed a link here from a search result or from Bluesky
    // has a length of 2 or more, and walking back sent them off the site.
    // The router numbers its own entries in `history.state.idx`, from 0 on
    // the entry the visitor landed on; past 0 there's an in-app step to take.
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
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
  // The scroll-jump arrow on a page with nothing to scroll did nothing when
  // pressed, which the /admin rule below calls worse than absent.
  const showScrollJump = !inAdmin && !pageTooShort;
  // What can move the right cluster's buttons: one of its controls coming or
  // going, or the count gaining a digit. Motion measures a `layout` element on
  // every render unless told what its layout depends on, and this bar renders
  // whenever the page scrolls past a feed item.
  const layoutDependency = [
    onHomePage,
    scrolledPastDigits,
    showScrollJump,
    dockOpen,
    isOwner,
  ].join('|');

  return (
    // `layoutScroll layoutRoot` — the bar is `position: fixed`, and its right-
    // cluster buttons carry `layout` (so they slide over when back/home/count/
    // account enter or exit). Motion measures layout in document coordinates and
    // corrects for page scroll; for a fixed element that correction is spurious,
    // so any re-render that coincides with a scroll-position change animates the
    // buttons by the scroll delta. Toggling inspect (x-ray) collapses/expands the
    // page enough that the browser clamps window.scrollY, which is exactly such a
    // change — the buttons would jump vertically for no reason. Marking the fixed
    // bar as a layout root makes its children resolve relative to the bar (not the
    // scrolling document), so only genuine layout shifts inside the bar animate.
    <motion.div
      className="chrome-bar chrome-bar-bottom"
      role="toolbar"
      aria-label="Global actions"
      layoutScroll
      layoutRoot
    >
      <div className="chrome-bottom-row">
        {/* Left cluster. While the nav dock is open, the page-level controls
            (theme / filter / search / info / inspect) hand off to the dock's
            density tools (layout) — they cross-fade in and temporarily take the
            same spot, then swap back when the dock closes. (Account lives in the
            right cluster now; the atmosphere-debug readout is its own sheet,
            reached from the inspect HUD.) */}
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
                    screen. Outside the admin SkyThemeStudio, tapping it
                    opens the SkyHourSheet — a 24-cell arc that expands up
                    out of the bottom chrome so any visitor can sample the
                    palette at any hour. Inside the studio, each tap
                    advances one hour (the studio has its own arc for
                    jumping). */}
                <button
                  type="button"
                  className={`chrome-nav chrome-sky-hour ${skyPanelOpen ? 'is-open' : ''}`}
                  onClick={inSkyStudio ? advanceSkyHour : () => togglePanel('sky')}
                  aria-expanded={inSkyStudio ? undefined : skyPanelOpen}
                  aria-controls={inSkyStudio ? undefined : 'chrome-sky-sheet'}
                  aria-label={`Time of day — showing ${skyHourKey}`}
                  title={`Time of day — tap to ${inSkyStudio ? 'advance the sky one hour' : 'pick an hour'} (showing ${skyHourKey})`}
                >
                  {skyHourKey}
                </button>
                {/* Font switcher. Hidden for now — the site runs serif-only
                    (see FONT_SWITCHER_ENABLED in useFont.jsx). Flip that flag
                    back on to restore this toggle between serif-only and the
                    mono-accented mix. */}
                {FONT_SWITCHER_ENABLED && (
                  <button
                    type="button"
                    className={`chrome-nav chrome-font-toggle ${serifOnly ? 'is-open' : ''}`}
                    onClick={toggleFont}
                    aria-pressed={serifOnly}
                    aria-label={serifOnly ? 'Use the default serif + monospace type' : 'Use serif-only type'}
                    title={serifOnly ? 'Serif-only type — tap to restore mono accents' : 'Mono accents — tap for serif-only type'}
                  >
                    <Type className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                )}
                {filterAvailable && (
                  <button
                    type="button"
                    className={`chrome-nav chrome-filter ${filterPanelOpen || filterCustomized ? 'is-open' : ''}`}
                    onClick={() => togglePanel('filter')}
                    aria-expanded={filterPanelOpen}
                    aria-controls="chrome-filter-sheet"
                    aria-label={
                      filterPanelOpen
                        ? 'Close filters'
                        : filterCustomized
                          ? 'Open filters (filtered)'
                          : 'Open filters'
                    }
                  >
                    <ListFilterPlus className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                )}
                {/* Shown while a query is active even with search switched
                    off: a `?q=` link still filters the page behind it, and
                    this is the one control that says so and can clear it. */}
                {(SEARCH_ENABLED || searchActive) && (
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
                {/* Withheld on /admin, and this one is about ROOM rather than
                    about sense. The bar carries the admin's controls there, and
                    at 320 the row would run past the compass — which is to say
                    the menu button falls off the screen. This is the primer for
                    a visitor arriving at the site ("what is this place"), the
                    one control in the cluster whose audience is definitionally
                    not the person signed into the admin, so it is the one that
                    gives its 36px up. */}
                {!inAdmin && (
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
                )}
                {/* The admin's surface-level pair: what is happening, what do
                    I do. (The third — where am I / go anywhere — moved to the
                    right cluster as the owner's standing admin button, beside
                    the compass; see below.) */}
                {showAdminState && (
                  <button
                    type="button"
                    className={`chrome-nav chrome-admin-state ${adminActionsOpen ? 'is-open' : ''}`}
                    data-dirty={adminState?.dirty ? '' : undefined}
                    data-error={adminState?.error ? '' : undefined}
                    onClick={() => togglePanel(ADMIN_ACTIONS_PANEL)}
                    aria-expanded={adminActionsOpen}
                    aria-controls={ADMIN_ACTIONS_PANEL_ID}
                    aria-label={
                      adminState ? `${adminState.message} — more actions` : 'More admin actions'
                    }
                    title={adminState?.message || 'More actions'}
                  >
                    {/* `⋯`, which is what this button opens: the record's raw
                        JSON, its at-uri, the way out, Delete — plus whatever
                        the surface has said about itself. It was a bare square
                        for a while, the status strip's own dirty mark scaled to
                        the chip, and that was a mistake in two directions: with
                        nothing unsaved the square is `--rule` and reads as a
                        button somebody forgot to put a glyph in, and it named
                        the one thing this button reports rather than the many
                        things it does. The dirty state is still here — it moved
                        into the glyph's own colour (ChromeBar.css), which is how
                        every other control in this bar carries a state. */}
                    <Ellipsis className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                )}
                {adminPrimary && (
                  // One tap, no sheet in the way: Save, Create, New, Refresh.
                  // Any confirm question the action carries is already inside
                  // `run`, so this button never has to know an action can refuse.
                  <button
                    type="button"
                    className="chrome-nav chrome-admin-action"
                    data-tone={adminPrimary.danger ? 'danger' : 'primary'}
                    disabled={adminPrimary.disabled}
                    aria-busy={adminPrimary.busy ? 'true' : undefined}
                    onClick={adminPrimary.run}
                  >
                    {adminPrimary.label}
                  </button>
                )}
                {/* Atmosphere inspect — the marquee "turn the page inside out"
                    mode. Toggling it reveals the AT Protocol records beneath
                    the page; entering it folds away any open panel and the
                    owner's edit mode (they compete for the same surface).
                    Withheld on /admin: x-ray annotates public record markup and
                    the workbench has none. */}
                {!inAdmin && (
                  <button
                    type="button"
                    className={`chrome-nav chrome-xray ${xrayActive ? 'is-open' : ''}`}
                    onClick={() => {
                      closePanel();
                      if (editActive) exitEdit();
                      toggleXray();
                    }}
                    aria-pressed={xrayActive}
                    aria-label={xrayActive ? 'Stop inspecting' : 'Inspect this page'}
                    title="Inspect — reveal the records under the page"
                  >
                    <Microscope className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                )}
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
                {/* Withheld on /admin: the shell's PageShell registers no
                    atUri and no selection page, so every branch below would
                    fall through to toggleEdit() and open an empty "Tap items to
                    select" bar over the workbench. The X below is gated on
                    `chromeEditOpen` alone, so nobody can be trapped in edit mode
                    by this guard. */}
                {isOwner && !inAdmin && (
                  <button
                    type="button"
                    className={`chrome-nav chrome-edit-btn ${chromeEditOpen ? 'is-open' : ''}`}
                    onClick={() => {
                      // Entering/leaving edit mode owns the bottom chrome —
                      // fold any open search/filter/info panel away first, and
                      // leave x-ray (the two modes compete for the same rows).
                      closePanel();
                      // Edit mode and x-ray compete for the same rows — leave
                      // x-ray before entering any edit flow.
                      if (xrayActive) exitXray();
                      if (editActive) {
                        // In select / moderation mode → leave it.
                        toggleEdit();
                      } else if (editSheet) {
                        // A page editor the pencil opened is showing → close it.
                        closeEditSheet();
                      } else if (pageEditUri && !selectionPage) {
                        // Nothing to select on this page, but it has its own
                        // editable record — jump straight into its page editor
                        // instead of an empty "tap items to select" bar.
                        openEditSheet(pageEditUri);
                      } else {
                        // Feeds / guestbook (or a page with no record): the
                        // usual selectable edit mode.
                        toggleEdit();
                      }
                    }}
                    aria-pressed={chromeEditOpen}
                    aria-label={chromeEditOpen ? 'Exit edit mode' : 'Enter edit mode'}
                    title={chromeEditOpen ? 'Exit edit mode' : 'Edit mode'}
                  >
                    <Pencil className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                  </button>
                )}
                {isOwner && chromeEditOpen && (
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
          {scrolledPastDigits > 0 && (
            <motion.span
              key="scroll-count"
              layout={layoutProp}
              layoutDependency={layoutDependency}
              className="chrome-scroll-count gutter"
              {...controlFade}
            >
              <ScrollCount store={scrolledPastStore} />
            </motion.span>
          )}
          {!onHomePage && (
            <motion.button
              key="back"
              layout={layoutProp}
              layoutDependency={layoutDependency}
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
        {/* Withheld on /admin because it is INERT there, not merely unwanted:
            the workbench is a fixed frame over an `overflow: hidden` document,
            and each of its panes is its own scrollport. `window.scrollTo` has
            nothing to move. A button that does nothing when pressed is worse
            than an absent one, and its 36px is exactly what the admin's own
            three controls need at 320. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {showScrollJump && (
            <motion.button
              key="scroll-jump"
              layout={layoutProp}
              layoutDependency={layoutDependency}
              type="button"
              className="chrome-nav chrome-scroll-jump"
              onClick={atTop ? scrollToBottom : scrollToTop}
              aria-label={atTop ? 'Scroll to bottom' : 'Scroll to top'}
              {...controlFade}
            >
              {atTop ? (
                <ArrowDown
                  className="chrome-nav-glyph"
                  aria-hidden="true"
                  strokeWidth={1.75}
                />
              ) : (
                <ArrowUp
                  className="chrome-nav-glyph"
                  aria-hidden="true"
                  strokeWidth={1.75}
                />
              )}
            </motion.button>
          )}
        </AnimatePresence>
        <AnimatePresence mode="popLayout" initial={false}>
          {!onHomePage && (
            <MotionLink
              key="home"
              layout={layoutProp}
              layoutDependency={layoutDependency}
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
        {/* Account tool. It rides the RIGHT cluster (beside the menu button it
            belongs with) rather than the left tool group, fading in only while
            the nav dock is open and swapping the open sheet between its menu
            and account views. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {dockOpen && (
            <motion.button
              key="account"
              layout={layoutProp}
              layoutDependency={layoutDependency}
              type="button"
              className={`chrome-nav chrome-tool-account ${view === 'account' ? 'is-open' : ''}`}
              onClick={() => setView(view === 'account' ? 'menu' : 'account')}
              aria-pressed={view === 'account'}
              aria-label="Account"
              title="Account"
              {...controlFade}
            >
              <User className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
            </motion.button>
          )}
        </AnimatePresence>
        {/* The owner's standing way into the admin, from anywhere: a fixed
            seat directly left of the compass, drawn only for the signed-in
            owner. On the stacked admin it opens the shell's own Surfaces
            panel (counts, recents, the escape hatch); on every other route it
            opens the lazy links-only directory (AdminDirectorySheet), because
            no admin shell exists there to draw the full one. One glyph, one
            seat, two panels — whichever one the ground under it can serve.
            (On the desk-width admin this bar isn't rendered at all; the rail
            is that frame's directory.) */}
        {isOwner && (
          <motion.button
            layout={layoutProp}
            layoutDependency={layoutDependency}
            type="button"
            className={`chrome-nav chrome-admin-nav ${adminNavOpen || adminDirectoryOpen ? 'is-open' : ''}`}
            onClick={() => togglePanel(adminSurface ? ADMIN_NAV_PANEL : ADMIN_DIRECTORY_PANEL)}
            aria-expanded={adminNavOpen || adminDirectoryOpen}
            aria-controls={adminSurface ? ADMIN_NAV_PANEL_ID : ADMIN_DIRECTORY_PANEL_ID}
            aria-label={
              adminSurface ? `${adminSurface.label} — change admin surface` : 'Admin — open the surface directory'
            }
            title={adminSurface ? `${adminSurface.label} — change surface` : 'Admin'}
          >
            <LayoutGrid className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
          </motion.button>
        )}
        <motion.button
          layout={layoutProp}
          layoutDependency={layoutDependency}
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
      <GuestbookSheet />
      <DebugSheet />
      <SkyHourSheet />
      {/* Owner-gated on the same test as its trigger, so a visitor's page
          renders neither the button nor the (lazy) panel machinery. */}
      {isOwner && <AdminDirectorySheet />}
    </motion.div>
  );
});

// The URL params a page's filter sheet writes (Home, Posting, Creating): any of
// them present means the list on screen is filtered.
const FILTER_PARAMS = ['verbs', 'postTypes', 'kinds'];

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
function useCurrentDayLabel(mountedPath) {
  const [label, setLabel] = useState(null);
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      const headers = document.querySelectorAll('.day-section-header .day-header');
      let current = null;
      if (headers.length) {
        // The strip's own reveal grows --chrome-top-h, which nudges this
        // threshold down a touch once shown — harmless hysteresis at the
        // section boundary.
        const chromeBottom = chromeTopPx();
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
    window.addEventListener(ROUTE_SETTLED, schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener(ROUTE_SETTLED, schedule);
    };
  }, [mountedPath]);
  return label;
}

/** NSID of the record at the top of the scroll position — the first
 *  record entry still (partly) visible below the chrome — or null on
 *  pages without record lists. Same DOM-driven, rAF-throttled sweep as
 *  useCurrentDayLabel above; entries publish their collection via a
 *  `data-nsid` attribute (FeedItem rows, the /creating grid, the
 *  /blogging table of contents).
 *
 *  "Visible" means on screen, not merely below the chrome: a record page's
 *  first `data-nsid` is often a comment far down the page, and it used to
 *  caption the post at the top with the comment's lexicon. When the first
 *  candidate is past the fold, nothing on screen is a listed record, and the
 *  strip falls back to the page's own. */
function useTopFeedNsid(mountedPath) {
  const [nsid, setNsid] = useState(null);
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      const chromeBottom = chromeTopPx();
      let current = null;
      for (const el of document.querySelectorAll('[data-nsid]')) {
        const rect = el.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > chromeBottom + 12) {
          if (rect.top < window.innerHeight) current = el.dataset.nsid;
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
    window.addEventListener(ROUTE_SETTLED, schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener(ROUTE_SETTLED, schedule);
    };
  }, [mountedPath]);
  return nsid;
}

/** The top chrome's bottom edge, as ChromeBar last published it. Read off
 *  <html>'s inline style, where it's written, rather than through
 *  getComputedStyle: the sweeps run every scroll frame, and a computed-style
 *  read there is a style recalc every frame. */
function chromeTopPx() {
  const value =
    document.documentElement.style.getPropertyValue('--chrome-top-h');
  return parseFloat(value) || 0;
}

// RouteTransition's announcement that a page's content is in the DOM and its
// scroll position restored — later than the page's mount when the page is a
// lazy chunk still on the wire. The sweeps re-run on it as well as on mount.
const ROUTE_SETTLED = 'route:settled';

// How long to wait for the incoming page to appear before assuming it has.
// RouteTransition's exit fade is 180ms; this only matters if it ever stops
// rendering the `.route-transition` element this watches for.
const ROUTE_MOUNT_TIMEOUT_MS = 600;

/** The pathname whose page is actually in the DOM.
 *
 *  RouteTransition fades the outgoing page out before it mounts the incoming
 *  one (AnimatePresence, mode="wait"), so for ~180ms after a navigation the
 *  URL is the new page's and the DOM is still the old one's. The chrome's DOM
 *  sweeps used to re-run once, one frame after the URL changed — reading the
 *  page on its way out — and then not again until a scroll, so a blog post
 *  opened from the feed was captioned with the feed's first row's lexicon
 *  until the reader scrolled. They follow this instead, which flips once the
 *  incoming page has mounted: a MutationObserver sees its `.route-transition`
 *  arrive. `onMount(pathname)` runs right then, before that page paints, for
 *  work that can't wait for the re-render (see the pinned-breadcrumb padding).
 *  With reduced motion the pages swap in one commit and this flips at once. */
function useMountedPathname(onMount) {
  const { pathname } = useLocation();
  const [mounted, setMounted] = useState(pathname);
  const mountedRef = useRef(pathname);
  // The route element that was on screen when `mounted` last changed. A
  // navigation that finds a different one there (an error boundary that
  // reset, say) is already looking at its new page.
  const pageElRef = useRef(null);
  const onMountRef = useRef(onMount);
  useLayoutEffect(() => {
    onMountRef.current = onMount;
  });
  useLayoutEffect(() => {
    const main = document.getElementById('main-content');
    const current = () => main?.querySelector('.route-transition') || null;
    if (pathname === mountedRef.current) {
      pageElRef.current = current();
      return undefined;
    }
    const settle = (el) => {
      mountedRef.current = pathname;
      pageElRef.current = el;
      onMountRef.current?.(pathname);
      setMounted(pathname);
    };
    const outgoing = current();
    if (!main || !outgoing || outgoing !== pageElRef.current) {
      settle(outgoing);
      return undefined;
    }
    let timer = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          const el = node.nodeType === 1 ? node : null;
          if (el?.classList.contains('route-transition')) {
            stop();
            settle(el);
            return;
          }
        }
      }
    });
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    observer.observe(main, { childList: true, subtree: true });
    timer = setTimeout(() => {
      stop();
      settle(current());
    }, ROUTE_MOUNT_TIMEOUT_MS);
    return stop;
  }, [pathname]);
  return mounted;
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

// How long the page must stay too short to scroll before the footer reveals
// on that basis. A fresh load is momentarily short — the feed content hasn't
// landed yet — so this rides out that gap; only a page that's STILL unscrollable
// after it is a genuinely short page whose footer should sit revealed.
const SHORT_PAGE_SETTLE_MS = 500;

// Open/close timing for the top chrome's expanded tier. Same curve and
// length the old height animation used, so the motion reads the same.
const TIER_SLIDE = { duration: 360, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
const TIER_ROW_FADE = { duration: 280, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' };
const TIER_ROW_DELAYS = [60, 100];

/** Opens and closes the top chrome's expanded tier (LISTENING TO /
 *  FOLLOWED BY and the vitals bar) without changing the page's layout
 *  mid-animation.
 *
 *  It used to animate the tier's height. That moved everything below the
 *  header every frame, so each frame was a layout, and in Safari a repaint
 *  of the whole visible page, all of it driven from JavaScript on the main
 *  thread (which iOS Safari can also run at a lower frame rate than the
 *  screen). Fast phones still stuttered.
 *
 *  Now the layout changes once per toggle and everything that moves is a
 *  transform or opacity animation, which the browser runs on its
 *  compositor:
 *
 *  - While sliding, the tier is an overlay pinned under the primary row
 *    (`.is-sliding`), so the header keeps its collapsed size. Its wrap
 *    slides down while its content counter-slides up by the same amount:
 *    the content stays put and is uncovered from the top, the same reveal
 *    the height animation gave. The wrap carries the header's bottom rule
 *    while sliding, so the line travels with the edge.
 *  - The followers (the page and the breadcrumb strip) translate by exactly
 *    how much of the tier is showing, so they stay butted against its edge.
 *  - Fully open, the tier joins the header's flow and the transforms are
 *    dropped in the same commit, so nothing visibly moves. Fully closed, it
 *    unmounts.
 *
 *  A toggle mid-slide starts from wherever the tier is. Returns the mode:
 *  'closed' | 'opening' | 'open' | 'closing'. */
function useTierSlide({ expanded, reduce, primaryRef, wrapRef, innerRef, followers }) {
  const [mode, setMode] = useState(expanded ? 'open' : 'closed');
  const [prevExpanded, setPrevExpanded] = useState(expanded);
  if (expanded !== prevExpanded) {
    setPrevExpanded(expanded);
    if (reduce) setMode(expanded ? 'open' : 'closed');
    else setMode(expanded ? 'opening' : 'closing');
  }
  const animsRef = useRef([]);
  const prevModeRef = useRef(mode);

  useLayoutEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    const running = animsRef.current;

    if (mode === 'open' || mode === 'closed') {
      // At rest, the layout now matches where the slide ended, so the held
      // end frames can go in this same commit.
      for (const a of running) a.cancel();
      animsRef.current = [];
      return;
    }
    if (!wrap || !inner || typeof wrap.animate !== 'function') {
      setMode(mode === 'opening' ? 'open' : 'closed');
      return;
    }

    // Fractional on purpose: offsetHeight rounds, and a rounded slide ends
    // half a pixel off from where the tier's real height puts the page.
    const height = inner.getBoundingClientRect().height;
    // How much of the tier is showing right now: read off the wrap's live
    // transform when a slide is mid-flight, otherwise all or nothing.
    let shown = prevMode === 'open' ? height : 0;
    if (running.length) {
      const ty = new DOMMatrixReadOnly(getComputedStyle(wrap).transform).m42;
      shown = Math.min(height, Math.max(0, height + ty));
    }
    for (const a of running) a.cancel();

    // Pin the overlay right under the primary row, relative to the header's
    // padding box (what `top` resolves against).
    const primary = primaryRef.current;
    const header = wrap.parentElement;
    if (primary && header) {
      const top =
        primary.getBoundingClientRect().bottom - header.getBoundingClientRect().top - header.clientTop;
      wrap.style.setProperty('--tier-top', `${top}px`);
    }
    const target = mode === 'opening' ? height : 0;
    const hold = { ...TIER_SLIDE, fill: 'forwards' };
    const slide = (el, from, to) =>
      el.animate(
        [{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }],
        hold,
      );
    const anims = [slide(wrap, shown - height, target - height), slide(inner, height - shown, height - target)];
    for (const el of followers()) if (el) anims.push(slide(el, shown, target));

    const rows = inner.querySelectorAll(':scope > .chrome-bar-row > .chrome-signals');
    if (mode === 'opening' && shown === 0) {
      rows.forEach((row, i) => {
        anims.push(
          row.animate(
            [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
            { ...TIER_ROW_FADE, delay: TIER_ROW_DELAYS[i] ?? 100, fill: 'backwards' },
          ),
        );
      });
    } else if (mode === 'closing') {
      rows.forEach((row) => {
        anims.push(
          row.animate(
            [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }],
            { ...TIER_ROW_FADE, fill: 'forwards' },
          ),
        );
      });
    }

    animsRef.current = anims;
    const lead = anims[0];
    lead.onfinish = () => {
      if (animsRef.current[0] === lead) setMode(mode === 'opening' ? 'open' : 'closed');
    };
    // `followers` and the refs are stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Drop any held transforms if the chrome unmounts mid-slide (the page
  // itself is a follower and outlives it).
  useEffect(
    () => () => {
      for (const a of animsRef.current) a.cancel();
    },
    [],
  );

  return mode;
}

/** True once the window is scrolled into the last `fraction` of its
 *  scrollable range (default 5%, i.e. ~95% down). Drives the footer strip:
 *  it slides up out of the bottom chrome as you reach the page's end and
 *  folds back down on the way up — the vertical mirror of the breadcrumb.
 *
 *  A page too short to meaningfully scroll counts as "at the end" so the
 *  footer stays revealed, matching the old always-in-flow footer — but only
 *  once the layout has settled. On a cold load the page is briefly short
 *  before the async feed content lands; revealing then would slide the footer
 *  up and straight back down the moment the content grows the page (it reads
 *  as the footer "expanding from the bottom on load"). So the short-page
 *  reveal is debounced by SHORT_PAGE_SETTLE_MS, and — because content
 *  streaming in grows the document without firing scroll/resize — a
 *  ResizeObserver on the body re-measures when the page's own height changes,
 *  so a reveal decided while the page was short is revised the instant real
 *  content arrives. Coalesced through requestAnimationFrame so the state flip
 *  (and the transform it drives) never runs synchronously inside a scroll.
 *
 *  Returns `{ near, short }`: `short` is that same settled verdict that the
 *  page can't scroll at all, which also withdraws the scroll-jump arrow. It
 *  flips back the moment the page can scroll. */
function useNearPageBottom(fraction = 0.05) {
  const [near, setNear] = useState(false);
  const [short, setShort] = useState(false);
  useEffect(() => {
    let frame = 0;
    let shortTimer = 0;
    const clearShortTimer = () => {
      if (shortTimer) {
        clearTimeout(shortTimer);
        shortTimer = 0;
      }
    };
    const tooShort = () => {
      const viewport = window.innerHeight || 0;
      const full = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      return full - viewport <= 4;
    };
    function measure() {
      const viewport = window.innerHeight || 0;
      const full = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      const maxScroll = full - viewport;
      if (maxScroll <= 4) {
        // Too short to scroll — likely still loading. (Re)start the settle
        // timer and only reveal if it's still unscrollable when the timer
        // fires; leave `near` as-is meanwhile so a genuinely short page that's
        // already revealed doesn't flicker.
        clearShortTimer();
        shortTimer = setTimeout(() => {
          shortTimer = 0;
          if (tooShort()) {
            setNear(true);
            setShort(true);
          }
        }, SHORT_PAGE_SETTLE_MS);
        return;
      }
      // The page can scroll: cancel any pending short-page reveal and track
      // the scroll position directly.
      clearShortTimer();
      setShort(false);
      const remaining = maxScroll - (window.scrollY || 0);
      setNear(remaining <= maxScroll * fraction);
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    // Feed first paint, "Load more", and background refreshes all grow/shrink
    // the document without a scroll or resize event — observe the body so the
    // nearness re-measures on those height changes too. Once the height holds
    // still, though: the top chrome's open/close animation grows the body
    // every frame, and reading scrollHeight each of those frames forced an
    // extra layout per frame.
    let settle = 0;
    const scheduleSettled = () => {
      clearTimeout(settle);
      settle = setTimeout(schedule, SIZE_SETTLE_MS);
    };
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleSettled) : null;
    if (ro) ro.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      clearShortTimer();
      clearTimeout(settle);
      if (ro) ro.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [fraction]);
  return { near, short };
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
 *  the viewport — i.e. items the user has scrolled past. 0 on pages with
 *  no feed, so the count chip naturally hides itself.
 *
 *  Coalesced through requestAnimationFrame so a flurry of scroll events on
 *  a long feed only triggers one count per frame. Also recomputes once the
 *  incoming page has mounted, since the feed content swaps out.
 *
 *  The rows are in document order, top to bottom, so the ones scrolled past
 *  are a prefix of the list and a binary search finds where it ends: about
 *  ten rect reads a frame instead of one per row, which at the end of a
 *  550-row feed was the largest single cost of scrolling it.
 *
 *  The count changes with every row, but the bar only needs to know when it
 *  appears, disappears or gains a digit. So it lives in a small store that
 *  only the number itself (ScrollCount) subscribes to, and the bar gets
 *  `digits`: 0 when there's no count, else how many digits it has. */
function useScrolledPastFeedItems(mountedPath) {
  const [store] = useState(createCountStore);
  const [digits, setDigits] = useState(0);
  useEffect(() => {
    let frame = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const items = document.querySelectorAll('.feed-item');
        let lo = 0;
        let hi = items.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (items[mid].getBoundingClientRect().bottom < 0) lo = mid + 1;
          else hi = mid;
        }
        store.set(lo);
        setDigits(lo > 0 ? String(lo).length : 0);
      });
    }
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener(ROUTE_SETTLED, update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener(ROUTE_SETTLED, update);
    };
  }, [mountedPath, store]);
  return { digits, store };
}

// `get` is the number to show: the last count above zero. Back at the top the
// count drops to 0 and the chip fades out, and it fades out on the count it
// had rather than on a 0.
function createCountStore() {
  let shown = 0;
  const listeners = new Set();
  return {
    get: () => shown,
    set(next) {
      if (next === 0 || next === shown) return;
      shown = next;
      for (const fn of listeners) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** The scrolled-past number, the only thing that re-renders per row. */
function ScrollCount({ store }) {
  const n = useSyncExternalStore(store.subscribe, store.get);
  return <span aria-label={`${n} items scrolled past`}>{n}</span>;
}
