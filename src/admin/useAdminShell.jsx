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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { resolveSurface } from './surfaces.js';
import { invalidateCounts } from './useAdminData.js';

/**
 * The stacked (drill-down) breakpoint. Deliberately catches tablets: between
 * 701px and 960px a 3.25rem rail plus a 22rem list column leaves the detail pane
 * under 20rem wide, which is unusable for the blocks editor. The site's own
 * 700px rules (type scale, the iOS 16px input floor) still apply on top.
 */
export const STACK_QUERY = '(max-width: 60rem)';

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
 */

/** The one clean DirtyState. Frozen and shared, so `dirty` is referentially stable when idle. */
export const CLEAN = Object.freeze({ dirty: false, fields: NO_FIELDS, records: 0, note: null });

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
  if (!next || !next.dirty) return CLEAN;
  return {
    dirty: true,
    fields: Array.isArray(next.fields) ? next.fields : NO_FIELDS,
    records: Number.isFinite(next.records) ? next.records : 0,
    note: next.note ?? null,
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
    a.fields.length === b.fields.length &&
    a.fields.every((f, i) => f === b.fields[i])
  );
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
    if (!force && dirtyRef.current.dirty && !window.confirm('Discard unsaved changes?')) return;
    const next = new URLSearchParams(paramsRef.current);
    for (const [key, value] of Object.entries(patch || {})) {
      if (value == null) next.delete(key);
      else next.set(key, value);
    }
    setParamsRef.current(next, { replace });
  }, []);

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

  /* --- layout ------------------------------------------------------------ */

  const stacked = useStacked();
  // Derived from the URL and ONLY from the URL, so the on-screen back button and
  // the browser back button can never desync. There is deliberately no setter.
  const column = rkey || isNew ? 'detail' : 'list';

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
      dirty,
      reportDirty,
      actions,
      registerActions,
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
      dirty,
      reportDirty,
      actions,
      registerActions,
      dataRev,
      invalidate,
      stacked,
      column,
    ],
  );
}
