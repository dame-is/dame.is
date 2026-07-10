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
import { useActionDock } from './useActionDock.jsx';

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
  // The record backing the current page (from PageShell's `atUri`), tagged
  // with the path it was registered on so a stale value from a mid-transition
  // page never leaks onto the next route. Used by the quick-edit sheet.
  const [pageRecord, setPageRecord] = useState(null);
  // The record currently open in the quick-edit sheet: { atUri } or null.
  const [editSheet, setEditSheet] = useState(null);
  // A controller published by the open sheet's RecordEditor so the edit
  // action bar can drive save/delete: { save, remove, saving, deleting,
  // loading, canDelete } or null.
  const [sheetEditor, setSheetEditor] = useState(null);
  // The same shape, published by the full admin record editor page so its
  // Save / Delete / Close live in the bottom-chrome action bar instead of at
  // the foot of the page. Independent of `sheetEditor` (different source, so
  // the two never race to null each other). Also carries `close` + `isNew`.
  const [pageEditor, setPageEditor] = useState(null);
  const location = useLocation();
  const { open: dockOpen } = useActionDock();

  const clearSelection = useCallback(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Map()));
  }, []);

  const closeEditSheet = useCallback(() => setEditSheet(null), []);
  const openEditSheet = useCallback((atUri) => {
    if (atUri) setEditSheet({ atUri });
  }, []);

  const enter = useCallback(() => setActive(true), []);
  const exit = useCallback(() => {
    setActive(false);
    clearSelection();
    setEditSheet(null);
  }, [clearSelection]);
  const toggle = useCallback(() => {
    setActive((prev) => {
      if (prev) {
        clearSelection();
        setEditSheet(null);
      }
      return !prev;
    });
  }, [clearSelection]);

  // PageShell calls this with its backing record (or null). We stamp the
  // current pathname so consumers can confirm the record actually belongs to
  // the route they're on.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const registerPageRecord = useCallback((rec) => {
    setPageRecord(rec && rec.atUri ? { ...rec, path: pathRef.current } : null);
  }, []);

  // A selection from one page shouldn't linger onto the next. Clearing on
  // pathname change keeps the action bar's count honest as you navigate.
  const firstPath = useRef(location.pathname);
  useEffect(() => {
    if (firstPath.current === location.pathname) return;
    firstPath.current = location.pathname;
    clearSelection();
    // A quick-edit sheet is tied to the record it opened for; close it when
    // the route changes so it never hangs over an unrelated page.
    setEditSheet(null);
  }, [location.pathname, clearSelection]);

  // The nav dock and the quick-edit sheet share the bottom-chrome slot, and
  // the dock opens on top of everything — so opening the dock folds the
  // quick-edit sheet away (it would otherwise sit hidden behind the dock).
  // Mirrors useChromePanel's dock↔panel rule; edit MODE (and its action bar)
  // stays put — the dock rides above the bar via --edit-bar-h.
  useEffect(() => {
    if (dockOpen) setEditSheet(null);
  }, [dockOpen]);

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
      pageRecord,
      registerPageRecord,
      editSheet,
      openEditSheet,
      closeEditSheet,
      sheetEditor,
      setSheetEditor,
      pageEditor,
      setPageEditor,
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
      pageRecord,
      registerPageRecord,
      editSheet,
      openEditSheet,
      closeEditSheet,
      sheetEditor,
      setSheetEditor,
      pageEditor,
      setPageEditor,
    ],
  );

  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>;
}

export function useEditMode() {
  const ctx = useContext(EditModeContext);
  if (!ctx) throw new Error('useEditMode must be used inside <EditModeProvider>');
  return ctx;
}
