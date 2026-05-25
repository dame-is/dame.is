import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/reset.css';
import './styles/theme.css';
import './styles/typography.css';
import './styles/app.css';

const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('dame.theme') : null;
const initialTheme = storedTheme || 'system';
document.documentElement.setAttribute('data-theme', initialTheme);

// Reconcile theme-color on first paint when the user has an explicit
// stored theme that differs from the OS preference. Without this, the
// media-driven tags in index.html would briefly tint Safari's chrome
// according to the OS until <ThemeProvider> mounts and corrects it.
const initialScheme = initialTheme === 'system'
  ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  : initialTheme;
const initialThemeColor = initialScheme === 'dark' ? '#13180f' : '#e3d8ba';
document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
const themeColorMeta = document.createElement('meta');
themeColorMeta.setAttribute('name', 'theme-color');
themeColorMeta.setAttribute('content', initialThemeColor);
document.head.appendChild(themeColorMeta);

document.documentElement.setAttribute('data-typeface', 'combo');

// Density: read the new tri-state key first, fall back to the legacy
// boolean `dame.compact` so users with the old setting don't lose it.
const VALID_DENSITY = ['normal', 'compact', 'tight'];
let storedDensity = typeof localStorage !== 'undefined' ? localStorage.getItem('dame.density') : null;
if (!VALID_DENSITY.includes(storedDensity)) {
  const legacyCompact = typeof localStorage !== 'undefined' ? localStorage.getItem('dame.compact') : null;
  storedDensity = legacyCompact === 'true' ? 'compact' : 'normal';
}
document.documentElement.setAttribute('data-density', storedDensity);

// Film grain: apply the saved preference before React mounts so the
// overlay paints (or doesn't) on the first frame instead of flashing
// in once <FilmGrainProvider> hydrates. Feature is currently dormant —
// the toggle UI is hidden and the default is off; keep this read so a
// future revival picks up any preference users had previously set.
const VALID_GRAIN = ['on', 'off'];
let storedGrain = typeof localStorage !== 'undefined' ? localStorage.getItem('dame.grain') : null;
if (!VALID_GRAIN.includes(storedGrain)) storedGrain = 'off';
document.documentElement.setAttribute('data-grain', storedGrain);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
