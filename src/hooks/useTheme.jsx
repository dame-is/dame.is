import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  applySkyTheme,
  easternHour,
  secondsUntilNextHour,
  skyHourKey,
} from '../lib/skyTheme.js';

const ThemeContext = createContext(null);

// The site runs a single, always-on theme: the hour-tracking "sky" mode,
// whose palette is derived from the current sky-avatar frame (see
// src/lib/skyTheme.js). The retired static light/dark themes and their
// switcher have been removed from the chrome — only the sky clock's time
// switcher survives (the hour chip in the bottom bar), which steps the
// palette through the day by hand.
const THEME = 'sky';

function applyTheme(skyHour) {
  document.documentElement.setAttribute('data-theme', THEME);
  const palette = applySkyTheme(skyHour ?? easternHour());
  applyThemeColor(palette.themeColor);
}

// State for the iOS re-tint scroll nudge below. Module-level so
// overlapping nudges (rapid hour changes — e.g. mashing the sky
// hour chip) share one TRUE baseline: a later nudge must not read the
// 1px-displaced position left by an earlier one as its "original"
// scroll position, or each overlap leaks a permanent 1px downward
// creep when the racing restores land out of order.
let nudgeBaseY = null;
let nudgeRestoreRaf = 0;

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
  // hour's color until the next scroll/tap. Re-entrant: the baseline
  // is captured once per settled position and the pending restore is
  // cancelled, so back-to-back nudges always restore to where the page
  // actually started.
  try {
    if (nudgeBaseY == null) nudgeBaseY = window.scrollY || window.pageYOffset || 0;
    window.scrollTo(0, nudgeBaseY + 1);
    cancelAnimationFrame(nudgeRestoreRaf);
    nudgeRestoreRaf = requestAnimationFrame(() => {
      window.scrollTo(0, nudgeBaseY);
      nudgeBaseY = null;
    });
  } catch {}
}

export function ThemeProvider({ children }) {
  // The site's sky clock. `liveHour` tracks the real Eastern hour; the
  // override (driven by the time-switcher chip in the bottom bar)
  // freezes it on an arbitrary hour so each step can be inspected. The
  // hour drives the sky palette AND the chrome-bar avatar mark (which
  // follows the hourly sky frames).
  const [liveHour, setLiveHour] = useState(() => easternHour());
  const [skyOverride, setSkyOverride] = useState(null);
  const skyHour = skyOverride ?? liveHour;
  // Mirror for callbacks that need the current hour without re-binding.
  const skyHourRef = useRef(skyHour);
  skyHourRef.current = skyHour;

  // What applyTheme last painted. advanceSkyHour applies synchronously
  // (for the iOS same-gesture theme-color) and then sets state; without
  // this guard the state-driven effect would re-apply the identical hour
  // right after — a second scroll nudge per tap.
  const appliedRef = useRef(null);

  useEffect(() => {
    const sig = `sky:${skyHour}`;
    if (appliedRef.current !== sig) {
      applyTheme(skyHour);
      appliedRef.current = sig;
    }
  }, [skyHour]);

  // Tick the clock over at the top of each Eastern hour (minutes/seconds
  // track UTC, so the boundary is computable locally). The avatar mark
  // and palette follow the hour. Timers sleep in background tabs, so
  // visibility-return also re-reads the clock.
  useEffect(() => {
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
  }, []);

  // Time switcher: step the sky palette forward one hour per call,
  // wrapping at midnight. Wired to the hour chip in the bottom chrome
  // bar so each of the 24 increments can be walked through in place.
  const advanceSkyHour = useCallback(() => {
    const next = (skyHourRef.current + 1) % 24;
    // Sync apply for the same iOS theme-color gesture reason as above.
    applyTheme(next);
    appliedRef.current = `sky:${next}`;
    setSkyOverride(next);
  }, []);

  const value = useMemo(
    () => ({
      theme: THEME,
      skyHour,
      skyHourKey: skyHourKey(skyHour),
      skyOverridden: skyOverride != null,
      advanceSkyHour,
    }),
    [skyHour, skyOverride, advanceSkyHour],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
