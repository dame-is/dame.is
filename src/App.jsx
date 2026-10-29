import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import Home from './pages/Home.jsx';
// Where the first lazy page used to be imported: their CSS stays here.
import './lib/pageStyles.js';
import NotFound from './pages/NotFound.jsx';
import { VERB_REGISTRY } from './lib/verbRegistry.js';
import { GENERATED_INDEX_VERBS } from './lib/recordPlate.js';
import { isNightSlug } from './lib/mothing.js';
import { recoverFromChunkError } from './lib/chunkRecovery.js';

// Every page but the front door is its own chunk. They used to ship in the
// entry, so a first visit to / downloaded and parsed the résumé, Ratioed's
// analytics, the record pages and the rest before the feed could become
// interactive. Home stays eager because it is where most visits start, and
// NotFound because it is too small to be worth a request. Each page waits
// on its chunk inside its own frame (RouteTransition's Suspense), and once
// the first page has settled the rest are fetched on idle (see
// useWarmPageChunks), so moving around the site doesn't wait at all. Only
// the JavaScript moves out: the pages' stylesheets stay in the entry, in
// their old cascade position (see lib/pageStyles.js).
const pageChunks = [];
function page(load) {
  pageChunks.push(load);
  return lazy(recoverable(load));
}

// How long a failed chunk fetch waits before its one retry.
const CHUNK_RETRY_MS = 800;
// How long a page waits on its recovery reload before showing the error after
// all: a "Leave site?" prompt answered with Cancel keeps the old document here.
const RELOAD_GRACE_MS = 10_000;

/**
 * A lazy page's loader, made to survive a fetch that fails. React.lazy keeps
 * a rejected load for the life of the document, so a page that failed once
 * would fail on every later visit until a manual reload. So a failure gets one
 * retry, for a connection that dropped mid-request, and then a reload onto the
 * current build (lib/chunkRecovery.js), which is what a tab that has outlived
 * a deploy needs. A module with no page in it is api/asset-recovery's stub for
 * a chunk the deploy deleted, and is treated the same way. While the reload is
 * on its way the page's frame stays pending, rather than flashing the error.
 */
function recoverable(load) {
  return () =>
    load()
      .catch(() =>
        new Promise((resolve) => setTimeout(resolve, CHUNK_RETRY_MS)).then(
          load,
        ),
      )
      .then((mod) => {
        if (!mod?.default) throw new Error('Page chunk has no default export');
        return mod;
      })
      .catch((err) => {
        // Dev reloads itself, and a failed import there is a code error.
        if (!import.meta.env.PROD || !recoverFromChunkError()) throw err;
        return new Promise((_, reject) =>
          setTimeout(() => reject(err), RELOAD_GRACE_MS),
        );
      });
}

const About = page(() => import('./pages/About.jsx'));
const Posting = page(() => import('./pages/Posting.jsx'));
const Logging = page(() => import('./pages/Logging.jsx'));
const Listening = page(() => import('./pages/Listening.jsx'));
const ListeningAlbums = page(() => import('./pages/ListeningAlbums.jsx'));
const ListeningAlbum = page(() => import('./pages/ListeningAlbum.jsx'));
const Blogging = page(() => import('./pages/Blogging.jsx'));
const BlogPost = page(() => import('./pages/BlogPost.jsx'));
const Creating = page(() => import('./pages/Creating.jsx'));
const CreatingWork = page(() => import('./pages/CreatingWork.jsx'));
const RatioedPiece = page(() => import('./pages/RatioedPiece.jsx'));
const RatioedParticipant = page(() => import('./pages/RatioedParticipant.jsx'));
const RatioedParticipants = page(
  () => import('./pages/RatioedParticipants.jsx'),
);
const Curating = page(() => import('./pages/Curating.jsx'));
const CuratingChannel = page(() => import('./pages/CuratingChannel.jsx'));
const Resume = page(() => import('./pages/Resume.jsx'));
const Sharing = page(() => import('./pages/Sharing.jsx'));
const Mothing = page(() => import('./pages/Mothing.jsx'));
const MothingNight = page(() => import('./pages/MothingNight.jsx'));
const Guestbook = page(() => import('./pages/Guestbook.jsx'));
const Record = page(() => import('./pages/Record.jsx'));

