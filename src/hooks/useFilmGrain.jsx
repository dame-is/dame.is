import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const FilmGrainContext = createContext(null);
// Versioned key: while the feature was dormant the provider persisted
// 'off' under the old `dame.grain` key on every visit, so that key
// can't distinguish "user chose off" from "dormant default". Starting
// fresh under .v2 gives everyone the on-by-default grain again.
const STORAGE_KEY = 'dame.grain.v2';
const VALID = ['on', 'off'];
const DEFAULT = 'on';

function applyGrain(grain) {
  document.documentElement.setAttribute('data-grain', grain);
}

function readInitial() {
  if (typeof localStorage === 'undefined') return DEFAULT;
  const stored = localStorage.getItem(STORAGE_KEY);
  return VALID.includes(stored) ? stored : DEFAULT;
}

export function FilmGrainProvider({ children }) {
  const [grain, setGrainState] = useState(readInitial);

  useEffect(() => {
    applyGrain(grain);
    try {
      localStorage.setItem(STORAGE_KEY, grain);
    } catch {}
  }, [grain]);

  const setGrain = useCallback((next) => {
    if (!VALID.includes(next)) return;
    setGrainState(next);
  }, []);

  const toggle = useCallback(() => {
    setGrainState((prev) => (prev === 'on' ? 'off' : 'on'));
  }, []);

  const value = useMemo(
    () => ({ grain, setGrain, toggle, options: VALID, enabled: grain === 'on' }),
    [grain, setGrain, toggle],
  );
  return <FilmGrainContext.Provider value={value}>{children}</FilmGrainContext.Provider>;
}

export function useFilmGrain() {
  const ctx = useContext(FilmGrainContext);
  if (!ctx) throw new Error('useFilmGrain must be used inside <FilmGrainProvider>');
  return ctx;
}
