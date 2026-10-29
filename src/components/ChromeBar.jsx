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
import { SKY_BANDS, skyHourLabel } from '../lib/skyTheme.js';
import { buildCrumbs, parentPathFor } from '../lib/breadcrumbs.js';
import { crumbStamp } from '../lib/recordPlate.js';
import { shortDayLabel } from '../lib/shortDayLabel.js';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useXray } from '../hooks/useXray.jsx';
import { useFeedFilter } from '../hooks/useFeedFilter.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useEscapeLayer } from '../hooks/useEscapeLayer.js';
import { useBarOverflow } from '../hooks/useBarOverflow.js';
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
import Time from './Time.jsx';
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

// How far the page can scroll under an atmosphere brought back over it (the
// peek) before it folds away again. The peek is a look, not a setting: the
// reader asked to see it, and scrolling on into the page is reading again.
const PEEK_SCROLL_CLOSE_PX = 240;

// The width the chrome changes shape at: on a phone Home leaves the bottom
// bar (the wordmark goes home) and the record NSID moves to x-ray. The bar's
// chips carry no words at any width; each says what it does in its title
// and its accessible name.
const PHONE_QUERY = '(max-width: 700px)';

/** The sky band behind this hour's avatar frame, deep sky over horizon. */
function skyBand(hour) {
  const band = SKY_BANDS[((hour % 24) + 24) % 24];
  return band ? `linear-gradient(to bottom, ${band.top}, ${band.bottom})` : undefined;
}