// Lazy, and never warmed: the ATProto OAuth + Agent bundle is heavy and only
// used by the owner.
const Admin = lazy(recoverable(() => import('./pages/Admin.jsx')));
const OauthCallback = lazy(
  recoverable(() => import('./pages/OauthCallback.jsx')),
);
// Lazy and owner-only: the kit under four hours of sky.
const Colophon = lazy(recoverable(() => import('./pages/Colophon.jsx')));
// Lazy: the explorer transitively imports RecordEditor + @atproto/api.
const Exploring = lazy(recoverable(() => import('./pages/Exploring.jsx')));
// Lazy: the quick-edit sheet and the edit-mode bar are the owner's alone. See
// OwnerTools.
const EditSheet = lazy(() => import('./components/EditSheet.jsx'));
const EditModeBar = lazy(() => import('./components/EditModeBar.jsx'));
import ChromeBar from './components/ChromeBar.jsx';
import AutoUpdater from './components/AutoUpdater.jsx';
import ActionDock from './components/ActionDock.jsx';
import XrayLayer from './components/XrayLayer.jsx';
// The edit-mode bar's code is lazy (OwnerTools); its stylesheet stays here, in
// the cascade position it had when the bar was imported at this spot.
import './components/EditModeBar.css';
import RouteTransition from './components/RouteTransition.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ActionDockProvider } from './hooks/useActionDock.jsx';
import { ChromePanelProvider } from './hooks/useChromePanel.jsx';
import { ThemeProvider } from './hooks/useTheme.jsx';
import { FontProvider } from './hooks/useFont.jsx';
import { FeedLayoutProvider } from './hooks/useFeedLayout.jsx';
import { PaperProvider } from './hooks/usePaper.jsx';
import { ChromeBarProvider } from './hooks/useChromeBar.jsx';
import { FeedFilterProvider } from './hooks/useFeedFilter.jsx';
import {
  AtprotoSessionProvider,
  useAtprotoSession,
} from './hooks/useAtprotoSession.jsx';
import { WaypointsModalProvider } from './hooks/useWaypointsModal.jsx';
import { FeedFooterProvider } from './hooks/useFeedFooter.jsx';
import { EditModeProvider, useEditMode } from './hooks/useEditMode.jsx';
import { XrayProvider } from './hooks/useXray.jsx';
import { AdminChromeProvider, useStackedViewport } from './hooks/useAdminChrome.jsx';
import { ME_DID, RATIOED_PATH } from './config.js';
import './components/Xray.css';

/**
 * Verbs whose short `/{verb}/:rkey` route is declared by hand below rather
 * than generated. Blogging and creating have their own page components;
 * mothing keeps the generic `Record.jsx` but shares its path with the
 * per-night galleries, so it needs the dispatcher in `MothingLeaf`.
 */
const BESPOKE_VERB_ROUTES = new Set(['blogging', 'creating', 'mothing']);

/**
 * `/mothing/:rkey` addresses two different things, and the shape of the
 * segment decides which. A date (`2026-08-18`) names a NIGHT — one session at
 * the light, drawn as a gallery. Anything else is an iNaturalist observation
 * id, which the generic record page renders. An id is a bare integer, so the
 * two forms can never collide and one route can serve both.
 */
function MothingLeaf() {
  const { rkey } = useParams();
  return isNightSlug(rkey) ? <MothingNight /> : <Record verb="mothing" />;
}

/**
 * Build `<Route>` entries for every verb / NSID in the registry. Each
 * verb gets:
 *   - `/{verb}/:rkey`  (the short form)
 *   - `/{nsid}/:rkey`  (the lexicon form) for each of the verb's NSIDs.
 *
 * Verbs that already have hand-written pages (e.g. `/blogging/:slug` →
 * BlogPost.jsx) skip the short form so we don't fight over the same path.
 */
