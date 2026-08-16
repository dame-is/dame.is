// The admin shell's context — the one new abstraction in this rebuild.
//
// The workbench is a persistent frame: the rail, the list column and the detail
// pane are siblings, so everything they share — which surface is open, what is
// unsaved, which Save button the status strip should draw — has to live above
// all three. Threading it as props would mean every pane accepting a dozen
// callbacks it does not use, and it would put the shell's navigation primitive
// in the hands of whoever remembered to pass it down.
//
// Three requirements shape every line below, and all three are lessons from the
// code this replaces:
//
//  1. **Stable callbacks.** `go`, `reportDirty`, `registerActions`, `setTab` and
//     `invalidate` are called from pane EFFECTS. An unstable identity there is
//     not a performance note, it is an infinite render loop — which is why the
//     old RecordEditorPage and EditSheet already wrap `onStatus` in a
//     `useCallback` with empty deps. Every callback here is ref-backed or
//     empty-dep, and the context value is memoized.
//
//  2. **No remount on navigation.** Everything the shell reads comes from
//     `useSearchParams`, so selecting a record re-renders one subtree instead of
//     swapping component types — which is exactly what the flat `if` ladder in
//     the old Admin.jsx did, returning 13 different component types from one
//     function and making React unmount one tree and mount another.
//
//  3. **Merge-only URL patches.** `go({ view: 'sky' })` from `?c=x&r=y` would
//     leave a stale `c` and `r` in the URL, ready to reappear the moment `view`
//     is dropped. Callers that change surface pass explicit nulls; the rule is
//     documented on `go` and the rail's exact patches live in AdminRail.jsx.
//
// Query-param addressing is load-bearing rather than stylistic: Vercel treats a
// path segment containing dots (`app.bsky.feed.post`) as a static file, so an
// NSID can never be a path segment. See the note at the top of surfaces.js.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { resolveSurface, surfaceByKey } from './surfaces.js';
import { invalidateCounts } from './useAdminData.js';

/**
 * The stacked (drill-down) breakpoint. Deliberately catches tablets: between
 * 701px and 960px a 13.5rem rail plus a 23rem list column leaves the detail pane
 * under 20rem wide, which is unusable for the blocks editor. The site's own
 * 700px rules (type scale, the iOS 16px input floor) still apply on top.
 *
 * Below it the workbench is a PHONE ADMIN, not the workbench with a column
 * deleted: the rail is gone, a three-slot action bar is the third row of the
 * frame, and the surface directory is a sheet. See docs/admin-mobile-design.md.
 */
export const STACK_QUERY = '(max-width: 60rem)';

/**
 * The one sentence the admin uses to ask about unsaved work. Stated once so the
 * rail, the top bar, the action bar and the browser back button all ask the same
 * question — it is verbatim from ResumeWorkbench, where this guard started.
 */
export const DISCARD_MESSAGE = 'Discard unsaved changes?';

/** Shared empty array so a clean DirtyState never changes identity. */
const NO_FIELDS = Object.freeze([]);

/**
 * @typedef {Object} DirtyState
 * @property {boolean}  dirty     Anything unsaved in the active pane?
 * @property {string[]} fields    Human field LABELS. Possibly empty even when dirty —
 *                                raw-JSON edits have no field granularity.
 * @property {number}   records   How many OTHER records are staged dirty. Non-zero only in
 *                                the resume workbench.
 * @property {string|null} note   Free-text override, e.g. "raw JSON edited".
 * @property {string|null} error  The last SAVE FAILURE, as one sentence. Added for the phone:
 *                                the bar is the only place a failed save can report where the
 *                                owner is looking, because the form's own error line is up to
 *                                1819px above the Save button that raised it. A pane clears it
 *                                by reporting a state without one.
 */

/** The one clean DirtyState. Frozen and shared, so `dirty` is referentially stable when idle. */
export const CLEAN = Object.freeze({
  dirty: false,
  fields: NO_FIELDS,
  records: 0,
  note: null,
  error: null,
});

