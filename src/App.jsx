import { lazy, Suspense, useState } from 'react';
import { Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import Home from './pages/Home.jsx';
import About from './pages/About.jsx';
import Posting from './pages/Posting.jsx';
import Logging from './pages/Logging.jsx';
import Listening from './pages/Listening.jsx';
import Blogging from './pages/Blogging.jsx';
import BlogPost from './pages/BlogPost.jsx';
import Creating from './pages/Creating.jsx';
import CreatingWork from './pages/CreatingWork.jsx';
import RatioedPiece from './pages/RatioedPiece.jsx';
import Curating from './pages/Curating.jsx';
import CuratingChannel from './pages/CuratingChannel.jsx';
import Resume from './pages/Resume.jsx';
import Sharing from './pages/Sharing.jsx';
import Mothing from './pages/Mothing.jsx';
import Guestbook from './pages/Guestbook.jsx';
import Record from './pages/Record.jsx';
import NotFound from './pages/NotFound.jsx';
import { VERB_REGISTRY } from './lib/verbRegistry.js';

// Lazy: the ATProto OAuth + Agent bundle is heavy and only used by the owner.
const Admin = lazy(() => import('./pages/Admin.jsx'));
const OauthCallback = lazy(() => import('./pages/OauthCallback.jsx'));
// Lazy: the explorer transitively imports RecordEditor + @atproto/api.
const Exploring = lazy(() => import('./pages/Exploring.jsx'));
import ChromeBar from './components/ChromeBar.jsx';
import AutoUpdater from './components/AutoUpdater.jsx';
import ActionDock from './components/ActionDock.jsx';
import XrayLayer from './components/XrayLayer.jsx';
import EditModeBar from './components/EditModeBar.jsx';
import EditSheet from './components/EditSheet.jsx';
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
import { AtprotoSessionProvider } from './hooks/useAtprotoSession.jsx';
import { WaypointsModalProvider } from './hooks/useWaypointsModal.jsx';
import { FeedFooterProvider } from './hooks/useFeedFooter.jsx';
import { EditModeProvider } from './hooks/useEditMode.jsx';
import { XrayProvider } from './hooks/useXray.jsx';
import { AdminChromeProvider, useStackedViewport } from './hooks/useAdminChrome.jsx';
import './components/Xray.css';

/**
 * Verbs whose record page is handled by a bespoke page component (not the
 * generic `Record.jsx`). The shorthand `/posting/:rkey` etc. routes for
 * these verbs are declared explicitly below; everything else in the verb
 * registry gets registered automatically and falls through to Record.jsx.
 */
const BESPOKE_VERB_ROUTES = new Set(['blogging', 'creating']);

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

/**
 * Accessible "Skip to content" link — the first focusable element in the app,
 * so keyboard users can jump past the chrome nav straight to `<main>`. It's
 * visually hidden (parked off-screen) until focused, at which point it toggles
 * to an on-screen chip. Visibility is driven by inline style toggling so it
 * needs no external stylesheet.
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
  // `useStackedViewport` duplicates the admin's 60rem query rather than
  // importing it, and that is deliberate: importing the admin's copy would pull
  // the whole admin — and with it @atproto/api — into the eager bundle and undo
  // the `lazy()` above. The two must stay in step; useAdminChrome.jsx says so at
  // the constant, and AdminShell stamps the answer it reached onto <html> as
  // `data-admin-frame` so the frame's own geometry follows this decision rather
  // than guessing at it again in CSS.
  const inAdmin = location.pathname === '/admin';
  const stacked = useStackedViewport();
  const adminOwnsChrome = inAdmin && !stacked;
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
                  <Route path="/welcoming" element={<Guestbook />} />
                  {/* The guestbook presents as /welcoming ("dame is welcoming");
                      keep the old path working for any in-app navigation that
                      still targets it. Hard loads of /guestbook are 301'd to
                      /welcoming by vercel.json. */}
                  <Route path="/guestbook" element={<Navigate to="/welcoming" replace />} />
                  {generatedRecordRoutes()}
                  <Route
                    path="/admin"
                    element={
                      <ErrorBoundary resetKey={location.pathname}>
                        <Suspense fallback={<p className="placeholder-card">Loading admin…</p>}>
                          <Admin />
                        </Suspense>
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
                            <Suspense fallback={<p className="placeholder-card">Loading explorer…</p>}>
                              <Exploring />
                            </Suspense>
                          </ErrorBoundary>
                        }
                      />
                    ),
                  )}
                  <Route
                    path="/oauth/callback"
                    element={
                      <ErrorBoundary resetKey={location.pathname}>
                        <Suspense fallback={<p className="placeholder-card">Loading…</p>}>
                          <OauthCallback />
                        </Suspense>
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
            <EditModeBar />
            <EditSheet />
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