function generatedRecordRoutes() {
  const out = [];
  // Verbs with no page of their own get one at `/{verb}`: the home ledger
  // filtered to that verb, under "dame is reposting". Their record pages'
  // crumbs and "up" lead here (lib/recordPlate.js), where they used to lead
  // to the not-found page.
  for (const verb of GENERATED_INDEX_VERBS) {
    out.push(<Route key={`i:${verb}`} path={`/${verb}`} element={<Home key={verb} verb={verb} />} />);
  }
  for (const v of VERB_REGISTRY) {
    if (!BESPOKE_VERB_ROUTES.has(v.verb)) {
      out.push(
        <Route key={`v:${v.verb}`} path={`/${v.verb}/:rkey`} element={<Record verb={v.verb} />} />,
      );
    }
    for (const c of v.collections) {
      out.push(
        <Route
          key={`n:${c.nsid}`}
          path={`/${c.nsid}/:rkey`}
          element={<Record verb={v.verb} nsid={c.nsid} source={c.source} />}
        />,
      );
    }
  }
  return out;
}

// The résumé page moved from /for-hire to /available. Hard loads of the old
// path are 301'd by vercel.json; this handles any in-app navigation that still
// targets /for-hire, preserving a version slug when one is present.
function ForHireRedirect() {
  const { slug } = useParams();
  return <Navigate to={slug ? `/available/${slug}` : '/available'} replace />;
}

// How long after the page has loaded before the other pages' chunks are
// fetched: long enough that the first page's own data requests and images
// have the connection to themselves.
const WARM_AFTER_LOAD_MS = 2500;

/**
 * Fetch the lazy pages' chunks one at a time in idle moments once the first
 * page has settled, so a later navigation finds its code already here. The
 * bytes are the ones the entry used to carry; they just no longer stand
 * between a visitor and the first page. Skipped under Data Saver, where
 * each page's chunk loads when it is visited instead.
 */
function useWarmPageChunks() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (navigator.connection?.saveData) return undefined;
    const idle = window.requestIdleCallback
      ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => window.setTimeout(cb, 200);
    const cancelIdle = window.cancelIdleCallback || window.clearTimeout;
    const queue = [...pageChunks];
    let cancelled = false;
    let timer = 0;
    let handle = 0;
    const next = () => {
      const load = queue.shift();
      if (cancelled || !load) return;
      load()
        .catch(() => {
          // Left to the visit: the page's own loader retries, and failing
          // that reloads onto the current build (see recoverable).
        })
        .finally(() => {
          if (!cancelled) handle = idle(next);
        });
    };
    const start = () => {
      timer = window.setTimeout(() => {
        handle = idle(next);
      }, WARM_AFTER_LOAD_MS);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', start);
      window.clearTimeout(timer);
      cancelIdle(handle);
    };
  }, []);
}

/**
 * The owner's edit-mode bar and quick-edit sheet, mounted the first time they
 * could be needed — the owner is signed in, edit mode is on, or a sheet has
 * been asked for — and kept mounted after that so their close animations can
 * play. Until then visitors never download them.
 */
function OwnerTools() {
  const { active, editSheet } = useEditMode();
  const { did } = useAtprotoSession();
  const [wanted, setWanted] = useState(false);
  if (!wanted && (did === ME_DID || active || editSheet)) setWanted(true);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <EditModeBar />
      <EditSheet />
    </Suspense>
  );
}

/**
 * Accessible "Skip to content" link — the first focusable element in the app,
 * so keyboard users can jump past the chrome nav straight to `<main>`. It's
 * visually hidden (parked off-screen) until focused, at which point it toggles
 * to an on-screen chip. Visibility is driven by inline style toggling so it
 * needs no external stylesheet.
 *
 * The click is handled rather than left to the fragment: a native jump to
 * `#main-content` pushed a history entry, so the next Back press only
 * removed the hash and visibly did nothing, and the hash rode along in any
 * URL copied afterwards. The href stays for what it says to assistive tech.
 */
