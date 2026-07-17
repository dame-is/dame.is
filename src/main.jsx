import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { PAPER_ENABLED } from './hooks/usePaper.jsx';
import { FONT_SWITCHER_ENABLED } from './hooks/useFont.jsx';
import { applySkyTheme, easternHour } from './lib/skyTheme.js';
import './styles/reset.css';
import './styles/theme.css';
import './styles/typography.css';
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

// The site runs a single, always-on theme: the hour-tracking sky mode.
// Set it here (before React mounts) so the first paint is in the right
// palette. The retired static light/dark themes are no longer selectable.
// Keep in sync with useTheme.jsx.
document.documentElement.setAttribute('data-theme', 'sky');

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
const storedPaper = typeof localStorage !== 'undefined' ? localStorage.getItem('dame.paper') : null;
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
const storedFont = typeof localStorage !== 'undefined' ? localStorage.getItem('dame.font') : null;
document.documentElement.setAttribute(
  'data-font',
  FONT_SWITCHER_ENABLED && VALID_FONTS.includes(storedFont) ? storedFont : 'serif',
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
