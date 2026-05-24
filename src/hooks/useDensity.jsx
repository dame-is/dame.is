import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const DensityContext = createContext(null);
const STORAGE_KEY = 'dame.density';
const LEGACY_KEY = 'dame.compact';
const VALID = ['normal', 'compact', 'tight'];
const DEFAULT = 'normal';

function applyDensity(density) {
  document.documentElement.setAttribute('data-density', density);
}

/**
 * Migrate the boolean `dame.compact` localStorage value (older builds)
 * into the new tri-state `dame.density`. Runs once per session — once
 * `dame.density` is set, the legacy key is ignored on subsequent reads.
 */
function readInitial() {
  if (typeof localStorage === 'undefined') return DEFAULT;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (VALID.includes(stored)) return stored;
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy === 'true') return 'compact';
  return DEFAULT;
}

export function DensityProvider({ children }) {
  const [density, setDensityState] = useState(readInitial);

  useEffect(() => {
    applyDensity(density);
    try {
      localStorage.setItem(STORAGE_KEY, density);
    } catch {}
  }, [density]);

  const setDensity = useCallback((next) => {
    if (!VALID.includes(next)) return;
    setDensityState(next);
  }, []);

  const cycle = useCallback(() => {
    setDensityState((prev) => {
      const idx = VALID.indexOf(prev);
      return VALID[(idx + 1) % VALID.length];
    });
  }, []);

  const value = useMemo(
    () => ({ density, setDensity, cycle, options: VALID }),
    [density, setDensity, cycle],
  );
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity() {
  const ctx = useContext(DensityContext);
  if (!ctx) throw new Error('useDensity must be used inside <DensityProvider>');
  return ctx;
}
