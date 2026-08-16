// The detail pane for ONE record: a header, a tab bar, and the shared
// RecordEditor under them.
//
// It replaces `RecordEditorPage` (the old Admin.jsx), and the difference that
// matters is what stays put. That page was a whole route: it drew a PageShell,
// published its Save and Delete into the site-wide bottom `EditModeBar` through
// `setPageEditor`, and got back to the list by reloading the SPA with
// `window.location.assign`. Here the pane is one column of a frame that never
// unmounts — Save and Delete are registered with the shell's status strip, and
// both "created" and "deleted" are ordinary URL patches.
//
// TWO RULES, both learned the hard way:
//
//  1. **`<RecordEditor>` is KEYED on `${collection}/${rkey}`.** The pane shell
//     around it deliberately is not. Without the key a single mounted editor
//     would carry per-record state across a selection: `rawMode`, `preview`,
//     `error`, `savedFlash`, a `coverPreview` object URL pointing at a DIFFERENT
//     record's image, `rkeyDraft` — and, worst of all, BlocksEditor's 200-deep
//     undo stack, where one Cmd+Z writes record A's body into record B. The
//     editor is a data-bound leaf whose load effect already keys on `rkey`, so
//     it refetches either way; the key is what discards the wreckage. None of
//     the things the rebuild is actually protecting — no route transition, no
//     crossfade, no scroll reset, no loss of the rail, the list, the list's
//     scroll position or its filter — depend on the editor instance surviving.
//
//  2. **`initialValue` must stay referentially stable.** It is in the editor's
//     load-effect dep array, so a fresh object literal per render refetches on
//     every render and wipes a half-typed new record.
//
// WHAT THE PHONE CHANGED HERE (docs/admin-mobile-design.md §3.3):
//
//  · **The heading names the RECORD.** It used to be `lex.label`, so drilling
//    into Curating landed you on a page titled "Curating" under a crumb reading
//    "← Curating", and a blog post was headed "Document". The type is now the
//    small-caps kicker above the title, which is where a type belongs.
//  · **No back link of its own.** Slot 1 of the action bar owns outward
//    navigation and makes the same URL change the browser's back button does;
//    two controls for one journey is how they end up disagreeing. It also fixes
//    a focus bug for free — `.wb-editor-back` unmounted itself on press and
//    dropped focus to `<body>`.
//  · **Tabs are buttons, not a tablist.** See the note above the tab bar.
//  · **JSON moves to the bar's `⋯` when stacked.** A 12-character-wide
//    monospace textarea is not where a lexicon violation gets fixed, but it must
//    stay reachable to READ what a record actually is.
//  · **A record that is not there is a state, not a form.** The editor draws it
//    (it is the half that knows the read failed); this pane supplies the way out
//    and registers NO actions, so nothing on screen offers to save or delete a
//    record that does not exist.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLLECTIONS, PORTFOLIO_PUBLICATION } from '../../config.js';
import { lexiconFor } from '../../lib/lexicons.js';
import RecordEditor from '../../components/RecordEditor.jsx';
import { recordTitle } from '../recordFields.js';
import { useAdminShell } from '../useAdminShell.jsx';
import './recordDetail.css';

/** The tab bar, in order. Preview and JSON are dropped when there is no lexicon. */
const TABS = Object.freeze([
  Object.freeze({ key: 'edit', label: 'Edit' }),
  Object.freeze({ key: 'preview', label: 'Preview' }),
  Object.freeze({ key: 'json', label: 'JSON' }),
]);

/** Frozen slices of TABS, so `tabs` is referentially stable per shape. */
const JSON_ONLY = Object.freeze(TABS.filter((t) => t.key === 'json'));
const FORM_TABS = Object.freeze(TABS.filter((t) => t.key !== 'json'));

/** Shell tab → the editor's body mode, and back. Two names for one tri-state. */
const MODE_BY_TAB = Object.freeze({ edit: 'form', preview: 'preview', json: 'raw' });
const TAB_BY_MODE = Object.freeze({ form: 'edit', preview: 'preview', raw: 'json' });

/** Shared empty arrays, so neither payload changes identity when it is empty. */
const NO_FIELDS = Object.freeze([]);
const NO_ITEMS = Object.freeze([]);

/** How long a transient confirmation ("Copied …") stays on screen. */
const FLASH_MS = 2400;

/**
 * The preview caption, verbatim. It is an admission, not a flourish: the real
 * page bodies that add the cover, the date/tag meta line, the comments and the
 * `.creating-work-page` treatment live in BlogPost.jsx and CreatingWork.jsx and
 * are not exported, and extracting them would edit public route files that
 * Xray.css anchors selectors on. So the preview says what it cannot show.
 */