/**
 * @typedef {Object} PaneActions
 * @property {(() => void)|null} save
 * @property {(() => void)|null} remove
 * @property {boolean} saving
 * @property {boolean} deleting
 * @property {boolean} loading
 * @property {boolean} canDelete
 * @property {boolean} isNew
 */

/**
 * @typedef {Object} BarAction
 * One control in the phone action bar. A pane describes what it wants; the bar
 * draws it, so no pane has to know the bar's geometry, its 44px floor, or which
 * slot painted the primary.
 *
 * @property {string}  id                     Stable within its slot. `'delete'` is reserved:
 *                                            supplying it in `overflow` replaces the shell's
 *                                            own injected Delete item.
 * @property {string}  label                  Visible text. Slot 3 never truncates it.
 * @property {string}  [icon]                 lucide icon NAME (a string, same registry the rail
 *                                            uses — never a component).
 * @property {() => void} onPress
 * @property {boolean} [disabled]
 * @property {boolean} [busy]                 Renders `busyLabel`, sets aria-busy, and disables.
 * @property {string}  [busyLabel]            Defaults to `label`.
 * @property {'primary'|'quiet'|'danger'} [tone]  Defaults: last action in slot 3 is `primary`,
 *                                            every other control is `quiet`.
 * @property {string}  [ariaLabel]            When the visible label is not the whole name.
 * @property {string}  [confirm]              A sentence. When set, the action only runs if the
 *                                            owner confirms it — this is how Delete stays
 *                                            reachable without sitting 8px from Save.
 */

/**
 * @typedef {Object} BarSlots
 * What a pane publishes to the action bar through `registerBar`. EVERY KEY IS
 * OPTIONAL, and an omitted key (`undefined`) means "use the shell's default" —
 * which is why a pane that has not been updated yet still gets a working bar.
 * Passing `null` for a key means "draw nothing here".
 *
 * @property {BarAction|null} [left]      Slot 1, always OUTWARD. Default: the Surfaces sheet
 *                                        trigger, or `‹ <surface>` when a record is open.
 * @property {string|null}    [status]    Slot 2, always STATUS. Default: the record's dirty
 *                                        sentence when the pane has registered actions or gone
 *                                        dirty, otherwise nothing.
 * @property {BarAction[]}    [actions]   Slot 3, always the surface's PRIMARY action. At most
 *                                        two; the last is painted as the primary. Default: Save
 *                                        (or Create) from `registerActions`.
 * @property {BarAction[]}    [overflow]  The `⋯` menu. The shell appends its own `Delete
 *                                        record…` when `actions.canDelete` and no item with
 *                                        `id: 'delete'` was supplied.
 */

/**
 * @typedef {Object} ListView
 * One record list's view state, LIFTED OUT OF THE PANE so that unmounting the
 * list column costs nothing. On a phone, drilling into a record unmounts the
 * list; before this, coming back gave scrollTop 0, an empty filter and a cleared
 * selection, which is the single most-repeated gesture in the phone admin.
 *
 * @property {string}   query        Filter text.
 * @property {string}   sort         Sort key, the list pane's own vocabulary.
 * @property {string}   visibility   Visibility filter, the list pane's own vocabulary.
 * @property {string[]} selected     Selected rkeys. A frozen ARRAY, not a Set, so it can be
 *                                   compared by value and sit in a dependency array.
 * @property {boolean}  selecting    Is the list in selection mode?
 * @property {number}   scrollTop    Last scroll offset of the list's scrollport.
 * @property {string|null} lastOpenRkey  The row that was drilled into, so focus can return to it.
 */

