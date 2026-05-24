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

const initialScheme = initialTheme === 'system'
  ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  : initialTheme;
const initialThemeColor = initialScheme === 'dark' ? '#161c12' : '#e6dec3';
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
if (themeColorMeta) themeColorMeta.setAttribute('content', initialThemeColor);

const storedTypeface = typeof localStorage !== 'undefined' ? localStorage.getItem('dame.typeface') : null;
const initialTypeface = ['combo', 'serif', 'sans'].includes(storedTypeface) ? storedTypeface : 'combo';
document.documentElement.setAttribute('data-typeface', initialTypeface);

// Density: read the new tri-state key first, fall back to the legacy
// boolean `dame.compact` so users with the old setting don't lose it.
const VALID_DENSITY = ['normal', 'compact', 'tight'];
let storedDensity = typeof localStorage !== 'undefined' ? localStorage.getItem('dame.density') : null;
if (!VALID_DENSITY.includes(storedDensity)) {
  const legacyCompact = typeof localStorage !== 'undefined' ? localStorage.getItem('dame.compact') : null;
  storedDensity = legacyCompact === 'true' ? 'compact' : 'normal';
}
document.documentElement.setAttribute('data-density', storedDensity);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