export default function ChromeBar() {
  const { expanded, toggle, crumb: pageCrumb } = useChromeBar();
  const { open: dockOpen, toggle: toggleDock } = useActionDock();
  const { panel } = useChromePanel();
  const reduce = useReducedMotion();
  const location = useLocation();
  const topRef = useRef(null);
  const primaryRef = useRef(null);
  const mastheadRef = useRef(null);
  const trailRef = useRef(null);
  const tierWrapRef = useRef(null);
  const tierInnerRef = useRef(null);
  const peekWrapRef = useRef(null);
  const peekInnerRef = useRef(null);

  // The atmosphere (LISTENING TO / FOLLOWED BY and the phone's vitals) is the
  // masthead: it sits in the page under the running head and scrolls away
  // with it, so while reading only the one pinned row is chrome. `expanded`
  // is the reader's standing choice (open by default on a desktop) and opens
  // or folds it in place at the top of the page.
  const tierMode = useTierSlide({
    expanded,
    reduce,
    wrapRef: tierWrapRef,
    innerRef: tierInnerRef,
    // Everything below the masthead's atmosphere rides along with its edge:
    // the trail strip under it and the page. (Called from an effect, after the
    // refs exist.)
    followers: () => [trailRef.current, document.getElementById('main-content')],
  });
  const tierSliding = tierMode === 'opening' || tierMode === 'closing';

  // Once it has scrolled away, the chevron brings the atmosphere back over the
  // page (the peek) without moving the page or touching the standing choice.
  const [peekOpen, setPeekOpen] = useState(false);
  const peekMode = useTierSlide({
    expanded: peekOpen,
    reduce,
    anchorRef: primaryRef,
    wrapRef: peekWrapRef,
    innerRef: peekInnerRef,
    followers: () => [],
  });

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
  // The mark's box is drawn from the first paint and filled with this hour's
  // sky band (SKY_BANDS, the frame's own deep sky over its horizon) until the
  // first frame decodes, so the site name beside it never moves and the first
  // frame already says "this hour's sky". A frame that fails leaves the band
  // standing in for it rather than taking the box away.
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

  // The path whose page is actually on screen, which for the length of the
  // route transition's exit fade is still the one being left. The trail, the
  // title it borrows and the DOM sweeps all follow this rather than the URL,
  // so the masthead's trail doesn't change (and shove the page) under a page
  // that's still fading out; see useMountedPathname.
  const mountedPath = useMountedPathname();
  const baseCrumbs = buildCrumbs(mountedPath);
  // Individual (detail) pages — anything two or more segments deep, e.g.
  // /blogging/:slug, /creating/:slug, a generic record — carry their trail in
  // the masthead, under the atmosphere, as their standing way up. Feed and
  // index pages show theirs only in the running head, once scrolled.
  const isDetailPage = baseCrumbs.length >= 2;
  const inAdmin = location.pathname === '/admin';
  // On /admin the masthead isn't drawn (below), so its atmosphere is never in view.
  const head = useRunningHead({
    mountedPath,
    topRef,
    tierWrapRef,
    tierMode: inAdmin ? 'closed' : tierMode,
  });
  // The trail's last crumb names the page: its own label when it gives one
  // through PageShell's `crumb` (a record page's rkey, a mothing night's
  // day), else on a detail page the title it shows, rather than its slug.
  const ownLabel = pageCrumb?.path === mountedPath ? pageCrumb.label : null;
  // A post's date, at the right of the masthead's trail (PageShell's
  // `crumbDate`): its page has no date line of its own.
  const ownDate = pageCrumb?.path === mountedPath ? pageCrumb.date : null;
  const titleLabel = !ownLabel && isDetailPage ? head.title : null;
  const crumbs = withPageLabel(baseCrumbs, ownLabel || titleLabel);
  const dayLabel = useCurrentDayLabel(mountedPath);
  const scrolledDown = useScrolledDown();
  // Reading: the page has scrolled past its title (or, on a feed with no
  // title, past its first day, or simply well into the page). The trail then
  // takes the status's place in the pinned row, and the record NSID joins it
  // on a desktop.
  const pastTop = head.hasTitle ? head.pastTitle : !!dayLabel || scrolledDown;
  const reading = baseCrumbs.length > 0 && pastTop;

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

  // The chevron. At the top of the page it opens or folds the masthead's
  // atmosphere in place and remembers that (the reader's standing choice).
  // Once the atmosphere has scrolled away it brings it back over the page
  // instead, for a look, and leaves the choice alone.
  const tierInView = !inAdmin && tierMode !== 'closed' && head.tierInView;
  const atmosphereShown = peekOpen || (expanded && (tierInView || tierSliding));
  function onAtmosphere() {
    if (peekOpen) {
      setPeekOpen(false);
      return;
    }
    if (!inAdmin && expanded && (tierInView || tierSliding)) {
      toggle();
      return;
    }
    const header = topRef.current?.getBoundingClientRect();
    const mast = mastheadRef.current?.getBoundingClientRect();
    if (!inAdmin && !expanded && header && mast && mast.top >= header.bottom - 1) {
      toggle();
      return;
    }
    setPeekOpen(true);
  }

  // The peek folds away on Escape, on navigating, when a sheet or the menu
  // opens over it, once the reader scrolls on, and when the masthead's own
  // atmosphere comes back into view.
  useEscapeLayer(peekOpen, () => setPeekOpen(false));
  const [peekPath, setPeekPath] = useState(location.pathname);
  if (peekPath !== location.pathname) {
    setPeekPath(location.pathname);
    if (peekOpen) setPeekOpen(false);
  }
  useEffect(() => {
    if (peekOpen && (dockOpen || panel || tierInView)) setPeekOpen(false);
  }, [peekOpen, dockOpen, panel, tierInView]);
  useEffect(() => {
    if (!peekOpen) return undefined;
    const startY = window.scrollY || 0;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (Math.abs((window.scrollY || 0) - startY) > PEEK_SCROLL_CLOSE_PX) setPeekOpen(false);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [peekOpen]);

  // Publish the top chrome's bottom edge as `--chrome-top-h` on <html>: the
  // y-coordinate where the pinned chrome ends and the page begins. Since the
  // atmosphere and trail became the masthead, in the page, that's the running
  // head's own bottom. Consumers: the dock and the bottom sheets (they fill
  // from here down to the bottom bar), the page's scroll padding, and the
  // sweeps below that ask what's just under the chrome.
  //
  // Measured from getBoundingClientRect().bottom, not offsetHeight: the rect
  // gives the real viewport position, so it absorbs any top inset (iOS safe
  // area / URL bar) that a height would miss. Floored so any sub-pixel bias
  // tucks a sheet a hair under the chrome rather than leaving a seam.
  //
  // It's a custom property on <html>, and changing one restyles every element
  // on the page whether anything reads it or not, so it's only written when
  // it actually changes, and a resize publishes once the header holds still.
  //
  // A layout effect, so a hard load lays out with it already in place.
  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el) return undefined;
    const rootStyle = document.documentElement.style;
    const apply = () => {
      const value = `${Math.max(0, Math.floor(el.getBoundingClientRect().bottom))}px`;
      if (rootStyle.getPropertyValue('--chrome-top-h') !== value) {
        rootStyle.setProperty('--chrome-top-h', value);
      }
    };
    apply();
    // The trail strip used to be pinned over the page and reserved its height
    // on `.main` through this; it's in the page now and needs no room kept.
    rootStyle.removeProperty('--chrome-crumb-pin-h');
    let settle = 0;
    const scheduleSettled = () => {
      clearTimeout(settle);
      settle = setTimeout(apply, SIZE_SETTLE_MS);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleSettled) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', scheduleSettled);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', scheduleSettled);
      clearTimeout(settle);
    };
  }, []);

  const peekShown = peekMode !== 'closed';
  return (
    <>
      <header
        ref={topRef}
        className={`chrome-bar chrome-bar-top${reading ? ' is-reading' : ''}${pastTop ? ' is-past-top' : ''}`}
        role="banner"
      >
        <div ref={primaryRef} className="chrome-bar-row chrome-bar-primary">
          <div className="chrome-cluster">
            <Link to="/" className="chrome-title">
              {targetAvatar && (
                <span
                  className="chrome-mark chrome-mark-avatar"
                  style={{ backgroundImage: skyBand(skyDisplayHour) }}
                  aria-hidden="true"
                >
                  {/* No key: the element persists across src swaps so the
                      old frame stays painted right up to the instant the
                      pre-decoded next frame replaces it. */}
                  {avatar && (
                    <img
                      className="chrome-mark-img"
                      src={avatar}
                      alt=""
                      onError={() => setAvatar(null)}
                    />
                  )}
                </span>
              )}
              <span className="chrome-name">dame.is</span>
            </Link>
            {/* The running head: the status at the top of the page, the trail
                once reading. Both sit in one grid cell and cross-fade (CSS,
                instant under reduced motion), so the row never changes size.
                Only the one showing is live to a pointer, keyboard or reader. */}
            <div className="chrome-head">
              <div
                className="chrome-signals chrome-signals-primary chrome-head-status"
                inert={reading ? '' : undefined}
                aria-hidden={reading ? true : undefined}
              >
                <NowStatus />
              </div>
              {crumbs.length > 0 && (
                <nav
                  className="chrome-breadcrumb chrome-head-trail"
                  aria-label="Breadcrumb"
                  inert={reading ? undefined : ''}
                  aria-hidden={reading ? undefined : true}
                >
                  <Trail crumbs={crumbs} titled={!!titleLabel} />
                </nav>
              )}
            </div>
          </div>
          {stripNsid && (
            <span className="chrome-crumb-nsid chrome-head-nsid" aria-hidden={pastTop ? undefined : true}>
              {stripNsid}
            </span>
          )}
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
            className={`chrome-expand${atmosphereShown ? ' is-open' : ''}`}
            onClick={onAtmosphere}
            aria-expanded={atmosphereShown}
            aria-controls={peekShown ? 'chrome-atmosphere-peek' : 'chrome-bar-secondary'}
            aria-label={atmosphereShown ? 'Hide the atmosphere' : 'Show the atmosphere'}
            title={
              atmosphereShown
                ? 'Hide the atmosphere'
                : 'Atmosphere: what Dame is doing, listening to, and their phone'
            }
          >
            <span className="chrome-expand-face">
              {/* Rotation is a CSS transition keyed to is-open, so it runs on
                  the compositor. */}
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
            </span>
          </button>
        </div>

        {/* The atmosphere brought back over the page once the masthead has
            scrolled away: an overlay pinned under the running head, slid open
            and shut on the compositor (useTierSlide) and never joining the
            flow, so the page doesn't move under the reader. */}
        {peekShown && (
          <div
            ref={peekWrapRef}
            id="chrome-atmosphere-peek"
            className="chrome-bar-secondary-wrap chrome-peek is-sliding"
            inert={peekMode === 'closing' ? '' : undefined}
            aria-hidden={peekMode === 'closing' ? true : undefined}
          >
            <div ref={peekInnerRef} className="chrome-bar-secondary-inner">
              <AtmosphereRows />
            </div>
          </div>
        )}
      </header>

      {/* The masthead: the atmosphere and, on a detail page, the trail, in the
          page under the running head. Nothing is lost at the top; reading on,
          they scroll away under it. The atmosphere opens and closes with
          compositor-only animations (useTierSlide): while sliding it rides
          over the page as an overlay, and only joins the flow once fully
          open, moving the page once rather than every frame. A `.chrome-bar`
          like the running head, so it wears the inks tuned for the chrome's
          surfaces (theme.css) and leaves print with the rest.

          Not on /admin, whose workbench is a fixed frame from the running
          head down: a masthead in the flow would sit behind it. There the
          chevron brings the atmosphere over the frame as a peek. */}
      <div
        ref={mastheadRef}
        className={`chrome-bar chrome-masthead${!inAdmin && (tierMode === 'open' || isDetailPage) ? ' has-flow' : ''}`}
      >
        {!inAdmin && tierMode !== 'closed' && (
          <div
            ref={tierWrapRef}
            id="chrome-bar-secondary"
            className={`chrome-bar-secondary-wrap${tierSliding ? ' is-sliding' : ''}`}
            inert={tierMode === 'closing' ? '' : undefined}
            aria-hidden={tierMode === 'closing' ? true : undefined}
          >
            <div ref={tierInnerRef} className="chrome-bar-secondary-inner">
              <AtmosphereRows />
            </div>
          </div>
        )}
        {!inAdmin && isDetailPage && (
          // While reading, the running head carries the trail and this copy
          // has scrolled away under it; only one is live at a time.
          <div
            ref={trailRef}
            className="chrome-bar-row chrome-masthead-trail"
            inert={reading ? '' : undefined}
            aria-hidden={reading ? true : undefined}
          >
            <nav className="chrome-breadcrumb" aria-label="Breadcrumb">
              <Trail crumbs={crumbs} titled={!!titleLabel} withRoot />
            </nav>
            {ownDate && (
              <Time value={ownDate} variant="clock" className="chrome-crumb-date">
                {crumbStamp(ownDate)}
              </Time>
            )}
            {stripNsid && <span className="chrome-crumb-nsid">{stripNsid}</span>}
          </div>
        )}
      </div>

      <ChromeBarBottom
        dockOpen={dockOpen}
        toggleDock={toggleDock}
        mountedPath={mountedPath}
        dayLabel={dayLabel}
      />
    </>
  );
}

