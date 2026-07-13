import { lazy, Suspense } from 'react';
import { Route } from 'react-router-dom';
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
import EditModeBar from './components/EditModeBar.jsx';
import EditSheet from './components/EditSheet.jsx';
import RouteTransition from './components/RouteTransition.jsx';
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

export default function App() {
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
      <FeedFooterProvider>
          <div className="app-shell">
            <ChromeBar />
            <main className="layout">
              <div className="main">
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
                  <Route path="/curating" element={<Curating />} />
                  <Route path="/curating/:slug" element={<CuratingChannel />} />
                  <Route path="/for-hire" element={<Resume />} />
                  <Route path="/for-hire/:slug" element={<Resume />} />
                  <Route path="/sharing" element={<Sharing />} />
                  <Route path="/mothing" element={<Mothing />} />
                  <Route path="/guestbook" element={<Guestbook />} />
                  {generatedRecordRoutes()}
                  <Route
                    path="/admin"
                    element={
                      <Suspense fallback={<p className="placeholder-card">Loading admin…</p>}>
                        <Admin />
                      </Suspense>
                    }
                  />
                  {['/exploring', '/exploring/:repo', '/exploring/:repo/:collection', '/exploring/:repo/:collection/:rkey'].map(
                    (path) => (
                      <Route
                        key={path}
                        path={path}
                        element={
                          <Suspense fallback={<p className="placeholder-card">Loading explorer…</p>}>
                            <Exploring />
                          </Suspense>
                        }
                      />
                    ),
                  )}
                  <Route
                    path="/oauth/callback"
                    element={
                      <Suspense fallback={<p className="placeholder-card">Loading…</p>}>
                        <OauthCallback />
                      </Suspense>
                    }
                  />
                  <Route path="*" element={<NotFound />} />
                </RouteTransition>
              </div>
            </main>
            <ActionDock />
            <EditModeBar />
            <EditSheet />
            <AutoUpdater />
            <Analytics />
          </div>
      </FeedFooterProvider>
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