const PREVIEW_NOTE = 'Approximate — the published page adds its cover, meta line and comments.';

/** Shown while the JSON tab is the active body, because it changes what Save writes. */
const RAW_NOTE = 'Editing raw JSON — Save writes this text.';

/**
 * @param {object} props
 * @param {import('../surfaces.js').AdminSurface} props.surface
 * @param {object} props.agent
 * @param {string} props.did
 * @param {string} props.collection
 * @param {string|null} props.rkey     null ⇒ new record
 * @param {string|null} props.preset   the `for` param
 */
export default function RecordDetail({ surface, agent, did, collection, rkey, preset = null }) {
  const {
    isNew,
    tab,
    setTab,
    go,
    invalidate,
    registerActions,
    registerBar,
    reportDirty,
    stacked,
  } = useAdminShell();

  const lex = lexiconFor(collection);
  // On desktop the shell mounts this pane for every records surface whether or
  // not a record is selected, and it passes `rkey: null` for BOTH "create a new
  // one" and "nothing is selected". Only the URL separates them — `mode=new` is
  // a draft, nothing at all is an empty pane — so `isNew` comes from the shell
  // rather than from `!rkey`. Without that, opening any list would hand the
  // owner an unasked-for blank record and a Create button.
  const editing = !!rkey || isNew;

  const activeTab = lex ? tab : 'json';
  const rawActive = activeTab === 'json';

  // With no lexicon there is no form and no preview to offer, and the editor
  // forces raw mode on itself anyway. Rather than show two dead tabs, show one.
  //
  // Stacked, JSON is not a tab at all: it lives in the bar's `⋯`, because two
  // tabs fit a 358px row honestly and three crowd it, and because JSON is a
  // thing you go and look at rather than a body you work in. It comes BACK as a
  // tab while it is the active body — a mode you cannot see is a mode you cannot
  // leave, and the alternative (a pressed state with no control) is worse than
  // one extra tab in the one case where it is the truth.
  const tabs = useMemo(() => {
    if (!lex) return JSON_ONLY;
    if (!stacked || rawActive) return TABS;
    return FORM_TABS;
  }, [lex, stacked, rawActive]);

  /* --- the "new creative work" preset ---------------------------------- */

  // Pre-selects the portfolio publication so a new document lands on /creating.
  // (A no-op until PORTFOLIO_PUBLICATION is set.)
  const isCreatingPreset = preset === 'creating' && collection === COLLECTIONS.blogging;
  const initialValue = useMemo(
    () => (isCreatingPreset && PORTFOLIO_PUBLICATION ? { site: PORTFOLIO_PUBLICATION } : null),
    [isCreatingPreset],
  );

  const newLabel = isCreatingPreset
    ? 'creative work'
    : collection === COLLECTIONS.blogging
      ? 'blog post'
      : lex?.label || collection;

  /* --- what is on screen ------------------------------------------------ */

  const [status, setStatus] = useState({
    saving: false,
    deleting: false,
    loading: !!rkey,
    isNew,
    error: null,
    notFound: false,
  });
  const handleStatus = useCallback((next) => setStatus(next), []);

  // The loaded record, held ONLY so the heading can name it. It arrives once per
  // record (`onLoaded`) and again after each successful save, rather than on
  // every keystroke: a heading that re-renders per character to track a title
  // being typed costs the whole pane a render for a line nobody is reading while
  // they type, and a heading that changes under the cursor is its own small
  // distraction. What it must never do is lie about WHICH record is open, and a
  // value written at load and at save cannot.
  const [record, setRecord] = useState(null);
  const handleLoaded = useCallback((value) => setRecord(value || null), []);

  const title = isNew ? `New ${newLabel}` : recordTitle(record, collection, rkey, lex);
  const kicker = lex?.label || null;

  /* --- driving the editor from the strip and the bar --------------------- */

  const editorRef = useRef(null);
  // Stable for the lifetime of the pane: the strip's Save button must not change
  // identity per keystroke, and the ref always holds the live editor.
  const save = useCallback(() => editorRef.current?.save(), []);
  // The delete the CALLER has already confirmed. Both routes to a delete ask
  // their own named question first — the bar through `BarAction.confirm`, the
  // desktop strip through `remove` below — so the editor's generic
  // "Delete is.dame.now/3l22…?" is suppressed rather than stacked on top.
  const removeConfirmed = useCallback(() => editorRef.current?.remove({ confirmed: true }), []);

  // Named, because "Delete this record?" over a list of forty is not a question
  // anyone can answer. `title` falls back to the rkey, so the sentence always
  // identifies something.
  const deleteQuestion = `Delete “${title}”? This cannot be undone.`;
  const remove = useCallback(() => {
    if (window.confirm(deleteQuestion)) removeConfirmed();
  }, [deleteQuestion, removeConfirmed]);

  // Nothing to save and nothing to delete when the read failed: the editor is
  // drawing "that record is gone" where the form would be, and a Save beside it
  // would CREATE the record the screen says is missing.
  const armed = editing && !status.notFound;

  useEffect(() => {
    // Nothing selected, nothing to save: the strip renders itself away entirely
    // rather than offering buttons for a record that is not there.
    if (!armed) return undefined;
    // `isNew` and `canDelete` come from the URL rather than from `status`, which
    // arrives one child-effect later: the URL is already correct on the very
    // first render after a selection, so the strip never flashes "Create" over a
    // record that exists.
    registerActions({
      save,
      remove,
      saving: status.saving,
      deleting: status.deleting,
      loading: status.loading,
      canDelete: !!rkey,
      isNew,
    });
    return () => registerActions(null);
  }, [armed, registerActions, save, remove, status, isNew, rkey]);

  /* --- the phone's action bar ------------------------------------------- */

  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  const showFlash = useCallback((message) => {
    setFlash(message);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // The record's own address, and the one thing about a record that is worth
  // carrying to another tool.
  const atUri = rkey ? `at://${did}/${collection}/${rkey}` : null;
  const copyUri = useCallback(() => {
    if (!atUri) return;
    // Success says only that it happened — nobody needs to read back the string
    // they just copied, and echoing a 78-character at-uri wraps to three lines
    // and shoves the form down while it is up. The FAILURE branch is the one that
    // prints it: a blocked clipboard (an insecure context, a denied permission)
    // is not a reason to leave the owner with nothing, and on screen it can at
    // least be selected by hand.
    navigator.clipboard?.writeText(atUri).then(
      () => showFlash('Copied at-uri'),
      () => showFlash(atUri),
    );
  }, [atUri, showFlash]);

  // Slot 1, slot 2 and slot 3 are all left to the shell's defaults here: `‹
  // <surface>`, the record's dirty sentence, and Save/Create from
  // `registerActions` are exactly what this pane wants in them. Only the `⋯`
  // menu is ours — everything rare or destructive, in one place, off the thumb's
  // path to Save.
  const overflow = useMemo(() => {
    // A record that is not there has no menu: switching its body, copying the
    // address of a thing that does not exist and deleting it are three controls
    // that would do nothing. With the list empty the bar draws no `⋯` at all,
    // which is the honest shape — slot 1 out, and nothing else.
    if (!armed) return NO_ITEMS;
    const items = [];
    if (lex) {
      items.push({
        id: 'json',
        label: rawActive ? 'Back to the form' : 'Edit raw JSON',
        icon: 'FileText',
        onPress: () => setTab(rawActive ? 'edit' : 'json'),
      });
    }
    if (atUri) {
      items.push({ id: 'copy-uri', label: 'Copy at-uri', icon: 'Files', onPress: copyUri });
    }
    if (rkey) {
      // Supplied rather than left to the shell, which would inject a Delete with
      // a generic confirm. `id: 'delete'` is the reserved id that replaces it.
      items.push({
        id: 'delete',
        label: status.deleting ? 'Deleting…' : 'Delete record…',
        icon: 'Archive',
        tone: 'danger',
        disabled: status.deleting || status.saving,
        confirm: deleteQuestion,
        onPress: removeConfirmed,
      });
    }
    return items;
  }, [
    lex,
    rawActive,
    setTab,
    atUri,
    copyUri,
    rkey,
    armed,
    status.deleting,
    status.saving,
    deleteQuestion,
    removeConfirmed,
  ]);

  useEffect(() => {
    if (!editing) return undefined;
    registerBar({ overflow });
    return () => registerBar(null);
  }, [editing, registerBar, overflow]);

  /* --- what the strip and the bar say ------------------------------------ */

  // The editor reports dirtiness and failure on two different channels, for good
  // reason — one fires per keystroke and the other four times a record — and the
  // shell holds ONE sentence. So they are merged here, at the only place that
  // hears both. `records` is the count of OTHER records staged for the same save:
  // a single-record editor never stages one, so it is the constant 0.
  const [dirtyPayload, setDirtyPayload] = useState(null);
  const handleDirty = useCallback((next) => setDirtyPayload(next), []);

  useEffect(() => {
    if (!editing) {
      reportDirty(null);
      return;
    }
    reportDirty({
      dirty: dirtyPayload?.dirty === true,
      fields: dirtyPayload?.fields || NO_FIELDS,
      note: dirtyPayload?.note ?? null,
      records: 0,
      // A failed save is not a clean state and not a dirty one: it is "not
      // saved", which the strip and the bar draw with the square in `--danger`.
      // A load failure is NOT reported here — the pane is already showing a
      // state that says so, in a sentence with somewhere to go.
      error: status.notFound ? null : status.error || null,
    });
  }, [editing, reportDirty, dirtyPayload, status.error, status.notFound]);

  // Belt and braces over the shell's own reset: a pane that unmounts (drilling
  // back to the list on a phone, or leaving for a studio) must not leave a stale
  // Save button or a stale "unsaved changes" sentence behind it.
  useEffect(() => () => {
    registerActions(null);
    registerBar(null);
    reportDirty(null);
  }, [registerActions, registerBar, reportDirty]);

  /* --- navigation ------------------------------------------------------- */

  const handleModeChange = useCallback(
    (nextMode) => setTab(TAB_BY_MODE[nextMode] || 'edit'),
    [setTab],
  );

  const backToList = useCallback(() => go({ r: null, mode: null }), [go]);

  // A legacy collection is one nothing writes to any more (the lexicon says so
  // itself), and the list column already declines to offer New on one. The empty
  // pane must not offer what the list refuses.
  const canCreate = lex?.legacy !== true;
  // `for=creating` is what stamps the portfolio publication onto a new document,
  // and it is declared once — in the registry's `newHref` — so it is read back
  // from there rather than restated. Without it, starting a creative work from
  // this pane would silently make a plain blog post.
  const newPreset = useMemo(
    () => new URLSearchParams(surface.newHref?.split('?')[1] || '').get('for'),
    [surface.newHref],
  );
  const startNew = useCallback(
    () => go({ r: null, mode: 'new', for: newPreset || null }),
    [go, newPreset],
  );

  const handleCreated = useCallback(
    ({ rkey: newRkey }) => {
      if (!newRkey) return;
      // The row count changed, so the list and the rail's counts are both stale.
      invalidate(collection);
      // REPLACE, so the back button returns to wherever the "New" click came
      // from rather than to a `mode=new` URL that would re-open an empty draft.
      // FORCE, because the editor has just written the very changes the guard
      // would ask about.
      go({ r: newRkey, mode: null }, { replace: true, force: true });
    },
    [collection, go, invalidate],
  );

  // What was deleted, kept so the pane can SAY so. A destructive action that
  // leaves no trace is the one place an admin owes the owner a sentence: before
  // this, the row simply vanished, the strip unmounted and focus fell to
  // `<body>` — 151 Tab presses from anything useful on a long list.
  const [deleted, setDeleted] = useState(null);
  const handleDeleted = useCallback(() => {
    setDeleted(title);
    invalidate(collection);
    go({ r: null, mode: null }, { force: true });
  }, [collection, go, invalidate, title]);

  const blankRef = useRef(null);
  useEffect(() => {
    // Opening another record retires the notice; without this, coming back to an
    // empty pane an hour later would still announce a delete from last time.
    if (editing) {
      if (deleted) setDeleted(null);
      return undefined;
    }
    if (!deleted) return undefined;
    // The control that ran is gone, so focus has to be PUT somewhere. This region
    // is the pane's whole content and carries the outcome sentence, so focusing
    // it both anchors the keyboard and reads the result aloud — instead of the
    // measured alternative, `document.body`, which on a 42-record list is 151 Tab
    // presses from anything useful.
    //
    // One frame late, deliberately. `RouteTransition` focuses `#main-content` on
    // every navigation (RouteTransition.jsx:33-36) — correct for a route change,
    // wrong for a query-param patch inside a frame that never unmounts — and it
    // is an ANCESTOR, so its effect runs after this one in the same commit and
    // would take the focus straight back. A frame later there is nothing left to
    // race. (Verified with a focusin/focusout log: without the delay the sequence
    // is blank → layout.)
    const frame = requestAnimationFrame(() => blankRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editing, deleted]);

  // A saved record can change the label the list row draws, so the list wants to
  // know — and the heading here is drawn from the same value. Scoped to this
  // collection: never the whole count batch.
  const handleSaved = useCallback(
    (value) => {
      setRecord(value || null);
      invalidate(collection);
    },
    [collection, invalidate],
  );

  /* --- render ------------------------------------------------------------ */

  // Every hook above runs unconditionally; only the OUTPUT is short-circuited.
  if (!editing) {
    return (
      // `.wb-editor` so the frame's own first-child rules — the block-start
      // space, the measure clamp, the stacked centring — apply to the empty
      // state exactly as they do to the form. `tabIndex={-1}` makes it a focus
      // target after a delete; it is never in the Tab order.
      <div className="wb-editor wb-editor-blank" ref={blankRef} tabIndex={-1}>
        <p className="placeholder-card wb-editor-empty">
          {deleted ? (
            <>
              Deleted <strong>{deleted}</strong>. Pick another record from the list
              {canCreate ? ', or start a new one.' : '.'}
            </>
          ) : (
            `Nothing selected — pick a record from the list${
              canCreate ? ', or start a new one.' : '.'
            }`
          )}
        </p>
        {/* The sentence used to offer an action the pane did not contain: `New`
            lives in the OTHER column, which on a wide screen is 600px away and
            on a phone is a different screen entirely. */}
        {canCreate && (
          <button type="button" className="admin-gate-button" onClick={startNew}>
            New record
          </button>
        )}
      </div>
    );
  }

  // Stacked, the list column is unmounted and this pane IS the page, so it owns
  // the <h1>. On desktop the list column has already used it for the surface and
  // this pane is a section within that.
  const Heading = stacked ? 'h1' : 'h2';

  return (
    <div className="wb-editor">
      <div className="wb-pane-head wb-editor-head">
        {/* The type, at the size a type deserves. It used to BE the heading. */}
        {kicker && <p className="wb-editor-kicker">{kicker}</p>}
        <Heading className="wb-pane-title wb-editor-title">{title}</Heading>
        <code className="admin-collection-nsid">{collection}</code>
        {rkey && <code className="wb-editor-rkey">{rkey}</code>}
      </div>

      {/* Mounted only while it has something to say. `role="status"` announces
          it politely on insertion, which is the whole reason it exists: the `⋯`
          menu closes over the press, so a control that flips to "Copied" for a
          beat — the pattern everywhere else on this site — is not on screen to
          flip. */}
      {flash && (
        <p className="admin-field-hint wb-editor-flash" role="status">
          {flash}
        </p>
      )}

      {isCreatingPreset && !PORTFOLIO_PUBLICATION && (
        <p className="admin-field-hint">
          No portfolio publication is configured yet — set <code>PORTFOLIO_PUBLICATION</code> in
          config, or pick the publication manually below.
        </p>
      )}

      {/* NOT a `tablist`. It carried `role="tab"` inside `role="tablist"` and
          none of the contract that goes with them: no `[role=tabpanel]` existed
          anywhere in the admin, `aria-controls` was null on all three, all three
          were in the Tab order (a tablist has one stop and moves with arrows),
          and pressing ArrowRight did nothing. A screen reader was told "tab 1 of
          3" and then handed no panel and dead arrow keys. They are three toggle
          buttons over one body, which is precisely what `aria-pressed` says —
          honest markup being cheaper, here, than implementing a pattern nothing
          about this bar wants. */}
      {!status.notFound && (
        <div className="wb-tabs wb-editor-tabs" role="group" aria-label="Record body">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className="wb-tab"
              aria-pressed={activeTab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!status.notFound && activeTab === 'json' && (
        <p className="admin-field-hint wb-editor-note">
          {lex ? RAW_NOTE : `${RAW_NOTE} No lexicon models ${collection}, so JSON is the only editor.`}
        </p>
      )}

      <RecordEditor
        // REQUIRED. See rule 1 at the top of this file.
        key={`${collection}/${rkey ?? 'new'}`}
        ref={editorRef}
        agent={agent}
        did={did}
        collection={collection}
        rkey={rkey}
        initialValue={initialValue}
        hideActions
        hideModeToolbar
        mode={MODE_BY_TAB[activeTab]}
        onModeChange={handleModeChange}
        previewNote={PREVIEW_NOTE}
        onStatus={handleStatus}
        onLoaded={handleLoaded}
        onDirtyChange={handleDirty}
        onSaved={handleSaved}
        onCreated={handleCreated}
        onDeleted={handleDeleted}
        notFoundAction={
          // The editor draws the state; the way out of it is the shell's, because
          // "back to the list" here is a query-param patch no leaf component can
          // express.
          <button type="button" className="admin-gate-button" onClick={backToList}>
            Back to {surface.label}
          </button>
        }
      />
    </div>
  );
}