/** The atmosphere's two rows. Drawn in the masthead, and again in the peek
 *  while that's open. Memoised: it takes no props, and the chrome around it
 *  re-renders as the page scrolls. */
const AtmosphereRows = memo(function AtmosphereRows() {
  return (
    <>
      <div className="chrome-bar-row chrome-bar-secondary">
        <div className="chrome-signals chrome-signals-secondary">
          <NowPlaying />
          <ProfileStats />
          {/* Day of life joins the LISTENING TO / FOLLOWED BY stack — but only
              on mobile. On desktop it lives at the right edge of the vitals
              bar below instead; this copy is hidden there via CSS (and the
              vitals-bar copy is hidden on mobile). */}
          <DayOfLifeTicker />
        </div>
      </div>
      {/* Second row: the phone's state, its own bar under the first, with its
          own top hairline and deep surface. */}
      <div className="chrome-bar-row chrome-bar-state">
        <div className="chrome-signals chrome-signals-state">
          <VitalsPanel />
        </div>
      </div>
    </>
  );
});

/** The trail. In the masthead it opens with the root crumb, a link home; in
 *  the running head the wordmark beside it already goes home, so the slash is
 *  only a separator there. A crumb links only where a page answers
 *  (breadcrumbs.js). `titled` sets the last crumb as a title, in italic. */
