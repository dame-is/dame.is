import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'dame.theme';

// Two themes: warm light and dark green. The toggle flips between them.
const VALID = ['light', 'dark'];

// Retired monochrome variants map to their color equivalent so a
// returning visitor who last used a mono theme keeps its light/dark
// polarity instead of being reset to the default.
const THEME_ALIAS = {
  'light-mono': 'light',
  'dark-mono': 'dark',
};

// Matches --surface-raised in theme.css. Used for the iOS Safari URL
// bar surround / Android browser chrome so the OS UI blends with the
// dame.is chrome bar instead of falling back to a system default.
const THEME_COLOR = {
  light: '#e3d8ba',
  dark: '#13180f',
};

const DEFAULT_THEME = 'light';

function migrateStoredTheme(stored) {
  const resolved = THEME_ALIAS[stored] || stored;
  if (VALID.includes(resolved)) return resolved;
  // Legacy / missing values land on the light theme so new visitors
  // get a predictable first paint — they can flip to dark from the
  // chrome bar.
  return DEFAULT_THEME;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  applyThemeColor(theme);
}

function applyThemeColor(theme) {
  if (typeof document === 'undefined') return;
  const head = document.head;
  const color = THEME_COLOR[theme] || THEME_COLOR.light;

  head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', color);
  head.appendChild(meta);

  // iOS Safari re-evaluates its status bar / URL bar tint at the END
  // of a user gesture (touchend). Nudging a 1px scroll provokes the
  // re-tint pass; without this, the chrome stays on the previous
  // theme's color until the next scroll/tap.
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
    if (typeof localStorage === 'undefined') return DEFAULT_THEME;
    return migrateStoredTheme(localStorage.getItem(STORAGE_KEY));
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!VALID.includes(next)) return;
    // Apply synchronously inside the click handler so iOS Safari sees
    // the updated theme-color meta during the same user gesture.
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

  const value = useMemo(
    () => ({ theme, setTheme, cycle, options: VALID }),
    [theme, setTheme, cycle],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
