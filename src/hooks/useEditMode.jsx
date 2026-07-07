import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';

const EditModeContext = createContext(null);

/**
 * Owner-only "edit mode" for the live site.
 *
 * When the signed-in owner flips edit mode on (via the pencil button in the
 * bottom chrome bar), feed rows become selectable rather than navigable:
 * tapping a row toggles its selection, and the floating EditModeBar exposes
 * bulk actions (delete the selected records from the PDS, or jump a single
 * selection into the admin record editor).
 *
 * State held here (so the chrome bar, the feed rows, and the action bar all
 * share one source of truth):
 *   - active            — is edit mode on?
 *   - selected          — Map<atUri, item> of currently-selected feed items
 *   - removedUris        — atUris deleted this session, so feeds can filter
 *                          them out optimistically before the next live fetch
 *
 * Edit mode is intentionally NOT persisted — it always starts off on reload.
 * Selection clears whenever edit mode turns off or the route changes (a
 * selection made on the home feed is meaningless on another page).
 */
export function EditModeProvider({ children }) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState(() => new Map());
  const [removedUris, setRemovedUris] = useState(() => new Set());
  const location = useLocation();

  const clearSelection = useCallback(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Map()));
  }, []);

  const enter = useCallback(() => setActive(true), []);
  const exit = useCallback(() => {
    setActive(false);
    clearSelection();
  }, [clearSelection]);
  const toggle = useCallback(() => {
    setActive((prev) => {
      if (prev) clearSelection();
      return !prev;
    });
  }, [clearSelection]);

  // A selection from one page shouldn't linger onto the next. Clearing on
  // pathname change keeps the action bar's count honest as you navigate.
  const firstPath = useRef(location.pathname);
  useEffect(() => {
    if (firstPath.current === location.pathname) return;
    firstPath.current = location.pathname;
    clearSelection();
  }, [location.pathname, clearSelection]);

  const toggleSelect = useCallback((item) => {
    const uri = item?.atUri;
    if (!uri) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(uri)) next.delete(uri);
      else next.set(uri, item);
      return next;
    });
  }, []);

  // Add every item in a group to the selection (e.g. all the plays behind a
  // collapsed listening batch), keyed by atUri.
  const selectMany = useCallback((items) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const it of items || []) {
        if (it?.atUri) next.set(it.atUri, it);
      }
      return next;
    });
  }, []);

  const deselectMany = useCallback((uris) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const u of uris || []) next.delete(u);
      return next;
    });
  }, []);

  const isSelected = useCallback((uri) => selected.has(uri), [selected]);

  const markRemoved = useCallback((uris) => {
    const list = Array.isArray(uris) ? uris : [uris];
    setRemovedUris((prev) => {
      const next = new Set(prev);
      for (const u of list) if (u) next.add(u);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      active,
      enter,
      exit,
      toggle,
      selected,
      selectedItems: Array.from(selected.values()),
      selectedCount: selected.size,
      isSelected,
      toggleSelect,
      selectMany,
      deselectMany,
      clearSelection,
      removedUris,
      markRemoved,
    }),
    [
      active,
      enter,
      exit,
      toggle,
      selected,
      isSelected,
      toggleSelect,
      selectMany,
      deselectMany,
      clearSelection,
      removedUris,
      markRemoved,
    ],
  );

  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>;
}

export function useEditMode() {
  const ctx = useContext(EditModeContext);
  if (!ctx) throw new Error('useEditMode must be used inside <EditModeProvider>');
  return ctx;
}
