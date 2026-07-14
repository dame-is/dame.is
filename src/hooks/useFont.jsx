import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const FontContext = createContext(null);
const STORAGE_KEY = 'dame.font';

// Feature flag. The font switcher is hidden for now and the site runs
// serif-only. Flip this to `true` to bring the toggle back (see
// ChromeBar): the stored preference is honoured again (it's never
// overwritten while disabled, so a returning visitor keeps their old
// choice) and the bottom-chrome button reappears. Serif is the default
// either way. Keep in sync with main.jsx.
export const FONT_SWITCHER_ENABLED = false;

// Two font modes:
//   - mixed : serif body (Crimson Pro) with a monospace technical accent
//             (--mono) on gutters, ledger columns, and metadata — the
//             tabular, ledger-like voice.
//   - serif : the default. Folds that monospace accent into the serif
//             voice so the whole reading surface is one typeface (and
//             scales those elements up a touch — see --mono-scale). Code
//             and raw data (--code) stay monospace either way.
// The CSS lives in theme.css under [data-font='serif']; this hook just
// owns the preference and paints data-font onto <html>. Keep VALID +
// DEFAULT in sync with the pre-paint block in main.jsx.
const VALID = ['mixed', 'serif'];
const DEFAULT = 'serif';

function applyFont(font) {
  document.documentElement.setAttribute('data-font', font);
}

function readInitial() {
  if (typeof localStorage === 'undefined') return DEFAULT;
  const stored = localStorage.getItem(STORAGE_KEY);
  return VALID.includes(stored) ? stored : DEFAULT;
}

export function FontProvider({ children }) {
  const [font, setFontState] = useState(() => (FONT_SWITCHER_ENABLED ? readInitial() : 'serif'));

  useEffect(() => {
    // While the switcher is disabled, always render serif-only and leave
    // the stored preference untouched so it comes back if it's re-enabled.
    if (!FONT_SWITCHER_ENABLED) {
      applyFont('serif');
      return;
    }
    applyFont(font);
    try {
      localStorage.setItem(STORAGE_KEY, font);
    } catch {}
  }, [font]);

  const setFont = useCallback((next) => {
    if (!VALID.includes(next)) return;
    setFontState(next);
  }, []);

  const toggle = useCallback(() => {
    setFontState((prev) => (prev === 'serif' ? 'mixed' : 'serif'));
  }, []);

  const effectiveFont = FONT_SWITCHER_ENABLED ? font : 'serif';
  const value = useMemo(
    () => ({
      font: effectiveFont,
      setFont,
      toggle,
      serifOnly: effectiveFont === 'serif',
      options: VALID,
    }),
    [effectiveFont, setFont, toggle],
  );
  return <FontContext.Provider value={value}>{children}</FontContext.Provider>;
}

export function useFont() {
  const ctx = useContext(FontContext);
  if (!ctx) throw new Error('useFont must be used inside <FontProvider>');
  return ctx;
}
