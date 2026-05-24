import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'dame.theme';
const VALID = ['light', 'dark', 'system'];

// Matches --surface-raised in theme.css. Used for the iOS Safari URL bar
// surround / Android browser chrome so the OS UI blends with the dame.is
// chrome bar instead of falling back to a system default that may not
// match the active site theme.
const THEME_COLOR = {
  light: '#e3d8ba',
  dark: '#13180f',
};

function resolveScheme(theme) {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  applyThemeColor(theme);
}

function applyThemeColor(theme) {
  if (typeof document === 'undefined') return;
  const head = document.head;
  // Wipe any existing theme-color metas (the two media-driven tags from
  // index.html on initial load, or whatever we last injected) so we
  // start clean and the OS doesn't see a stale combination.
  head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());

  if (theme === 'system') {
    // Hand the choice back to the OS via prefers-color-scheme so it
    // tracks the system toggle without a JS round-trip.
    for (const [scheme, content] of Object.entries(THEME_COLOR)) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('media', `(prefers-color-scheme: ${scheme})`);
      meta.setAttribute('content', content);
      head.appendChild(meta);
    }
    return;
  }
  // Explicit light/dark: a single tag without `media` pins the browser
  // chrome to our choice regardless of the OS preference.
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', THEME_COLOR[theme] || THEME_COLOR.light);
  head.appendChild(meta);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof localStorage === 'undefined') return 'system';
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID.includes(stored) ? stored : 'system';
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyThemeColor('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!VALID.includes(next)) return;
    setThemeState(next);
  }, []);

  const cycle = useCallback(() => {
    setThemeState((prev) => {
      const idx = VALID.indexOf(prev);
      return VALID[(idx + 1) % VALID.length];
    });
  }, []);

  const value = useMemo(() => ({ theme, setTheme, cycle, options: VALID }), [theme, setTheme, cycle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
