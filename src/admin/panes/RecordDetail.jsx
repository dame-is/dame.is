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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLLECTIONS, PORTFOLIO_PUBLICATION } from '../../config.js';
import { lexiconFor } from '../../lib/lexicons.js';
import RecordEditor from '../../components/RecordEditor.jsx';
import { useAdminShell } from '../useAdminShell.jsx';
import './recordDetail.css';

/** The tab bar, in order. Preview and JSON are dropped when there is no lexicon. */
const TABS = Object.freeze([
  Object.freeze({ key: 'edit', label: 'Edit' }),
  Object.freeze({ key: 'preview', label: 'Preview' }),
  Object.freeze({ key: 'json', label: 'JSON' }),
]);

/** Shell tab → the editor's body mode, and back. Two names for one tri-state. */
const MODE_BY_TAB = Object.freeze({ edit: 'form', preview: 'preview', json: 'raw' });
const TAB_BY_MODE = Object.freeze({ form: 'edit', preview: 'preview', raw: 'json' });

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
  const { isNew, tab, setTab, go, invalidate, registerActions, reportDirty, stacked } =
    useAdminShell();

  const lex = lexiconFor(collection);
  // On desktop the shell mounts this pane for every records surface whether or
  // not a record is selected, and it passes `rkey: null` for BOTH "create a new
  // one" and "nothing is selected". Only the URL separates them — `mode=new` is
  // a draft, nothing at all is an empty pane — so `isNew` comes from the shell
  // rather than from `!rkey`. Without that, opening any list would hand the
  // owner an unasked-for blank record and a Create button.
  const editing = !!rkey || isNew;

  // With no lexicon there is no form and no preview to offer, and the editor
  // forces raw mode on itself anyway. Rather than show two dead tabs, show one.
  const tabs = lex ? TABS : TABS.filter((t) => t.key === 'json');
  const activeTab = lex ? tab : 'json';

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
  const title = isNew ? `New ${newLabel}` : lex?.label || collection;

  /* --- driving the editor from the strip -------------------------------- */

  const editorRef = useRef(null);
  // Stable for the lifetime of the pane: the strip's Save button must not change
  // identity per keystroke, and the ref always holds the live editor.
  const save = useCallback(() => editorRef.current?.save(), []);
  const remove = useCallback(() => editorRef.current?.remove(), []);

  const [status, setStatus] = useState({ saving: false, deleting: false, loading: !!rkey });
  const handleStatus = useCallback((next) => setStatus(next), []);

  useEffect(() => {
    // Nothing selected, nothing to save: the strip renders itself away entirely
    // rather than offering buttons for a record that is not there.
    if (!editing) return undefined;
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
  }, [editing, registerActions, save, remove, status, isNew, rkey]);

  // The editor's payload is `{dirty, fields, note}`; the shell's DirtyState also
  // carries `records`, which counts OTHER records staged for the same save. A
  // single-record editor never stages one, so it is the constant 0 — widened
  // inside this one stable callback rather than at a call site, so no fresh
  // object is minted per render.
  const handleDirty = useCallback(
    (next) => reportDirty({ ...next, records: 0 }),
    [reportDirty],
  );

  // Belt and braces over the shell's own reset: a pane that unmounts (drilling
  // back to the list on a phone, or leaving for a studio) must not leave a stale
  // Save button or a stale "unsaved changes" sentence behind it.
  useEffect(() => () => {
    registerActions(null);
    reportDirty(null);
  }, [registerActions, reportDirty]);

  /* --- navigation ------------------------------------------------------- */

  const handleModeChange = useCallback(
    (nextMode) => setTab(TAB_BY_MODE[nextMode] || 'edit'),
    [setTab],
  );

  const backToList = useCallback(() => go({ r: null, mode: null }), [go]);

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

  const handleDeleted = useCallback(() => {
    invalidate(collection);
    go({ r: null, mode: null }, { force: true });
  }, [collection, go, invalidate]);

  // A saved record can change the label the list row draws, so the list wants to
  // know. Scoped to this collection — never the whole count batch.
  const handleSaved = useCallback(() => invalidate(collection), [collection, invalidate]);

  /* --- render ------------------------------------------------------------ */

  // Every hook above runs unconditionally; only the OUTPUT is short-circuited.
  if (!editing) {
    return (
      <p className="placeholder-card wb-editor-empty">
        Nothing selected — pick a record from the list, or start a new one.
      </p>
    );
  }

  // Stacked, the list column is unmounted and this pane IS the page, so it owns
  // the <h1>. On desktop the list column has already used it for the surface and
  // this pane is a section within that.
  const Heading = stacked ? 'h1' : 'h2';

  return (
    <div className="wb-editor">
      <div className="wb-pane-head wb-editor-head">
        {stacked && (
          // Pushes and changes the URL, exactly like the browser's own back
          // button, so the two can never disagree about which column is showing.
          <button type="button" className="admin-link-subtle wb-editor-back" onClick={backToList}>
            ← {surface.label}
          </button>
        )}
        <Heading className="wb-pane-title wb-editor-title">{title}</Heading>
        <code className="admin-collection-nsid">{collection}</code>
        {rkey && <code className="wb-editor-rkey">{rkey}</code>}
      </div>

      {isCreatingPreset && !PORTFOLIO_PUBLICATION && (
        <p className="admin-field-hint">
          No portfolio publication is configured yet — set <code>PORTFOLIO_PUBLICATION</code> in
          config, or pick the publication manually below.
        </p>
      )}

      <div className="wb-tabs wb-editor-tabs" role="tablist" aria-label="Record body">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className="wb-tab"
            aria-selected={activeTab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'json' && (
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
        onDirtyChange={handleDirty}
        onSaved={handleSaved}
        onCreated={handleCreated}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
