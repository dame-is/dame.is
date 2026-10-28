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
import { useChromePanel } from './useChromePanel.jsx';
import { navigationTarget } from '../lib/leaveGuard.js';

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
  // Whether the current page hosts its own edit-mode UI — feed-row selection
  // (home / posting / logging / listening) or guestbook moderation. Declared
  // by PageShell's `selectable` prop. The owner's edit pencil reads this: on a
  // page WITHOUT its own selection, tapping the pencil jumps straight to the
  // page's record editor instead of an empty select bar (see ChromeBar).
  const [selectionPage, setSelectionPage] = useState(false);
  // The record currently open in the quick-edit sheet: { atUri } or null.
  const [editSheet, setEditSheet] = useState(null);
  // A controller published by the open sheet's RecordEditor so the edit
  // action bar can drive save/delete: { save, remove, saving, deleting,
  // loading, canDelete } or null.
  //
  // There used to be a second one of these, `pageEditor`, published by the
  // full admin record editor so that its Save / Delete / Close appeared in
  // this same bottom bar. The workbench owns its own status strip now — Save
  // and Delete live on the detail pane's header, inside the shell, where the
  // record they act on is — so nothing publishes a page editor any more and
  // the state is gone. The sheet is the only remaining producer.
  const [sheetEditor, setSheetEditor] = useState(null);
  // Whether the open sheet holds unsaved edits, reported by its editor. A REF,
  // not state, for the reason RecordEditor keeps dirtiness off `onStatus`: it
  // changes per keystroke, and as state it would republish this context — and
  // re-render every feed row under the sheet — on every character.
  const sheetDirtyRef = useRef(false);
  const setSheetDirty = useCallback((dirty) => {
    sheetDirtyRef.current = !!dirty;
  }, []);
  const location = useLocation();
  const { open: dockOpen, closeDock } = useActionDock();
  const { panel, closePanel } = useChromePanel();

  const clearSelection = useCallback(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Map()));
  }, []);

  /**
   * Ask before a close would throw away the open sheet's edits. TRUE when it is
   * safe to close. The quick-edit sheet closes on Esc, on a tap of its backdrop,
   * from its own ✕, from the bar's Close and from the chrome's pencil — every
   * one of them a single stray press, and each used to drop a half-written post
   * body without a word.
   */
  const confirmSheetDiscard = useCallback(() => {
    if (!sheetDirtyRef.current) return true;
    if (!window.confirm('Discard your unsaved changes to this record?')) {
      return false;
    }
    sheetDirtyRef.current = false;
    return true;
  }, []);

  // Asks first (see above). `discardEditSheet` is the unconditional close, for
  // the callers with nothing left to protect: a delete that just succeeded, and
  // a competing sheet that has already taken the slot.
  const discardEditSheet = useCallback(() => {
    sheetDirtyRef.current = false;
    setEditSheet(null);
  }, []);
  const closeEditSheet = useCallback(() => {
    if (confirmSheetDiscard()) discardEditSheet();
  }, [confirmSheetDiscard, discardEditSheet]);
  const openEditSheet = useCallback((atUri) => {
    if (!atUri) return;
    sheetDirtyRef.current = false;
    setEditSheet({ atUri });
  }, []);

  const enter = useCallback(() => setActive(true), []);
  // Leaving edit mode takes the sheet with it, so it asks first too: the
  // chrome's ✕ beside the pencil, and x-ray's button and `i` shortcut, all
  // leave through here. TRUE when it left.
  const exit = useCallback(() => {
    if (!confirmSheetDiscard()) return false;
    setActive(false);
    clearSelection();
    discardEditSheet();
    return true;
  }, [clearSelection, confirmSheetDiscard, discardEditSheet]);
  // Read rather than decided inside a `setActive` updater: leaving edit mode
  // may now have to ASK first, and an updater has to be pure — StrictMode runs
  // it twice, which would put the question up twice.
  const activeRef = useRef(active);
  activeRef.current = active;
  const toggle = useCallback(() => {
    if (activeRef.current) exit();
    else setActive(true);
  }, [exit]);

  // PageShell calls this with its backing record (or null). We stamp the
  // current pathname so consumers can confirm the record actually belongs to
  // the route they're on.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const registerPageRecord = useCallback((rec) => {
    setPageRecord(rec && rec.atUri ? { ...rec, path: pathRef.current } : null);
  }, []);

  // PageShell reports whether its route carries its own selection / moderation
  // UI. Each page re-declares this on mount, so the last page to mount wins and
  // a stale value can't linger — no route-change reset needed (and a page that
  // registers no record leaves the pencil in plain select mode regardless).
  const registerSelectionPage = useCallback((on) => {
    setSelectionPage((prev) => (prev === !!on ? prev : !!on));
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
    discardEditSheet();
  }, [location.pathname, clearSelection, discardEditSheet]);

  // The nav dock and the transient chrome panels (search / filter / info) are
  // the site's other bottom-chrome sheets — the surfaces that expand out of
  // the same edge as the edit action bar. That slot is one-at-a-time, so
  // opening any of them closes the edit action bar rather than leaving it
  // stacked underneath: exit edit mode entirely, which folds the bar away,
  // clears the selection, and drops any open quick-edit sheet. (The quick-edit
  // sheet is itself part of edit mode and rides above the bar, so opening it
  // isn't counted here — only the competing sheets are.)
  //
  // Unless the sheet holds unsaved edits and the owner says to keep them: then
  // it is the competing sheet that folds away. The menu button sits in the same
  // chrome as the sheet's Save, and a tap on it used to drop a half-written post
  // body without a word.
  useEffect(() => {
    if (!dockOpen && !panel) return;
    if (exit()) return;
    closeDock();
    closePanel();
  }, [dockOpen, panel, exit, closeDock, closePanel]);

  // The same question for the two ways out that never pass through
  // `closeEditSheet`. A link to another page — the wordmark, Home, a
  // breadcrumb — changes the route, and the route-change reset above closes
  // the sheet; so the click is asked about in the capture phase, before the
  // router sees it, and stopped if the owner keeps the edits. And a reload or a
  // closed tab gets the browser's own prompt.
  useEffect(() => {
    if (!editSheet) return undefined;
    const onClickCapture = (event) => {
      if (!sheetDirtyRef.current) return;
      const here = window.location;
      const url = navigationTarget(event, here);
      if (!url || url.pathname === here.pathname) return;
      if (confirmSheetDiscard()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onBeforeUnload = (event) => {
      if (!sheetDirtyRef.current) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [editSheet, confirmSheetDiscard]);

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
      selectionPage,
      registerSelectionPage,
      editSheet,
      openEditSheet,
      closeEditSheet,
      discardEditSheet,
      confirmSheetDiscard,
      setSheetDirty,
      sheetEditor,
      setSheetEditor,
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
      selectionPage,
      registerSelectionPage,
      editSheet,
      openEditSheet,
      closeEditSheet,
      discardEditSheet,
      confirmSheetDiscard,
      setSheetDirty,
      sheetEditor,
      setSheetEditor,
    ],
  );

  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>;
}

export function useEditMode() {
  const ctx = useContext(EditModeContext);
  if (!ctx) throw new Error('useEditMode must be used inside <EditModeProvider>');
  return ctx;
}
