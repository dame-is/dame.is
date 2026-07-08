import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const PaperContext = createContext(null);
const STORAGE_KEY = 'dame.paper';

// Feature flag. The paper-texture feature (ruled lines / dot grid) is
// paused for now — every page renders blank, the way it used to. Flip
// this to `true` to bring the whole thing back: the chrome toggle
// reappears (see ChromeBar), the stored preference is honoured again
// (it's never overwritten while disabled, so returning users keep their
// old choice), and the textures paint. Keep in sync with main.jsx.
export const PAPER_ENABLED = false;

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
  const [paper, setPaperState] = useState(() => (PAPER_ENABLED ? readInitial() : 'blank'));

  useEffect(() => {
    // While disabled, always render blank and leave the stored preference
    // untouched so it comes back if the feature is re-enabled later.
    if (!PAPER_ENABLED) {
      applyPaper('blank');
      return;
    }
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