function Trail({ crumbs, titled, withRoot = false }) {
  return (
    <ol className="chrome-crumbs">
      {withRoot && (
        <li className="chrome-crumb">
          <Link to="/" className="chrome-crumb-link chrome-crumb-root" aria-label="Home">
            /
          </Link>
        </li>
      )}
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <li key={c.path} className="chrome-crumb">
            {(i > 0 || !withRoot) && (
              <span className="chrome-crumb-sep" aria-hidden="true">
                /
              </span>
            )}
            {last ? (
              <span
                className={`chrome-crumb-current${titled ? ' is-title' : ''}`}
                aria-current="page"
              >
                {c.label}
              </span>
            ) : c.to ? (
              <Link to={c.to} className="chrome-crumb-link">
                {c.label}
              </Link>
            ) : (
              // A segment no page answers (see breadcrumbs.js): still part of
              // where you are, just not somewhere to go.
              <span className="chrome-crumb-text">{c.label}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** A `matchMedia` query as state, following changes. */
function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

/** A bar chip's insides: its face (the hairline square, or the text box on
 *  the hour chip). While the sheet a chip opens is up, the sheet's × is drawn
 *  over the face, the face's own content hidden but still holding its width,
 *  so open and closed differ by shape, not just tint, and nothing beside it
 *  moves. Each chip's accessible name is its aria-label. */
function ChipBody({ glyph: Glyph, sheetOpen = false, children }) {
  return (
    <>
      <span className={`chrome-nav-face${sheetOpen ? ' is-sheet-open' : ''}`}>
        {children ?? <Glyph className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />}
        {sheetOpen && (
          <X className="chrome-nav-glyph chrome-nav-close" aria-hidden="true" strokeWidth={1.75} />
        )}
      </span>
    </>
  );
}

// The chips the bar can move into the compass sheet, with how the sheet
// draws them. Their actions stay with the bar (ChromeBarBottom), which
// publishes the current set through the dock context.
const TOOL_META = {
  sky: { word: 'sky', title: 'Sky: pick an hour of Dame’s sky to see the site in' },
  filter: { word: 'filter', glyph: ListFilterPlus, title: 'Filter: choose what this feed shows' },
  search: { word: 'search', glyph: Search, title: 'Search this feed' },
  info: { word: 'about', glyph: Info, title: 'About this site, and a key to these buttons' },
  inspect: { word: 'inspect', glyph: Microscope, title: 'Inspect: show the AT Protocol records under the page' },
  print: { word: 'print', glyph: Printer, title: 'Print or save this resume as a PDF' },
  edit: { word: 'edit', glyph: Pencil, title: 'Edit mode' },
  back: { word: 'back', glyph: ArrowLeft, title: 'Back to the page before' },
  scroll: { word: 'top', glyph: ArrowUp, title: 'Back to the top' },
  home: { word: 'home', glyph: Home, title: 'Home' },
  // The menu's own, when the open bar has no room for it.
  account: { word: 'account', glyph: User, title: 'Account: sign in with your Bluesky or AT Protocol handle' },
};

// Memoised: ChromeBar re-renders as the page scrolls (the trail's state and
// the record NSID track the scroll), and none of that reaches down here
// except the day in view, which changes once a day section.
const ChromeBarBottom = memo(function ChromeBarBottom({
  dockOpen,
  toggleDock,
  mountedPath,
  dayLabel,
}) {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { view, setView, closeDock, setOverflowTools } = useActionDock();
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
  const rowRef = useRef(null);
  const { available: filterAvailable } = useFeedFilter();
  const { skyHour, advanceSkyHour, skyOverridden } = useTheme();
  const hourLabel = skyHourLabel(skyHour);
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

  const phone = useMediaQuery(PHONE_QUERY);

  // The day in view rides beside ↑ (useCurrentDayLabel); on a feed without
  // day sections, the count of entries scrolled past does instead.
  const showScrollJump = !inAdmin && !pageTooShort;
  const dayText = atTop ? null : dayLabel?.short || (scrolledPastDigits > 0 ? 'count' : null);

  // What fits. The compass is never moved; everything else gives way in
  // BAR_PRIORITY order and is drawn in the compass sheet instead. Home always
  // leaves a phone's bar: the wordmark goes home.
  const plan = useBarOverflow(rowRef, {
    forced: phone ? ['home'] : [],
    dayPresent: !!dayText && showScrollJump && !dockOpen,
  });
  const out = (key) => (plan.hidden.has(key) ? ' is-out' : '');
  const showDay = !!dayText && plan.day && !dockOpen;

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

  function onEdit() {
    // Entering/leaving edit mode owns the bottom chrome — fold any open
    // search/filter/info panel away first, and leave x-ray (the two modes
    // compete for the same rows).
    closePanel();
    if (xrayActive) exitXray();
    if (editActive) {
      // In select / moderation mode → leave it.
      toggleEdit();
    } else if (editSheet) {
      // A page editor the pencil opened is showing → close it.
      closeEditSheet();
    } else if (pageEditUri && !selectionPage) {
      // Nothing to select on this page, but it has its own editable record —
      // jump straight into its page editor instead of an empty "tap items to
      // select" bar.
      openEditSheet(pageEditUri);
    } else {
      // Feeds / guestbook (or a page with no record): the usual selectable
      // edit mode.
      toggleEdit();
    }
  }

  function onInspect() {
    // Entering it folds away any open panel and the owner's edit mode (they
    // compete for the same surface).
    closePanel();
    if (editActive) exitEdit();
    toggleXray();
  }

  // What each chip does, for the copies of them the compass sheet draws when
  // they don't fit here. Read through a ref, so the sheet always runs today's
  // version (Back's fallback follows the route) without republishing.
  const actionsRef = useRef({});
  actionsRef.current = {
    sky: inSkyStudio ? advanceSkyHour : () => togglePanel('sky'),
    filter: () => togglePanel('filter'),
    search: () => togglePanel('search'),
    info: () => togglePanel('info'),
    inspect: () => {
      closeDock();
      onInspect();
    },
    print: () => {
      closeDock();
      window.print();
    },
    edit: () => {
      closeDock();
      onEdit();
    },
    back: goBack,
    scroll: () => {
      closeDock();
      if (atTop) scrollToBottom();
      else scrollToTop();
    },
    home: () => navigate('/'),
    account: () => setView(view === 'account' ? 'menu' : 'account'),
  };

  // Which chips the compass sheet draws: the ones that didn't fit the bar at
  // rest. While the menu is open the bar wears different tools (the layout
  // words, Account) and is measured afresh, but the sheet keeps listing what
  // the resting bar couldn't hold, less anything the open bar does show, plus
  // any of the menu's own controls the open bar had no room for.
  const restingOutRef = useRef([]);
  if (!dockOpen) restingOutRef.current = [...plan.hidden].filter((k) => TOOL_META[k]);
  const openBarShows = new Set(
    dockOpen
      ? [
          !onHomePage && !plan.hidden.has('back') && 'back',
          showScrollJump && !plan.hidden.has('scroll') && 'scroll',
          !onHomePage && !phone && !plan.hidden.has('home') && 'home',
        ].filter(Boolean)
      : [],
  );
  const openOut = dockOpen && plan.hidden.has('account') ? ['account'] : [];
  const sheetTools = [...restingOutRef.current.filter((k) => !openBarShows.has(k)), ...openOut];
  const sheetToolsKey = `${sheetTools.join(',')}|${atTop}|${hourLabel}`;
  useEffect(() => {
    setOverflowTools(
      sheetTools.map((key) => ({
        key,
        ...TOOL_META[key],
        word: key === 'scroll' && atTop ? 'end' : TOOL_META[key].word,
        glyph: key === 'scroll' && atTop ? ArrowDown : TOOL_META[key].glyph,
        face: key === 'sky' ? hourLabel : null,
        run: () => actionsRef.current[key]?.(),
      })),
    );
    // sheetToolsKey covers everything the list is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetToolsKey, setOverflowTools]);
  useEffect(() => () => setOverflowTools([]), [setOverflowTools]);

  // Shared enter/exit for the bottom bar's on-demand controls (back, home,
  // account). They cross-fade rather than sliding in on a transform, and
  // `layout` on the whole right cluster eases the persistent buttons
  // (scroll-jump, menu) over to fill the gap instead of letting them jump —
  // so a control never just pops in or out. `layout` is dropped under
  // reduced-motion so nothing translates.
  const controlFade = {
    initial: reduce ? false : { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: reduce ? 0 : 0.2, ease: [0.22, 0.61, 0.36, 1] },
  };
  const layoutProp = reduce ? undefined : true;
  // What can move the right cluster's buttons: one of its controls coming or
  // going, the day beside ↑ changing, or the chips that fit.
  // Motion measures a `layout` element on every render unless told what its
  // layout depends on, and this bar renders whenever the page scrolls past a
  // feed item.
  const layoutDependency = [
    onHomePage,
    scrolledPastDigits,
    showDay && dayText,
    showScrollJump,
    dockOpen,
    isOwner,
    [...plan.hidden].join(','),
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
      <div className="chrome-bottom-row" ref={rowRef}>
        {/* Left cluster. While the nav dock is open, the page-level controls
            (theme / filter / search / info / inspect) hand off to the dock's
            own tools (the paper toggle, while it exists) — they cross-fade in and
            temporarily take the same spot, then swap back when the dock
            closes. (Account lives in the right cluster; the atmosphere-debug
            readout is its own sheet, reached from the inspect HUD.) */}
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
                {/* The sky chip. The site always runs the hour-tracking sky
                    theme; this chip shows the hour whose palette is on screen,
                    "1 pm", the hour in Eastern time (its label and tooltip
                    say so). Outside the admin
                    SkyThemeStudio, tapping it opens the SkyHourSheet, where
                    any visitor can sample the palette at any hour. Inside the
                    studio, each tap advances one hour (the studio has its own
                    arc for jumping). */}
                <button
                  type="button"
                  data-tool="sky"
                  className={`chrome-nav chrome-sky-hour ${skyPanelOpen ? 'is-open' : ''}${out('sky')}`}
                  data-held={skyOverridden && !inSkyStudio ? '' : undefined}
                  onClick={inSkyStudio ? advanceSkyHour : () => togglePanel('sky')}
                  aria-expanded={inSkyStudio ? undefined : skyPanelOpen}
                  aria-controls={inSkyStudio ? undefined : 'chrome-sky-sheet'}
                  aria-label={`Sky: ${skyOverridden ? 'held at' : 'showing'} ${hourLabel} Eastern time`}
                  title={
                    inSkyStudio
                      ? `Sky: ${hourLabel} Eastern time. Tap to advance an hour`
                      : `Sky: the site is coloured like Dame’s sky at ${hourLabel} Eastern time. Tap to pick an hour`
                  }
                >
                  <ChipBody sheetOpen={skyPanelOpen}>
                    <span className="chrome-sky-time">{hourLabel}</span>
                  </ChipBody>
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
                    <ChipBody glyph={Type} />
                  </button>
                )}
                {filterAvailable && (
                  <button
                    type="button"
                    data-tool="filter"
                    className={`chrome-nav chrome-filter ${filterPanelOpen || filterCustomized ? 'is-open' : ''}${out('filter')}`}
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
                    title={filterCustomized ? 'Filter: this feed is filtered' : TOOL_META.filter.title}
                  >
                    <ChipBody glyph={ListFilterPlus} sheetOpen={filterPanelOpen} />
                  </button>
                )}
                {/* Shown while a query is active even with search switched
                    off: a `?q=` link still filters the page behind it, and
                    this is the one control that says so and can clear it. */}
                {(SEARCH_ENABLED || searchActive) && (
                  <button
                    type="button"
                    data-tool="search"
                    className={`chrome-nav chrome-search-btn ${searchPanelOpen || searchActive ? 'is-open' : ''}${out('search')}`}
                    onClick={() => togglePanel('search')}
                    aria-expanded={searchPanelOpen}
                    aria-controls="chrome-search-sheet"
                    aria-label={searchActive ? `Search (current query: ${params.get('q')})` : 'Open search'}
                    title={searchActive ? `Search: “${params.get('q')}”` : TOOL_META.search.title}
                  >
                    <ChipBody glyph={Search} sheetOpen={searchPanelOpen} />
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
                    data-tool="info"
                    className={`chrome-nav chrome-info-btn ${infoPanelOpen ? 'is-open' : ''}${out('info')}`}
                    onClick={() => togglePanel('info')}
                    aria-expanded={infoPanelOpen}
                    aria-controls="chrome-info-sheet"
                    aria-label="About this site"
                    title={TOOL_META.info.title}
                  >
                    <ChipBody glyph={Info} sheetOpen={infoPanelOpen} />
                  </button>
                )}
                {/* The admin's surface-level pair: what is happening, what do
                    I do. (The third — where am I / go anywhere — moved to the
                    right cluster as the owner's standing admin button, beside
                    the compass; see below.) */}
                {showAdminState && (
                  <button
                    type="button"
                    data-tool="more"
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
                    <ChipBody glyph={Ellipsis} sheetOpen={adminActionsOpen} />
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
                    data-dirty={adminState?.dirty ? '' : undefined}
                    disabled={adminPrimary.disabled}
                    aria-busy={adminPrimary.busy ? 'true' : undefined}
                    onClick={adminPrimary.run}
                    title={adminPrimary.label}
                  >
                    <ChipBody>{adminPrimary.label}</ChipBody>
                  </button>
                )}
                {/* Atmosphere inspect — the marquee "turn the page inside out"
                    mode. Toggling it reveals the AT Protocol records beneath
                    the page. Withheld on /admin: x-ray annotates public record
                    markup and the workbench has none. A mode, not a sheet, so
                    it keeps its glyph while on. */}
                {!inAdmin && (
                  <button
                    type="button"
                    data-tool="inspect"
                    className={`chrome-nav chrome-xray ${xrayActive ? 'is-open' : ''}${out('inspect')}`}
                    onClick={onInspect}
                    aria-pressed={xrayActive}
                    aria-label={xrayActive ? 'Stop inspecting' : 'Inspect this page'}
                    title={xrayActive ? 'Stop inspecting' : TOOL_META.inspect.title}
                  >
                    <ChipBody glyph={Microscope} />
                  </button>
                )}
                {onResumePage && (
                  <button
                    type="button"
                    data-tool="print"
                    className={`chrome-nav chrome-print-btn${out('print')}`}
                    onClick={() => window.print()}
                    aria-label="Print or save this resume as PDF"
                    title={TOOL_META.print.title}
                  >
                    <ChipBody glyph={Printer} />
                  </button>
                )}
                {/* Withheld on /admin: the shell's PageShell registers no
                    atUri and no selection page, so every branch of onEdit
                    would fall through to toggleEdit() and open an empty "Tap
                    items to select" bar over the workbench. The X below is
                    gated on `chromeEditOpen` alone, so nobody can be trapped
                    in edit mode by this guard. */}
                {isOwner && !inAdmin && (
                  <button
                    type="button"
                    data-tool="edit"
                    className={`chrome-nav chrome-edit-btn ${chromeEditOpen ? 'is-open' : ''}${out('edit')}`}
                    onClick={onEdit}
                    aria-pressed={chromeEditOpen}
                    aria-label={chromeEditOpen ? 'Exit edit mode' : 'Enter edit mode'}
                    title={chromeEditOpen ? 'Exit edit mode' : 'Edit mode'}
                  >
                    <ChipBody glyph={Pencil} />
                  </button>
                )}
                {isOwner && chromeEditOpen && (
                  <button
                    type="button"
                    data-tool="discard"
                    className="chrome-nav chrome-edit-exit"
                    onClick={exitEdit}
                    aria-label="Close edit mode without saving"
                    title="Close edit mode without saving"
                  >
                    <ChipBody glyph={X} />
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="chrome-bottom-spacer" aria-hidden="true" />
        {/* Right cluster. The on-demand controls (back, home, account) fade
            in and out inside a popLayout presence; the persistent scroll-jump
            and menu buttons carry `layout` so they slide over to fill the
            freed space rather than jumping when a control comes or goes. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {!onHomePage && (
            <motion.button
              key="back"
              layout={layoutProp}
              layoutDependency={layoutDependency}
              type="button"
              data-tool="back"
              className={`chrome-nav chrome-back-btn${out('back')}`}
              onClick={goBack}
              aria-label="Go back"
              title={TOOL_META.back.title}
              {...controlFade}
            >
              <ChipBody glyph={ArrowLeft} />
            </motion.button>
          )}
        </AnimatePresence>
        {/* Withheld on /admin because it is INERT there, not merely unwanted:
            the workbench is a fixed frame over an `overflow: hidden` document,
            and each of its panes is its own scrollport. `window.scrollTo` has
            nothing to move. A button that does nothing when pressed is worse
            than an absent one, and its 36px is exactly what the admin's own
            three controls need at 320.

            Scrolled into a feed, it also says where you are: the day in view
            ("Oct 25"), or on a feed without days the count of entries above.
            Both used to be a bare number beside it that couldn't be hovered.
            Its name is built from its content, so a reader hears the count
            ("7 entries above") without the button re-rendering per row. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {showScrollJump && (
            <motion.button
              key="scroll-jump"
              layout={layoutProp}
              layoutDependency={layoutDependency}
              type="button"
              data-tool="scroll"
              className={`chrome-nav chrome-scroll-jump${out('scroll')}`}
              onClick={atTop ? scrollToBottom : scrollToTop}
              title={
                atTop
                  ? 'To the end of the page'
                  : dayLabel?.full
                    ? `Back to the top. You’re reading ${dayLabel.full}`
                    : TOOL_META.scroll.title
              }
              {...controlFade}
            >
              <span className="visually-hidden">
                {atTop ? 'Scroll to the end' : 'Scroll to the top'}
              </span>
              <ChipBody>
                {atTop ? (
                  <ArrowDown className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                ) : (
                  <ArrowUp className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
                )}
                {showDay && (
                  <span className="chrome-scroll-day">
                    {dayLabel?.short ? (
                      <>
                        <span className="visually-hidden">, reading </span>
                        {dayLabel.short}
                      </>
                    ) : (
                      <ScrollCount store={scrolledPastStore} />
                    )}
                  </span>
                )}
              </ChipBody>
              {!atTop && scrolledPastDigits > 0 && <ScrollCount store={scrolledPastStore} spoken />}
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
              data-tool="home"
              className={`chrome-nav chrome-home-btn${out('home')}`}
              aria-label="Go home"
              title={TOOL_META.home.title}
              onClick={() => {
                // Collapse the open menu on the way home so it animates
                // out (via the dock's AnimatePresence exit) instead of
                // being left open over the freshly-loaded home page.
                if (dockOpen) toggleDock();
              }}
              {...controlFade}
            >
              <ChipBody glyph={Home} />
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
              data-tool="account"
              className={`chrome-nav chrome-tool-account ${view === 'account' ? 'is-open' : ''}${out('account')}`}
              onClick={() => setView(view === 'account' ? 'menu' : 'account')}
              aria-pressed={view === 'account'}
              aria-label="Account"
              title={TOOL_META.account.title}
              {...controlFade}
            >
              <ChipBody glyph={User} />
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
            data-tool="admin"
            className={`chrome-nav chrome-admin-nav ${adminNavOpen || adminDirectoryOpen ? 'is-open' : ''}`}
            onClick={() => togglePanel(adminSurface ? ADMIN_NAV_PANEL : ADMIN_DIRECTORY_PANEL)}
            aria-expanded={adminNavOpen || adminDirectoryOpen}
            aria-controls={adminSurface ? ADMIN_NAV_PANEL_ID : ADMIN_DIRECTORY_PANEL_ID}
            aria-label={
              adminSurface ? `${adminSurface.label} — change admin surface` : 'Admin — open the surface directory'
            }
            title={adminSurface ? `${adminSurface.label} — change surface` : 'Admin'}
          >
            <ChipBody glyph={LayoutGrid} sheetOpen={adminNavOpen || adminDirectoryOpen} />
          </motion.button>
        )}
        {/* The compass: the menu, and the one chip that never leaves the bar
            or shrinks. Open, it wears the bar's "on" look with the sheet's ×,
            like every chip whose sheet is up. */}
        <motion.button
          layout={layoutProp}
          layoutDependency={layoutDependency}
          type="button"
          data-tool="menu"
          className={`chrome-nav chrome-nav-bottom ${dockOpen ? 'is-open' : ''}`}
          onClick={toggleDock}
          aria-expanded={dockOpen}
          aria-controls="action-dock-panel"
          aria-label={dockOpen ? 'Close menu' : 'Open menu'}
          title={dockOpen ? 'Close the menu' : 'Menu: every page Dame is'}
        >
          <ChipBody glyph={Compass} sheetOpen={dockOpen} />
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

/** The trail with its last crumb relabelled, when the page names itself. */
function withPageLabel(crumbs, label) {
  if (!label || crumbs.length === 0) return crumbs;
  return [...crumbs.slice(0, -1), { ...crumbs[crumbs.length - 1], label }];
}

// The URL params a page's filter sheet writes (Home, Posting, Creating): any of
// them present means the list on screen is filtered.
const FILTER_PARAMS = ['verbs', 'postTypes', 'kinds'];

/** The day section currently scrolled under the top chrome, as
 *  `{ short, full }` (shortDayLabel, and the header's full name), or null
 *  while above the first day header and on pages without day sections.
 *
 *  Reads the DOM directly, so no page-side wiring is needed. A day header is
 *  the `.day-header` in a `.day-section-header` (DayOfLifeHeader, /mothing),
 *  or any element carrying `data-day-label`, whose value is then the label as
 *  it should be said (a page with its own day markup can opt in that way).
 *  The full name is the header's aria-label or title when it has a short
 *  visible one. The headers are re-queried on each scroll frame; a feed
 *  renders at most a few dozen of them, and querying live keeps freshly
 *  loaded groups ("Load more", background refresh) accurate without
 *  observers. */
function useCurrentDayLabel(mountedPath) {
  const [label, setLabel] = useState(null);
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      const headers = document.querySelectorAll(
        '.day-section-header .day-header, [data-day-label]',
      );
      let current = null;
      if (headers.length) {
        const chromeBottom = chromeTopPx();
        for (const h of headers) {
          if (h.getBoundingClientRect().top < chromeBottom + 12) current = h;
          else break;
        }
      }
      if (!current) {
        setLabel((prev) => (prev === null ? prev : null));
        return;
      }
      const given = current.getAttribute('data-day-label');
      const text = (given || current.textContent || '').trim();
      const full =
        current.getAttribute('aria-label') || current.getAttribute('title') || text;
      // Shortened from what the header shows ("Today", "October 21, 2026"),
      // not its fuller name, which can lead with "1 week ago".
      const short = given ? text : shortDayLabel(text);
      setLabel((prev) => (prev && prev.short === short && prev.full === full ? prev : { short, full }));
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

/** Where the reader is against the page's title and the masthead.
 *
 *  - `title`: the page's own title, the first `h1` in the page on screen, as
 *    the trail's last crumb on a detail page ("Why I started posting like it's
 *    the 2000s again" rather than its slug). Read when the page mounts, and
 *    again when it changes size, which is how a title that arrives with the
 *    content is noticed.
 *  - `pastTitle`: that title has scrolled up under the running head.
 *  - `tierInView`: some of the masthead's atmosphere is still on screen.
 *
 *  IntersectionObservers rather than a scroll sweep: the browser tells us when
 *  either edge crosses the running head's bottom, and nothing is read per
 *  frame. The observers' top margin is the running head's height, measured. */
function useRunningHead({ mountedPath, topRef, tierWrapRef, tierMode }) {
  // What was found, and on which page: on the render a new page mounts, the
  // last page's title is still in state, and the trail named the new post
  // after the index it was opened from for a frame.
  const [found, setFound] = useState({ path: null, el: null, text: null });
  const titleEl = found.path === mountedPath ? found.el : null;
  const title = found.path === mountedPath ? found.text : null;
  const [pastTitle, setPastTitle] = useState(false);
  const [tierInView, setTierInView] = useState(true);
  const [headH, setHeadH] = useState(0);

  // The running head's height, for the observers' margin.
  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el) return undefined;
    const measure = () => setHeadH(Math.round(el.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [topRef]);

  // Find the page's title, and keep it current as the page fills in.
  useEffect(() => {
    const main = document.getElementById('main-content');
    if (!main) return undefined;
    let frame = 0;
    const find = () => {
      frame = 0;
      const page = main.querySelector('.route-transition') || main;
      // A title that isn't drawn (display: none) can't be scrolled past.
      const h1 = [...page.querySelectorAll('h1')].find((el) => el.getClientRects().length > 0) || null;
      const text = (h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '') || null;
      setFound((prev) =>
        prev.path === mountedPath && prev.el === h1 && prev.text === text
          ? prev
          : { path: mountedPath, el: h1, text },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(find);
    };
    find();
    const page = main.querySelector('.route-transition') || main;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (ro) ro.observe(page);
    window.addEventListener(ROUTE_SETTLED, schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (ro) ro.disconnect();
      window.removeEventListener(ROUTE_SETTLED, schedule);
    };
  }, [mountedPath]);

  // Past the title: its bottom edge is above the running head's bottom.
  useEffect(() => {
    if (!titleEl || typeof IntersectionObserver === 'undefined') {
      setPastTitle(false);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const top = entry.rootBounds ? entry.rootBounds.top : headH;
        setPastTitle(!entry.isIntersecting && entry.boundingClientRect.bottom <= top + 1);
      },
      { rootMargin: `-${headH}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(titleEl);
    return () => io.disconnect();
  }, [titleEl, headH]);

  // The masthead's atmosphere: is any of it below the running head?
  const tierPresent = tierMode !== 'closed';
  useEffect(() => {
    const el = tierWrapRef.current;
    if (!tierPresent || !el || typeof IntersectionObserver === 'undefined') {
      // Not drawn (on /admin) is not in view.
      setTierInView(tierPresent && !!el);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry) setTierInView(entry.isIntersecting);
      },
      { rootMargin: `-${headH}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tierPresent, tierWrapRef, headH]);

  return { title, hasTitle: !!titleEl, pastTitle, tierInView };
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

/** True once the window is scrolled past `threshold` px from the top. On a
 *  page with neither a title nor day sections, this is what counts as
 *  "reading": the trail takes the status's place in the running head once
 *  you've deliberately scrolled into the page, not on the first nudge. */
function useScrolledDown(threshold = 220) {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let frame = 0;
    function onScroll() {
      // Coalesce through rAF so the state flip never runs synchronously
      // inside the scroll event, keeping momentum scrolling smooth.
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

// Open/close timing for the atmosphere rows. Same curve and length the old
// height animation used, so the motion reads the same.
const TIER_SLIDE = { duration: 360, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
const TIER_ROW_FADE = { duration: 280, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' };
const TIER_ROW_DELAYS = [60, 100];

/** Opens and closes the atmosphere rows (LISTENING TO / FOLLOWED BY and the
 *  vitals bar) without changing the page's layout mid-animation. Used twice:
 *  for the masthead's rows, in the page, and for the peek, which brings them
 *  back over the page once the masthead has scrolled away.
 *
 *  It used to animate the rows' height. That moved everything below every
 *  frame, so each frame was a layout, and in Safari a repaint of the whole
 *  visible page, all of it driven from JavaScript on the main thread (which
 *  iOS Safari can also run at a lower frame rate than the screen). Fast
 *  phones still stuttered.
 *
 *  Now the layout changes once per toggle and everything that moves is a
 *  transform or opacity animation, which the browser runs on its
 *  compositor:
 *
 *  - While sliding, the rows are an overlay (`.is-sliding`): in the masthead,
 *    pinned at its top, so the page under it never changes size mid-slide;
 *    for the peek, pinned under `anchorRef` (the running head's row). The
 *    wrap slides down while its content counter-slides up by the same
 *    amount: the content stays put and is uncovered from the top, the same
 *    reveal the height animation gave. The wrap carries a bottom rule while
 *    sliding, so the line travels with the edge.
 *  - The followers (in the masthead: the trail strip under the rows and the
 *    page) translate by exactly how much of the rows is showing, so they stay
 *    butted against its edge. The peek has none; it covers the page.
 *  - Fully open, the masthead's rows join the flow and the transforms are
 *    dropped in the same commit, so nothing visibly moves. (The peek stays
 *    an overlay.) Fully closed, they unmount.
 *
 *  A toggle mid-slide starts from wherever the rows are. Returns the mode:
 *  'closed' | 'opening' | 'open' | 'closing'. */
function useTierSlide({ expanded, reduce, anchorRef = null, wrapRef, innerRef, followers }) {
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

    // Pin an anchored overlay right under its anchor, relative to the
    // containing block's padding box (what `top` resolves against).
    const anchor = anchorRef?.current;
    if (anchor && wrap) {
      const parent = wrap.parentElement;
      if (parent) {
        const top =
          anchor.getBoundingClientRect().bottom - parent.getBoundingClientRect().top - parent.clientTop;
        wrap.style.setProperty('--tier-top', `${top}px`);
      }
    }

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
    // half a pixel off from where the rows' real height puts the page.
    const height = inner.getBoundingClientRect().height;
    // How much of the rows is showing right now: read off the wrap's live
    // transform when a slide is mid-flight, otherwise all or nothing.
    let shown = prevMode === 'open' ? height : 0;
    if (running.length) {
      const ty = new DOMMatrixReadOnly(getComputedStyle(wrap).transform).m42;
      shown = Math.min(height, Math.max(0, height + ty));
    }
    for (const a of running) a.cancel();

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

/** The scrolled-past count, the only thing that re-renders per row: the
 *  number beside ↑ on a feed without day sections, or (`spoken`) the words a
 *  screen reader hears as part of the ↑ chip's name, "7 entries above". */
function ScrollCount({ store, spoken = false }) {
  const n = useSyncExternalStore(store.subscribe, store.get);
  if (spoken) {
    return <span className="visually-hidden">{`, ${n} ${n === 1 ? 'entry' : 'entries'} above`}</span>;
  }
  return <span aria-hidden="true">{n}</span>;
}