/**
 * @typedef {Object} AdminShellCtx
 * @property {object}  agent      The @atproto/api Agent. Never null inside the shell — the three
 *                                gates in Admin.jsx guarantee it.
 * @property {string}  did
 * @property {import('./surfaces.js').AdminSurface} surface  Never null; `.kind === 'dashboard'` at /admin.
 * @property {string|null} collection  The NSID the detail pane edits.
 * @property {string|null} rkey        The `r` param.
 * @property {boolean} isNew           `mode === 'new'`.
 * @property {string|null} preset      The `for` param.
 * @property {'edit'|'preview'|'json'} tab
 * @property {(t:'edit'|'preview'|'json') => void} setTab
 * @property {(patch: object, opts?: {replace?:boolean, force?:boolean}) => void} go
 * @property {DirtyState} dirty
 * @property {(d: DirtyState|null) => void} reportDirty
 * @property {PaneActions|null} actions
 * @property {(a: PaneActions|null) => void} registerActions
 * @property {number} dataRev
 * @property {(scope?: string|string[]|null) => void} invalidate
 * @property {boolean} stacked
 * @property {'list'|'detail'} column   DERIVED, read-only.
 * @property {() => boolean} confirmLeave  Ask the unsaved-changes question. TRUE when it is safe
 *                                to navigate. For links that leave `/admin` altogether, which
 *                                `go` cannot express.
 * @property {BarSlots|null} barSlots
 * @property {(slots: BarSlots|null) => void} registerBar
 * @property {string|null} sheet    Which sheet is open. The shell owns `'surfaces'` and
 *                                `'overflow'`; a pane may name its own (the list's
 *                                `'list-options'`).
 * @property {(next: string|null) => void} setSheet
 * @property {ListView} listView    The CURRENT surface's list view state.
 * @property {(key: string) => ListView} listViewFor
 * @property {(key: string, patch: Partial<ListView>) => void} setListView
 * @property {string[]} recents     Up to three recently-visited surface keys, most recent first,
 *                                never including the current one.
 */

const AdminShellContext = createContext(null);

/**
 * Read the shell. Throws outside `<AdminShell>` rather than returning null,
 * because every consumer immediately destructures `go` — a null here would
 * surface as "cannot read properties of null" three frames away from the cause.
 *
 * @returns {AdminShellCtx}
 */
export function useAdminShell() {
  const ctx = useContext(AdminShellContext);
  if (!ctx) throw new Error('useAdminShell() must be called inside <AdminShell>.');
  return ctx;
}

/** Provider half. Exported separately so AdminShell.jsx reads as layout, not plumbing. */
export function AdminShellProvider({ value, children }) {
  return <AdminShellContext.Provider value={value}>{children}</AdminShellContext.Provider>;
}

/**
 * A pane may report `null`, or `{ dirty: false }`, or a full state. Collapse all
 * the clean shapes onto the one frozen CLEAN object so an idle shell never hands
 * out a fresh `dirty` object and re-renders the strip for nothing.
 */
function normalizeDirty(next) {
  // An error survives a clean state: a save that FAILED leaves the pane clean of
  // new edits in some panes and dirty in others, and either way the sentence the
  // owner needs is "not saved", not "no unsaved changes".
  if (!next || (!next.dirty && !next.error)) return CLEAN;
  return {
    dirty: next.dirty === true,
    fields: Array.isArray(next.fields) ? next.fields : NO_FIELDS,
    records: Number.isFinite(next.records) ? next.records : 0,
    note: next.note ?? null,
    error: next.error ?? null,
  };
}

/**
 * Value equality for DirtyState. Panes recompute their payload from a memo whose
 * inputs change on every keystroke, so without this the strip would re-render
 * per character even when the sentence it draws is identical.
 */
function sameDirty(a, b) {
  if (a === b) return true;
  return (
    a.dirty === b.dirty &&
    a.records === b.records &&
    a.note === b.note &&
    a.error === b.error &&
    a.fields.length === b.fields.length &&
    a.fields.every((f, i) => f === b.fields[i])
  );
}

/* --- the phone's working set ------------------------------------------- */

/** Where the recents live. SESSION, not local — see `pushRecent`. */
const RECENTS_KEY = 'dame.admin.recent';
const RECENTS_MAX = 4;

/** Empty, frozen, shared: `recents` is referentially stable until it changes. */
const NO_RECENTS = Object.freeze([]);

/**
 * Read the session's recent surface keys. Storage is a hostile input — Safari
 * private mode throws on read, and the value is whatever a previous version of
 * this code wrote — so every failure collapses to "no recents", which is a
 * perfectly good state for this feature to be in.
 */
