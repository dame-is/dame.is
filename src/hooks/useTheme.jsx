import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'dame.theme';
const VALID = ['light', 'dark', 'system'];

// Matches --page-edge in theme.css. Used for the iOS Safari URL bar
// surround / Android browser chrome so the OS UI blends with the dame.is
// chrome bar instead of falling back to a system default that may not
// match the active site theme.
const THEME_COLOR = {
  light: '#e6dec3',
  dark: '#161c12',
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
  const scheme = resolveScheme(theme);
  const color = THEME_COLOR[scheme] || THEME_COLOR.light;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
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
