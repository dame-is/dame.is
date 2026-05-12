import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import About from './pages/About.jsx';
import Posting from './pages/Posting.jsx';
import Logging from './pages/Logging.jsx';
import Blogging from './pages/Blogging.jsx';
import BlogPost from './pages/BlogPost.jsx';
import Creating from './pages/Creating.jsx';
import CreatingWork from './pages/CreatingWork.jsx';
import Sharing from './pages/Sharing.jsx';
import Record from './pages/Record.jsx';
import NotFound from './pages/NotFound.jsx';
import ChromeBar from './components/ChromeBar.jsx';
import ActionDock from './components/ActionDock.jsx';
import Footer from './components/Footer.jsx';
import DebugOverlay from './components/DebugOverlay.jsx';
import BookOpenIntro from './components/BookOpenIntro.jsx';
import { ActionDockProvider } from './hooks/useActionDock.jsx';
import { ThemeProvider } from './hooks/useTheme.jsx';
import { TypefaceProvider } from './hooks/useTypeface.jsx';
import { DebugOverlayProvider } from './hooks/useDebugOverlay.jsx';
import { ChromeBarProvider } from './hooks/useChromeBar.jsx';

export default function App() {
  return (
    <ThemeProvider>
      <TypefaceProvider>
      <ChromeBarProvider>
      <ActionDockProvider>
        <DebugOverlayProvider>
          <div className="app-shell">
            <ChromeBar />
            <main className="layout">
              <div className="main">
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/posting" element={<Posting />} />
                  <Route path="/posting/:rkey" element={<Record verb="posting" />} />
                  <Route path="/app.bsky.feed.post/:rkey" element={<Record verb="posting" />} />
                  <Route path="/logging" element={<Logging />} />
                  <Route path="/logging/:rkey" element={<Record verb="logging" />} />
                  <Route path="/is.dame.now/:rkey" element={<Record verb="logging" />} />
                  <Route path="/listening/:rkey" element={<Record verb="listening" />} />
                  <Route path="/fm.teal.alpha.feed.play/:rkey" element={<Record verb="listening" />} />
                  <Route path="/blogging" element={<Blogging />} />
                  <Route path="/blogging/:slug" element={<BlogPost />} />
                  <Route path="/is.dame.blogging.post/:rkey" element={<Record verb="blogging" />} />
                  <Route path="/creating" element={<Creating />} />
                  <Route path="/creating/:slug" element={<CreatingWork />} />
                  <Route path="/is.dame.creating.work/:rkey" element={<Record verb="creating" />} />
                  <Route path="/sharing" element={<Sharing />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </div>
            </main>
            <Footer />
            <ActionDock />
            <DebugOverlay />
            <BookOpenIntro />
          </div>
        </DebugOverlayProvider>
      </ActionDockProvider>
      </ChromeBarProvider>
      </TypefaceProvider>
    </ThemeProvider>
  );
}
