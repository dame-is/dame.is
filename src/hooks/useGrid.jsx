import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { readStorage } from '../lib/storageGuard.js';

const GridContext = createContext(null);
const STORAGE_KEY = 'dame.grid';

// The page grid drawn faintly behind every page (styles/grid.css): the column
// lines, and in an essay a rule under each line of text. A reader who wants a
// clean page turns it off from the sky sheet's display options, and the
// choice is remembered in this browser.
//   - on  : the grid shows (the default)
//   - off : a plain page
// This hook owns the preference and paints data-grid onto <html>. Keep VALID
// and DEFAULT in sync with the pre-paint block in main.jsx.
export const GRID_OPTIONS = ['on', 'off'];
const DEFAULT = 'on';

function applyGrid(grid) {
  document.documentElement.setAttribute('data-grid', grid);
}

function readInitial() {
  const stored = readStorage(STORAGE_KEY);
  return GRID_OPTIONS.includes(stored) ? stored : DEFAULT;
}

export function GridProvider({ children }) {
  const [grid, setGridState] = useState(readInitial);

  useEffect(() => {
    applyGrid(grid);
    try {
      localStorage.setItem(STORAGE_KEY, grid);
    } catch {
      /* storage blocked: the choice lasts this visit */
    }
  }, [grid]);

  const setGrid = useCallback((next) => {
    if (!GRID_OPTIONS.includes(next)) return;
    setGridState(next);
  }, []);

  const value = useMemo(() => ({ grid, setGrid, options: GRID_OPTIONS }), [grid, setGrid]);
  return <GridContext.Provider value={value}>{children}</GridContext.Provider>;
}

export function useGrid() {
  const ctx = useContext(GridContext);
  if (!ctx) throw new Error('useGrid must be used inside <GridProvider>');
  return ctx;
}
