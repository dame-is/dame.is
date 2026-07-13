import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const FontContext = createContext(null);
const STORAGE_KEY = 'dame.font';

// Two font modes:
//   - mixed : the default. Serif body (Crimson Pro) with a monospace
//             technical accent (--mono) on gutters, ledger columns, and
//             metadata — the tabular, ledger-like voice.
//   - serif : folds that monospace accent into the serif voice so the
//             whole reading surface is one typeface. Code and raw data
//             (--code) stay monospace either way — see theme.css.
// The CSS lives in theme.css under [data-font='serif']; this hook just
// owns the preference and paints data-font onto <html>. Keep VALID +
// DEFAULT in sync with the pre-paint block in main.jsx.
const VALID = ['mixed', 'serif'];
const DEFAULT = 'mixed';

function applyFont(font) {
  document.documentElement.setAttribute('data-font', font);
}

function readInitial() {
  if (typeof localStorage === 'undefined') return DEFAULT;
  const stored = localStorage.getItem(STORAGE_KEY);
  return VALID.includes(stored) ? stored : DEFAULT;
}

export function FontProvider({ children }) {
  const [font, setFontState] = useState(readInitial);

  useEffect(() => {
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

  const value = useMemo(
    () => ({ font, setFont, toggle, serifOnly: font === 'serif', options: VALID }),
    [font, setFont, toggle],
  );
  return <FontContext.Provider value={value}>{children}</FontContext.Provider>;
}

export function useFont() {
  const ctx = useContext(FontContext);
  if (!ctx) throw new Error('useFont must be used inside <FontProvider>');
  return ctx;
}
