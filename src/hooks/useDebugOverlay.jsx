import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const DebugOverlayContext = createContext(null);

export function DebugOverlayProvider({ children }) {
  const [open, setOpen] = useState(false);

  const openOverlay = useCallback(() => setOpen(true), []);
  const closeOverlay = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  useEffect(() => {
    function handle(e) {
      // Toggle with `?` (Shift+/) but ignore when typing in an input.
      const tag = e.target?.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
      if (editing) return;
      if (e.key === '?') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [toggle]);

  const value = useMemo(() => ({ open, openOverlay, closeOverlay, toggle }), [open, openOverlay, closeOverlay, toggle]);
  return <DebugOverlayContext.Provider value={value}>{children}</DebugOverlayContext.Provider>;
}

export function useDebugOverlay() {
  const ctx = useContext(DebugOverlayContext);
  if (!ctx) throw new Error('useDebugOverlay must be used inside <DebugOverlayProvider>');
  return ctx;
}
