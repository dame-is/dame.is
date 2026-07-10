import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { PAPER_ENABLED } from './hooks/usePaper.jsx';
import './styles/reset.css';
import './styles/theme.css';
import './styles/typography.css';
import './styles/app.css';
import './styles/paper.css';

// Theme selection happens here (before React mounts) so the first
// paint is in the correct palette. Two themes; retired monochrome
// variants alias to their color equivalent, and legacy/missing values
// fall to light. Keep VALID_THEMES + THEME_COLORS + THEME_ALIASES in
// sync with useTheme.jsx.
const VALID_THEMES = ['light', 'dark'];
const THEME_ALIASES = { 'light-mono': 'light', 'dark-mono': 'dark' };
const THEME_COLORS = {
  light: '#e3d8ba',
  dark: '#13180f',
};
const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('dame.theme') : null;
const resolvedStoredTheme = THEME_ALIASES[storedTheme] || storedTheme;
// Default to light for new visitors (and legacy `system` / other
// invalid values). Keep in sync with DEFAULT_THEME in useTheme.
const initialTheme = VALID_THEMES.includes(resolvedStoredTheme) ? resolvedStoredTheme : 'light';
document.documentElement.setAttribute('data-theme', initialTheme);

document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
const themeColorMeta = document.createElement('meta');
themeColorMeta.setAttribute('name', 'theme-color');
themeColorMeta.setAttribute('content', THEME_COLORS[initialTheme]);
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
