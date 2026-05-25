import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const FilmGrainContext = createContext(null);
const STORAGE_KEY = 'dame.grain';
const VALID = ['on', 'off'];
// Feature dormant — the toggle UI is hidden in ActionDock and the
// default is off. The hook, component, and styles are kept around
// so the grain can be revived later by re-rendering FilmGrainToggle.
const DEFAULT = 'off';

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
