import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const PaperContext = createContext(null);
const STORAGE_KEY = 'dame.paper';

// Three paper textures painted faintly behind long-form text content
// (multiline feed posts, blog/document prose):
//   - blank : no texture, a clean page (the default)
//   - ruled : very faint horizontal rules, like ruled-lined paper
//   - dots  : a very faint dot grid
const VALID = ['blank', 'ruled', 'dots'];
const DEFAULT = 'blank';

function applyPaper(paper) {
  document.documentElement.setAttribute('data-paper', paper);
}

function readInitial() {
  if (typeof localStorage === 'undefined') return DEFAULT;
  const stored = localStorage.getItem(STORAGE_KEY);
  return VALID.includes(stored) ? stored : DEFAULT;
}

export function PaperProvider({ children }) {
  const [paper, setPaperState] = useState(readInitial);

  useEffect(() => {
    applyPaper(paper);
    try {
      localStorage.setItem(STORAGE_KEY, paper);
    } catch {}
  }, [paper]);

  const setPaper = useCallback((next) => {
    if (!VALID.includes(next)) return;
    setPaperState(next);
  }, []);

  const cycle = useCallback(() => {
    setPaperState((prev) => {
      const idx = VALID.indexOf(prev);
      return VALID[(idx + 1) % VALID.length];
    });
  }, []);

  const value = useMemo(
    () => ({ paper, setPaper, cycle, options: VALID }),
    [paper, setPaper, cycle],
  );
  return <PaperContext.Provider value={value}>{children}</PaperContext.Provider>;
}

export function usePaper() {
  const ctx = useContext(PaperContext);
  if (!ctx) throw new Error('usePaper must be used inside <PaperProvider>');
  return ctx;
}
