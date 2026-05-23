import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const CompactContext = createContext(null);
const STORAGE_KEY = 'dame.compact';

function applyCompact(compact) {
  document.documentElement.setAttribute('data-compact', compact ? 'true' : 'false');
}

export function CompactProvider({ children }) {
  const [compact, setCompactState] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    applyCompact(compact);
    try {
      localStorage.setItem(STORAGE_KEY, compact ? 'true' : 'false');
    } catch {}
  }, [compact]);

  const setCompact = useCallback((next) => {
    setCompactState(Boolean(next));
  }, []);

  const toggle = useCallback(() => {
    setCompactState((prev) => !prev);
  }, []);

  const value = useMemo(() => ({ compact, setCompact, toggle }), [compact, setCompact, toggle]);
  return <CompactContext.Provider value={value}>{children}</CompactContext.Provider>;
}

export function useCompact() {
  const ctx = useContext(CompactContext);
  if (!ctx) throw new Error('useCompact must be used inside <CompactProvider>');
  return ctx;
}
