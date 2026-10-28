// First, before anything that might touch storage evaluates: a browser that
// blocks site data makes `window.localStorage` itself throw. See the module.
import { readStorage } from './lib/storageGuard.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { PAPER_ENABLED } from './hooks/usePaper.jsx';
import { FONT_SWITCHER_ENABLED } from './hooks/useFont.jsx';
import { applySkyTheme, easternHour, setSkyTuning } from './lib/skyTheme.js';
import { recoverFromChunkError } from './lib/chunkRecovery.js';
import bakedSkyTuning from 'virtual:sky-tuning';
import './styles/reset.css';
import './styles/theme.css';
import './styles/typography.css';
import './styles/controls.css';
import './styles/app.css';
import './styles/paper.css';

// We're running, so the entry module loaded — the boot-recovery reload in
// index.html (if it fired) succeeded. Strip its one-shot "_r" cache-bust param
// before React mounts, so the router only ever sees the clean URL and a future
// deploy's stale shell can trigger a fresh recovery.
try {
  const url = new URL(window.location.href);
  if (url.searchParams.has('_r')) {
    url.searchParams.delete('_r');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
} catch {
  /* URL/history unavailable — nothing to clean up */
}
// That also ends the "_r" guard for the rest of this page's life, but most
// pages are lazy chunks fetched from here on. So api/asset-recovery.js's stub
// for a missing chunk hands its reload to the app's own recovery, whose guard
// survives the reload, rather than looping on a deploy that lacks the chunk.
window.__dameRecoverChunk = () => recoverFromChunkError();

// Scroll positions are restored by the app, not the browser — the browser
// restores a Back at popstate time, against the page that is still fading
// out, and long before a feed has loaded. RouteTransition.jsx explains.
try {
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }
} catch {
  /* history unavailable — the browser keeps its own behaviour */
}

// The site runs a single, always-on theme: the hour-tracking sky mode.
// Set it here (before React mounts) so the first paint is in the right
// palette. The retired static light/dark themes are no longer selectable.
// Keep in sync with useTheme.jsx. (index.html's inline boot script has
// usually set it already, along with this hour's page colour, so the paint
// before this bundle arrives isn't the unstyled parchment :root.)
document.documentElement.setAttribute('data-theme', 'sky');

// The owner's is.dame.sky tuning as it stood at build time — `npm run build`
// prefetches the record into public/data/sky.json before bundling. Installed
// before the paint below, because ThemeProvider only fetches it after React
// mounts: until then every daytime load painted the untuned derivation and
// then repainted a moment later (at 6am, brown to navy). ThemeProvider still
// fetches the snapshot and the live record, and only repaints if they differ.
//
// Served by vite.config.js, already normalised, from the same reading that
// writes index.html's boot table. public/data/ is gitignored and only exists
// after a prefetch, so on a fresh clone's `npm run dev`, or a `build:offline`,
// it is null.
if (bakedSkyTuning) setSkyTuning(bakedSkyTuning);

// Sky mode's palette is computed per hour, not static — derive this
// hour's tokens before the first paint and take the browser-chrome tint
// from them.
const initialThemeColor = applySkyTheme(easternHour()).themeColor;

document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
const themeColorMeta = document.createElement('meta');
themeColorMeta.setAttribute('name', 'theme-color');
themeColorMeta.setAttribute('content', initialThemeColor);
document.head.appendChild(themeColorMeta);

// Paper texture behind long-form text (blank / ruled / dots). Set before
// the first paint so ruled/dots users don't flash a blank page. The
// feature is currently paused (PAPER_ENABLED = false), so this always
// resolves to blank; the stored preference is left in place for when it
// returns. Keep in sync with usePaper.jsx.
const VALID_PAPER = ['blank', 'ruled', 'dots'];
const storedPaper = readStorage('dame.paper');
document.documentElement.setAttribute(
  'data-paper',
  PAPER_ENABLED && VALID_PAPER.includes(storedPaper) ? storedPaper : 'blank',
);

// Font mode. The switcher is hidden and the site runs serif-only, so this
// resolves to 'serif' regardless of any stored preference. Set before the
// first paint so the ledger columns render in the serif voice from the
// start. When FONT_SWITCHER_ENABLED is flipped back on in useFont.jsx the
// stored preference is honoured again (default serif). Keep in sync.
const VALID_FONTS = ['mixed', 'serif'];
const storedFont = readStorage('dame.font');
document.documentElement.setAttribute(
  'data-font',
  FONT_SWITCHER_ENABLED && VALID_FONTS.includes(storedFont) ? storedFont : 'serif',
);

// middleware.js server-renders a plain-HTML summary of the page inside #root
// for readers that never run this bundle (AI crawlers, agents, text browsers —
// see og/ssrContent.js). An inline script in the shell has already hidden it,
// so nobody has seen it; remove it before mounting so React starts from an
// empty container rather than relying on createRoot to clear one for us.
document.getElementById('ssr-fallback')?.remove();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