function SkipLink() {
  const [focused, setFocused] = useState(false);
  const base = { position: 'absolute', zIndex: 1000 };
  const style = focused
    ? {
        ...base,
        left: 'var(--space-2, 0.5rem)',
        top: 'var(--space-2, 0.5rem)',
        padding: 'var(--space-2, 0.5rem) var(--space-4, 1rem)',
        background: 'var(--surface-raised, #e3d8ba)',
        color: 'var(--ink, #1d2419)',
        border: '1px solid var(--ink, #1d2419)',
        borderRadius: 'var(--radius-1, 0)',
        fontSize: 'var(--text-sm, 0.875rem)',
      }
    : { ...base, left: '-9999px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' };
  return (
    <a
      href="#main-content"
      style={style}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={(e) => {
        e.preventDefault();
        const main = document.getElementById('main-content');
        main?.focus({ preventScroll: true });
        main?.scrollIntoView({ block: 'start' });
      }}
    >
      Skip to content
    </a>
  );
}

export default function App() {
  const location = useLocation();
  // The admin wears the site's chrome on a phone and its own on a desktop.
  //
  // On a desktop it is a tool, not a page: three panes want the whole viewport,
  // and the breadcrumb has nowhere to live in the site's bars, so AdminShell
  // draws its own top bar and ChromeBar stays out of the way.
  //
  // On a phone the calculation inverts. There is only one column either way, so
  // the admin gains nothing by owning the frame — and it loses: its own bar and
  // the browser's own toolbar stack up at the bottom of a ~660px viewport, and
  // the site's hour, theme and home controls disappear exactly where they are
  // most useful. So below the breakpoint the site's chrome comes back and the
  // admin publishes its surface, its primary action and its state into the
  // bottom bar through AdminChromeProvider.
  //
  // `useStackedViewport` duplicates the admin's 62rem query rather than
  // importing it, and that is deliberate: importing the admin's copy would pull
  // the whole admin — and with it @atproto/api — into the eager bundle and undo
  // the `lazy()` above. The two must stay in step; useAdminChrome.jsx says so at
  // the constant, and AdminShell stamps the answer it reached onto <html> as
  // `data-admin-frame` so the frame's own geometry follows this decision rather
  // than guessing at it again in CSS.
  const inAdmin = location.pathname === '/admin';
  const stacked = useStackedViewport();
  const adminOwnsChrome = inAdmin && !stacked;
  useWarmPageChunks();
  return (
    <ThemeProvider>
      <FontProvider>
      <FeedLayoutProvider>
      <PaperProvider>
      <ChromeBarProvider>
      <AtprotoSessionProvider>
      <FeedFilterProvider>
      <ActionDockProvider>
      <ChromePanelProvider>
      <WaypointsModalProvider>
      <EditModeProvider>
      <XrayProvider>
      <FeedFooterProvider>
      <AdminChromeProvider>
          <div className={`app-shell${adminOwnsChrome ? ' app-shell-admin' : ''}`}>
            <SkipLink />
            {!adminOwnsChrome && <ChromeBar />}
            <main id="main-content" tabIndex={-1} className="layout">
              <div className="main">
                <ErrorBoundary resetKey={location.pathname}>
                <RouteTransition>
                  <Route path="/" element={<Home />} />
                  <Route path="/themself" element={<About />} />
                  <Route path="/posting" element={<Posting />} />
                  <Route path="/logging" element={<Logging />} />
                  <Route path="/listening" element={<Listening />} />
                  {/* Albums are derived from the plays rather than scrobbled,
                      so they live under /listening instead of at a verb of
                      their own. `albums` is a static segment and so outranks
                      the generated `/listening/:rkey` — a play whose record key
                      spelled the word could never shadow the shelf. */}
                  <Route path="/listening/albums" element={<ListeningAlbums />} />
                  <Route path="/listening/albums/:slug" element={<ListeningAlbum />} />
                  <Route path="/blogging" element={<Blogging />} />
                  <Route path="/blogging/:slug" element={<BlogPost />} />
                  <Route path="/creating" element={<Creating />} />
                  <Route path="/creating/:slug" element={<CreatingWork />} />
                  {/* A work can have pieces of its own. Ratioed does — thirteen
                      so far — and each is a record with more in it than the
                      essay's charts can show at that altitude. Keyed on :slug
                      rather than a literal, so the page answers under whichever
                      address the essay is reachable at (its path OR its record
                      key); the component itself checks the parent is Ratioed. */}
                  {/* The roster as its own page: a ranking of everyone who was
                      there while a piece was still standing. `participants` is
                      a static segment, so it outranks `:piece` in the route
                      ranking and a take numbered 01 can never be shadowed. */}
                  <Route path="/creating/:slug/participants" element={<RatioedParticipants />} />
                  {/* One person, read along the other axis: every piece they
                      were in, in order, either side of each seal. A segment
                      longer than a piece's URL, so the two cannot collide. */}
                  <Route
                    path="/creating/:slug/participant/:handle"
                    element={<RatioedParticipant />}
                  />
                  <Route path="/creating/:slug/:piece" element={<RatioedPiece />} />
                  <Route path="/curating" element={<Curating />} />
                  <Route path="/curating/:slug" element={<CuratingChannel />} />
                  <Route path="/available" element={<Resume />} />
                  <Route path="/available/:slug" element={<Resume />} />
                  {/* Legacy résumé URL → canonical /available. */}
                  <Route path="/for-hire" element={<ForHireRedirect />} />
                  <Route path="/for-hire/:slug" element={<ForHireRedirect />} />
                  <Route path="/sharing" element={<Sharing />} />
                  <Route path="/mothing" element={<Mothing />} />
                  <Route path="/mothing/:rkey" element={<MothingLeaf />} />
                  <Route path="/welcoming" element={<Guestbook />} />
                  {/* The guestbook presents as /welcoming ("dame is welcoming");
                      keep the old path working for any in-app navigation that
                      still targets it. Hard loads of /guestbook are 301'd to
                      /welcoming by vercel.json. */}
                  <Route path="/guestbook" element={<Navigate to="/welcoming" replace />} />
                  {/* The roster is Ratioed's, and lives under Ratioed. This is
                      the short address for it, the way /guestbook above is the
                      short address for the page it redirects to. */}
                  <Route
                    path="/participants"
                    element={<Navigate to={`/creating/${RATIOED_PATH}/participants`} replace />}
                  />
                  {generatedRecordRoutes()}
                  <Route path="/colophon" element={<Colophon />} />
                  <Route
                    path="/admin"
                    element={
                      <ErrorBoundary resetKey={location.pathname}>
                        <Admin />
                      </ErrorBoundary>
                    }
                  />
                  {['/exploring', '/exploring/:repo', '/exploring/:repo/:collection', '/exploring/:repo/:collection/:rkey'].map(
                    (path) => (
                      <Route
                        key={path}
                        path={path}
                        element={
                          <ErrorBoundary resetKey={location.pathname}>
                            <Exploring />
                          </ErrorBoundary>
                        }
                      />
                    ),
                  )}
                  <Route
                    path="/oauth/callback"
                    element={
                      <ErrorBoundary resetKey={location.pathname}>
                        <OauthCallback />
                      </ErrorBoundary>
                    }
                  />
                  <Route path="*" element={<NotFound />} />
                </RouteTransition>
                </ErrorBoundary>
              </div>
            </main>
            <ActionDock />
            <XrayLayer />
            <OwnerTools />
            <AutoUpdater />
            <Analytics />
          </div>
      </AdminChromeProvider>
      </FeedFooterProvider>
      </XrayProvider>
      </EditModeProvider>
      </WaypointsModalProvider>
      </ChromePanelProvider>
      </ActionDockProvider>
      </FeedFilterProvider>
      </AtprotoSessionProvider>
      </ChromeBarProvider>
      </PaperProvider>
      </FeedLayoutProvider>
      </FontProvider>
    </ThemeProvider>
  );
}
