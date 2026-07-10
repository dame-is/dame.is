import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  applySkyTheme,
  clearSkyTheme,
  easternHour,
  secondsUntilNextHour,
  skyHourKey,
} from '../lib/skyTheme.js';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'dame.theme';

// Three themes: warm light, dark green, and the hour-tracking sky mode
// (palette derived from the current sky-avatar frame — see
// src/lib/skyTheme.js). The toggle cycles light → dark → sky.
const VALID = ['light', 'dark', 'sky'];

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
// The sky theme has no fixed value — its color comes from the hour's
// computed palette in applyTheme.
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

function applyTheme(theme, skyHour) {
  document.documentElement.setAttribute('data-theme', theme);
  let color = THEME_COLOR[theme] || THEME_COLOR.light;
  if (theme === 'sky') {
    const palette = applySkyTheme(skyHour ?? easternHour());
    color = palette.themeColor;
  } else {
    clearSkyTheme();
  }
  applyThemeColor(color);
}

function applyThemeColor(color) {
  if (typeof document === 'undefined') return;
  const head = document.head;

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

  // Sky mode's clock. `liveHour` tracks the real Eastern hour; the
  // override (driven by the temporary test button in the bottom bar)
  // freezes the palette on an arbitrary hour so each step can be
  // inspected. Leaving sky mode drops the override.
  const [liveHour, setLiveHour] = useState(() => easternHour());
  const [skyOverride, setSkyOverride] = useState(null);
  const skyHour = skyOverride ?? liveHour;
  // Mirror for callbacks that need the current hour without re-binding.
  const skyHourRef = useRef(skyHour);
  skyHourRef.current = skyHour;

  useEffect(() => {
    applyTheme(theme, skyHour);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme, skyHour]);

  // While in sky mode, tick the palette over at the top of each Eastern
  // hour (minutes/seconds track UTC, so the boundary is computable
  // locally). Timers sleep in background tabs, so visibility-return also
  // re-reads the clock — same pattern as the avatar's refresh tick.
  useEffect(() => {
    if (theme !== 'sky') return undefined;
    let timer;
    const schedule = () => {
      // Small pad past the boundary so a clamped/early timer can't land
      // still inside the old hour and stall until the next one.
      timer = setTimeout(() => {
        setLiveHour(easternHour());
        schedule();
      }, secondsUntilNextHour() * 1000 + 1000);
    };
    schedule();
    const onVisible = () => {
      if (!document.hidden) setLiveHour(easternHour());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!VALID.includes(next)) return;
    // Apply synchronously inside the click handler so iOS Safari sees
    // the updated theme-color meta during the same user gesture.
    applyTheme(next, skyHourRef.current);
    setThemeState(next);
    if (next !== 'sky') setSkyOverride(null);
  }, []);

  const cycle = useCallback(() => {
    setThemeState((prev) => {
      const idx = VALID.indexOf(prev);
      const next = VALID[(idx + 1) % VALID.length];
      applyTheme(next, skyHourRef.current);
      if (next !== 'sky') setSkyOverride(null);
      return next;
    });
  }, []);

  // TEMPORARY (sky-theme testing): step the sky palette forward one hour
  // per call, wrapping at midnight. Wired to the hour chip in the bottom
  // chrome bar so each of the 24 increments can be eyeballed in place.
  const advanceSkyHour = useCallback(() => {
    const next = (skyHourRef.current + 1) % 24;
    // Sync apply for the same iOS theme-color gesture reason as setTheme.
    applyTheme('sky', next);
    setSkyOverride(next);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      cycle,
      options: VALID,
      skyHour,
      skyHourKey: skyHourKey(skyHour),
      skyOverridden: skyOverride != null,
      advanceSkyHour,
    }),
    [theme, setTheme, cycle, skyHour, skyOverride, advanceSkyHour],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
