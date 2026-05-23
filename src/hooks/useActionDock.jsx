import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ActionDockContext = createContext(null);
const STORAGE_KEY = 'dame.dock.open';

export function ActionDockProvider({ children }) {
  const [open, setOpen] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === '1';
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch {}
  }, [open]);

  const openDock = useCallback(() => setOpen(true), []);
  const closeDock = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  const value = useMemo(() => ({ open, openDock, closeDock, toggle }), [open, openDock, closeDock, toggle]);
  return <ActionDockContext.Provider value={value}>{children}</ActionDockContext.Provider>;
}

export function useActionDock() {
  const ctx = useContext(ActionDockContext);
  if (!ctx) throw new Error('useActionDock must be used inside <ActionDockProvider>');
  return ctx;
}
