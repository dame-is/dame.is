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
  const scheme = resolveScheme(theme);
  const color = THEME_COLOR[scheme] || THEME_COLOR.light;

  head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', color);
  head.appendChild(meta);

  // iOS Safari re-evaluates its status bar / URL bar tint at the END of
  // a user gesture (touchend). If the meta swap above happens during
  // the gesture, Safari picks the new value up immediately; if it
  // happens after (e.g. inside a useEffect that runs post-render),
  // Safari uses the gesture's pre-update snapshot and doesn't refresh
  // until the next gesture. Calling this both sync from setTheme and
  // async from useEffect covers both timings.
  try {
    const y = window.scrollY || window.pageYOffset || 0;
    window.scrollTo(0, y + 1);
    requestAnimationFrame(() => {
      window.scrollTo(0, y);
    });
  } catch {}
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
    // Apply synchronously inside the click handler so iOS Safari sees
    // the updated theme-color meta during the same user gesture and
    // re-tints the status / URL bar surround on touchend. The useEffect
    // below also calls applyTheme; that's harmless (idempotent) but
    // happens too late for Safari's gesture-bound chrome refresh.
    applyTheme(next);
    setThemeState(next);
  }, []);

  const cycle = useCallback(() => {
    setThemeState((prev) => {
      const idx = VALID.indexOf(prev);
      const next = VALID[(idx + 1) % VALID.length];
      applyTheme(next);
      return next;
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