function readRecents() {
  try {
    const raw = window.sessionStorage.getItem(RECENTS_KEY);
    if (!raw) return NO_RECENTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_RECENTS;
    return parsed.filter((k) => typeof k === 'string').slice(0, RECENTS_MAX);
  } catch {
    return NO_RECENTS;
  }
}

/**
 * Record a visit. SESSION storage rather than local, deliberately: a working set
 * is a session's memory — the three surfaces you are moving between this
 * afternoon — and a new session should start from the desk rather than from
 * whatever you were doing last week.
 *
 * @param {string} key
 * @returns {string[]} the new list, most recent first
 */
function pushRecent(key) {
  const next = [key, ...readRecents().filter((k) => k !== key)].slice(0, RECENTS_MAX);
  try {
    window.sessionStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // A full or unavailable store costs the shortcut, nothing else.
  }
  return next;
}

/** A fresh, empty view state for one record list. */
function emptyListView() {
  return {
    query: '',
    sort: 'newest',
    visibility: 'all',
    selected: NO_FIELDS,
    selecting: false,
    scrollTop: 0,
    lastOpenRkey: null,
  };
}

/**
 * Does this patch only touch state that NOTHING ON SCREEN reads until the list
 * column is rebuilt? `scrollTop` is written on every scroll frame and
 * `lastOpenRkey` on every drill-in; re-rendering the whole shell for either
 * would make scrolling a phone list a state update per frame.
 */
function isSilentListPatch(patch) {
  return Object.keys(patch).every((k) => k === 'scrollTop' || k === 'lastOpenRkey');
}

/**
 * The unsaved-changes question, asked of a ref rather than of state so it is
 * correct SYNCHRONOUSLY — a pane that reports dirty and a bar tap in the same
 * tick must not navigate past the edit.
 *
 * @param {{current: DirtyState}} ref
 * @returns {boolean} TRUE when it is safe to navigate.
 */
function confirmDiscard(ref) {
  if (!ref.current.dirty) return true;
  return window.confirm(DISCARD_MESSAGE);
}

/** True when the viewport is in the stacked drill-down range. */
function matchesStacked() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(STACK_QUERY).matches
    : false;
}

