import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const TypefaceContext = createContext(null);
const STORAGE_KEY = 'dame.typeface';
// Mirrors the [data-typeface] modes in theme.css: "combo" (default)
// keeps the serif/sans split; "serif" and "sans" collapse both stacks
// to a single family for a unified voice.
const VALID = ['combo', 'serif', 'sans'];
const DEFAULT = 'combo';

function applyTypeface(typeface) {
  document.documentElement.setAttribute('data-typeface', typeface);
}

function readInitial() {
  if (typeof localStorage === 'undefined') return DEFAULT;
  const stored = localStorage.getItem(STORAGE_KEY);
  return VALID.includes(stored) ? stored : DEFAULT;
}

export function TypefaceProvider({ children }) {
  const [typeface, setTypefaceState] = useState(readInitial);

  useEffect(() => {
    applyTypeface(typeface);
    try {
      localStorage.setItem(STORAGE_KEY, typeface);
    } catch {}
  }, [typeface]);

  const setTypeface = useCallback((next) => {
    if (!VALID.includes(next)) return;
    setTypefaceState(next);
  }, []);

  const cycle = useCallback(() => {
    setTypefaceState((prev) => {
      const idx = VALID.indexOf(prev);
      return VALID[(idx + 1) % VALID.length];
    });
  }, []);

  const value = useMemo(
    () => ({ typeface, setTypeface, cycle, options: VALID }),
    [typeface, setTypeface, cycle],
  );
  return <TypefaceContext.Provider value={value}>{children}</TypefaceContext.Provider>;
}

export function useTypeface() {
  const ctx = useContext(TypefaceContext);
  if (!ctx) throw new Error('useTypeface must be used inside <TypefaceProvider>');
  return ctx;
}