function useStacked() {
  const [stacked, setStacked] = useState(matchesStacked);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(STACK_QUERY);
    const onChange = (event) => setStacked(event.matches);
    // Re-read once on subscribe: between the lazy initial state and this effect
    // the viewport may already have changed (a rotation during hydration).
    setStacked(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return stacked;
}

/**
 * Build the whole shell context from the URL. Called once, by AdminShell.
 *
 * @param {{agent: object, did: string}} params
 * @returns {AdminShellCtx}
 */
export function useShellState({ agent, did }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const view = searchParams.get('view');
  const cParam = searchParams.get('c');
  const rkey = searchParams.get('r');
  const preset = searchParams.get('for');
  const isNew = searchParams.get('mode') === 'new';

  // Never null. `?c=` never resolves to a studio, `view` beats `c`, and an
  // unrecognised `view` falls through — all of that lives in surfaces.js so the
  // precedence is stated once and testable.
  const surface = resolveSurface({ view, collection: cParam });

  // A records surface edits ITS nsid, not whatever `c` happens to say: on
  // `?view=blogging` there is no `c` at all, and on a hand-typed
  // `?view=blogging&c=is.dame.now` the surface must win or the list column and
  // the rail would disagree about what is on screen.
  const collection = surface.kind === 'records-list' ? surface.nsid : cParam;

  /* --- navigation ------------------------------------------------------- */

  // Latest-value refs so `go` can stay identity-stable across every navigation.
  // Assigning during render is the pattern useEditMode.jsx already uses for its
  // pathname ref; the alternative — putting `searchParams` in `go`'s deps —
  // gives every pane effect a new callback on every URL change.
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;
  const setParamsRef = useRef(setSearchParams);
  setParamsRef.current = setSearchParams;
  const dirtyRef = useRef(CLEAN);

  /**
   * The shell's only navigation primitive. MERGE-ONLY: a key you do not mention
   * keeps its current value, so a caller that changes surface must pass explicit
   * nulls (`null` deletes the key). Pushes by default — that matches every
   * `<Link>` the admin has today and makes the browser back button walk your
   * path — and guards on unsaved changes unless `force`.
   *
   * The confirm string is verbatim from ResumeWorkbench, the one place this
   * guard exists today, so the owner sees one sentence rather than two.
   */
  const go = useCallback((patch, { replace = false, force = false } = {}) => {
    if (!force && !confirmDiscard(dirtyRef)) return;
    const next = new URLSearchParams(paramsRef.current);
    for (const [key, value] of Object.entries(patch || {})) {
      if (value == null) next.delete(key);
      else next.set(key, value);
    }
    // Standing on the unsaved-changes sentinel (see the popstate guard below)?
    // Then REPLACE it rather than pushing past it. The sentinel is a duplicate of
    // the entry beneath it and not a destination anyone asked for, so overwriting
    // it loses nothing — and leaving it buried in the stack would cost the owner
    // a second Back press later to get past an entry that renders the same screen
    // twice.
    const onSentinel = typeof window !== 'undefined' && !!window.history.state?.wbGuard;
    setParamsRef.current(next, { replace: replace || onSentinel });
  }, []);

  /**
   * The guard on its own, for the navigations `go` cannot express — "View site"
   * and the wordmark leave `/admin` entirely, so they are `<Link>`s that only
   * need the question asked before the router takes over. Returns TRUE when it
   * is safe to leave.
   *
   * Ref-backed and identity-stable for the same reason as `go`: it is read from
   * link handlers that would otherwise be rebuilt on every keystroke.
   */
  const confirmLeave = useCallback(() => confirmDiscard(dirtyRef), []);

  /* --- what the active pane is doing ------------------------------------ */

  const [dirty, setDirty] = useState(CLEAN);
  const [actions, setActions] = useState(null);
  const [tab, setTab] = useState('edit');

  const reportDirty = useCallback((next) => {
    const value = normalizeDirty(next);
    // The ref is what `go`'s guard reads, and it must be current SYNCHRONOUSLY:
    // a pane that reports dirty and a rail click in the same tick would
    // otherwise navigate past an unsaved edit.
    dirtyRef.current = value;
    setDirty((prev) => (sameDirty(prev, value) ? prev : value));
  }, []);

  const registerActions = useCallback((next) => setActions(next ?? null), []);

  /* --- the phone action bar ---------------------------------------------- */

  // Same shape and the same lifecycle as `registerActions`: call it from an
  // effect, return `registerBar(null)` from that effect's cleanup, and let the
  // subject-change reset below catch a pane that forgets. It is registered at
  // EVERY width — the bar is only rendered when stacked, and asking every pane
  // to branch on `stacked` before registering would be twenty places to get the
  // breakpoint wrong.
  const [barSlots, setBarSlots] = useState(null);
  const registerBar = useCallback((next) => setBarSlots(next ?? null), []);

  /* --- sheets ------------------------------------------------------------- */

  // One open sheet at a time, named by a string rather than a boolean per sheet,
  // so opening the list options cannot leave the surface directory open behind
  // it. The shell owns 'surfaces' and 'overflow'; a pane may name its own.
  const [sheet, setSheetState] = useState(null);
  const setSheet = useCallback((next) => setSheetState(next ?? null), []);

  /* --- resetting when the detail pane changes subject -------------------- */

  // Reset DURING RENDER, not from an effect. React flushes effects child-first,
  // so a pane that re-registers its Save button in its own effect would do so
  // BEFORE a parent effect here could clear it — and the clear would then wipe
  // the button that was just registered. Adjusting state during render happens
  // before children render at all, so the pane's registration always wins.
  // U+0000 as the separator, written as an ESCAPE rather than a raw byte: it
  // cannot occur in an NSID, an rkey or a surface key, so no two different
  // subjects can ever collide into one string. (The raw byte works identically
  // but makes this file binary to grep, diff and every other text tool.)
  const subject = `${surface.key}\u0000${collection ?? ''}\u0000${rkey ?? ''}\u0000${isNew}`;
  const [lastSubject, setLastSubject] = useState(subject);
  if (lastSubject !== subject) {
    setLastSubject(subject);
    // Tab is shell state, not URL state, and resets to Edit per record.
    setTab('edit');
    // A pane that forgets its teardown cannot strand a stale Save button or a
    // stale "unsaved changes" sentence on the next record.
    setActions(null);
    // Same reasoning for the bar: a stale `+ New` from the list must not survive
    // into the record you just opened, and a stale `Save` must not survive into
    // a surface that cannot save.
    setBarSlots(null);
    // A sheet is a control for the surface you were on. Leaving it open across a
    // navigation would put the directory over a screen it no longer describes.
    setSheetState(null);
    dirtyRef.current = CLEAN;
    setDirty(CLEAN);
  }

  /* --- data revision ----------------------------------------------------- */

  const [dataRev, setDataRev] = useState(0);

  /**
   * Drop cached counts and tell every mounted consumer to re-read. `scope` is one
   * NSID or a list; omitted means everything. Deleting a record invalidates the
   * collection that changed rather than re-running the whole batch.
   */
  const invalidate = useCallback((scope) => {
    invalidateCounts(scope);
    setDataRev((rev) => rev + 1);
  }, []);

  /* --- list view state, lifted out of the list column --------------------- */

  // Ref-backed with a revision counter rather than plain state, because the two
  // halves of this have opposite requirements: `query` / `sort` / `visibility` /
  // `selected` must re-render the pane and the bar the moment they change, while
  // `scrollTop` is written on every scroll frame and must not re-render anything
  // at all. One Map, two write paths. Keyed by surface so filtering Logging and
  // filtering Blogging are different questions, as they are on desktop.
  const listViewsRef = useRef(new Map());
  // A bare bump rather than a counter anyone reads: nothing needs the revision's
  // VALUE, only the re-render it causes.
  const [, bumpListViews] = useReducer((n) => n + 1, 0);

  const listViewFor = useCallback((key) => {
    const map = listViewsRef.current;
    let entry = map.get(key);
    if (!entry) {
      entry = emptyListView();
      map.set(key, entry);
    }
    return entry;
  }, []);

  const setListView = useCallback(
    (key, patch) => {
      if (!patch) return;
      const current = listViewFor(key);
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (current[k] !== v) changed = true;
      }
      if (!changed) return;
      listViewsRef.current.set(key, { ...current, ...patch });
      if (!isSilentListPatch(patch)) bumpListViews();
    },
    [listViewFor],
  );

  /* --- recents ------------------------------------------------------------ */

  const [recentsRaw, setRecentsRaw] = useState(readRecents);

  // Written on every surface change, from an effect rather than during render:
  // this touches sessionStorage, and a render that is thrown away (StrictMode's
  // double invoke, a suspended tree) must not write history.
  useEffect(() => {
    setRecentsRaw(pushRecent(surface.key));
  }, [surface.key]);

  // The sheet lists where you have BEEN, not where you are — the current surface
  // is already named by the control that opens the sheet, so repeating it there
  // would spend a row saying nothing.
  const recents = useMemo(
    () => recentsRaw.filter((k) => k !== surface.key).slice(0, 3),
    [recentsRaw, surface.key],
  );

  /* --- the browser's own back button -------------------------------------- */

  // `go`'s confirm only covers navigations that go through `go`. A POP never
  // does, so browser Back on a dirty record silently discarded the edit while a
  // rail click on the identical state asked first.
  //
  // `useBlocker` is not available: the app mounts a plain BrowserRouter, not a
  // data router (main.jsx), and migrating to one is a change of a different size
  // that must not be smuggled in here. So: while there is unsaved work, push one
  // duplicate history entry — SAME url, SAME state object, so react-router's own
  // `idx` bookkeeping is untouched and the location does not change. The first
  // Back lands on that duplicate, which is where we ask the question. Answer no
  // and we push the duplicate back; answer yes and we hand the Back through.
  const sentinelRef = useRef(false);
  useEffect(() => {
    if (!dirty.dirty || typeof window === 'undefined') return undefined;

    // A stamp on the entry, so the cleanup below can tell "the duplicate is
    // still the entry we are standing on" from "the owner has navigated since".
    const stamp = `wb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.history.pushState({ ...window.history.state, wbGuard: stamp }, '');
    sentinelRef.current = true;

    const onPopState = () => {
      if (!sentinelRef.current) return;
      // Consumed either way: this entry only exists to be popped once.
      sentinelRef.current = false;
      if (!dirtyRef.current.dirty) {
        // The work was saved after the duplicate was pushed. Silently step
        // through it so one Back press is still one navigation.
        window.history.back();
        return;
      }
      if (confirmDiscard(dirtyRef)) {
        // Clear synchronously: the pane is about to unmount and its own
        // teardown would run too late for the second `back()`.
        dirtyRef.current = CLEAN;
        setDirty(CLEAN);
        window.history.back();
        return;
      }
      // Declined — put the duplicate back so the NEXT Back asks again.
      window.history.pushState({ ...window.history.state, wbGuard: stamp }, '');
      sentinelRef.current = true;
    };

    // A reload, a closed tab or a typed URL never reaches popstate. Same guard,
    // the browser's own wording.
    const onBeforeUnload = (event) => {
      if (!dirtyRef.current.dirty) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Saved without navigating: drop the duplicate, but ONLY while we are
      // still standing on it. After a navigation the duplicate is buried in the
      // stack and `back()` would undo the owner's own move.
      if (sentinelRef.current && window.history.state?.wbGuard === stamp) {
        sentinelRef.current = false;
        window.history.back();
      }
      sentinelRef.current = false;
    };
  }, [dirty.dirty]);

  /* --- an address that does not describe the screen ----------------------- */

  // `?view=nonsense` renders the Front desk while the URL keeps claiming a
  // surface that does not exist — bookmark it, share it, and it stays wrong.
  // Strip the parameter instead, with `replace` so the bad address does not
  // become a history entry, and `force` because there is nothing to discard: the
  // surface never rendered.
  useEffect(() => {
    if (!view) return;
    if (surfaceByKey(view)?.urlByView) return;
    go({ view: null }, { replace: true, force: true });
  }, [view, go]);

  /* --- layout ------------------------------------------------------------ */

  const stacked = useStacked();
  // Derived from the URL and ONLY from the URL, so the on-screen back button and
  // the browser back button can never desync. There is deliberately no setter.
  const column = rkey || isNew ? 'detail' : 'list';

  // Read through the ref during render so the value handed out is always the
  // current one; `listViewRev` is what makes this recompute. Included in the
  // context as a convenience for the common case (the pane for the surface you
  // are on); `listViewFor` is there for anything asking about another.
  const listView = listViewFor(surface.key);

  return useMemo(
    () => ({
      agent,
      did,
      surface,
      collection,
      rkey,
      isNew,
      preset,
      tab,
      setTab,
      go,
      confirmLeave,
      dirty,
      reportDirty,
      actions,
      registerActions,
      barSlots,
      registerBar,
      sheet,
      setSheet,
      listView,
      listViewFor,
      setListView,
      recents,
      dataRev,
      invalidate,
      stacked,
      column,
    }),
    [
      agent,
      did,
      surface,
      collection,
      rkey,
      isNew,
      preset,
      tab,
      go,
      confirmLeave,
      dirty,
      reportDirty,
      actions,
      registerActions,
      barSlots,
      registerBar,
      sheet,
      setSheet,
      listView,
      listViewFor,
      setListView,
      recents,
      dataRev,
      invalidate,
      stacked,
      column,
      // The list-view revision is deliberately NOT a dependency. It is the
      // render trigger, not an input: bumping it re-runs this hook, and
      // `listView` is re-read from the ref above, so a visible patch always
      // arrives here as a new object identity.
    ],
  );
}
