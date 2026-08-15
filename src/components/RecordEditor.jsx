import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { COLLECTIONS, ME_DID } from '../config.js';
import { lexiconFor, blankRecordFor } from '../lib/lexicons.js';
import { renderMarkdown } from '../lib/markdown.js';
import { diffRecord, labelFields, normalizeForDiff } from '../lib/recordDiff.js';
import { resolvePds } from '../lib/atproto.js';
import { annotateBlobUrl, annotateLeafletBlobs } from '../lib/feedBuilder.js';
import { fetchAllBlocks } from '../lib/arena.js';
import BlocksEditor from './blocks/BlocksEditor.jsx';
import { uploadImageFile } from './blocks/ImageBlockEditor.jsx';
import LeafletDocument from './LeafletDocument.jsx';
import { AdminEditorSkeleton } from './Skeleton.jsx';
import {
  HighlightsField,
  RecordRefsField,
  SkillGroupsField,
  ContactField,
  LinksField,
  TagsInput,
} from './resumeFields.jsx';
import '../pages/Admin.css';

/**
 * `agent.com.atproto.repo.getRecord` returns blobs as `BlobRef` instances.
 * `structuredClone` mangles those into invalid plain objects (losing `toJSON`
 * and `ref.$link`), which then get re-put as garbage — silently stripping the
 * image. A JSON round-trip instead runs each BlobRef's `toJSON`, yielding the
 * plain `{$type:'blob', ref:{$link}, …}` wire form: safe to clone, and
 * re-hydrated correctly by the client on save.
 */
function toPlainRecord(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

/** Deep-remove our `_url` display annotations so they never reach the PDS. */
function stripUrlAnnotations(value) {
  if (Array.isArray(value)) return value.map(stripUrlAnnotations);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '_url') continue;
      out[k] = stripUrlAnnotations(v);
    }
    return out;
  }
  return value;
}

/**
 * Bake `_url` display URLs onto a record's blob refs (top-level image fields
 * and any image/preview blobs inside `blocks` bodies) so existing images show
 * in the editor. Mirrors the feed builder's read-path annotation.
 */
function annotateRecordBlobs(record, lex, pds, did) {
  if (!record || !pds) return;
  for (const f of lex?.fields || []) {
    if (f.type === 'image') annotateBlobUrl(record[f.key], pds, did);
    if (f.type === 'blocks') annotateLeafletBlobs(record[f.key], pds, did);
  }
}

/**
 * Can this record type carry a blob at all? If not there is nothing for the PDS
 * lookup to annotate, so the lookup itself is skipped — a status update and a
 * scrobble have no images and no reason to touch plc.directory.
 */
function couldCarryBlobs(lex) {
  return (lex?.fields || []).some((f) => f.type === 'image' || f.type === 'blocks');
}

/**
 * How long the display-only PDS lookup gets before the editor gives up on it.
 *
 * `resolvePds` → `getPlcDocument` → `fetchJson` carries a 15-second abort, which
 * is a reasonable ceiling for a feed refresh and a terrible one for a cosmetic
 * image URL. It used to be awaited BEFORE the form rendered its first field:
 * measured against a slow plc.directory, that held the editor on its skeleton
 * for 28.6 seconds. The lookup is now off the blocking path entirely, and bounded
 * as well, so the worst case is "images show no preview" — never "no editor".
 */
const PDS_LOOKUP_TIMEOUT_MS = 2500;

function resolvePdsBounded(did) {
  return Promise.race([
    resolvePds(did),
    new Promise((resolve) => {
      setTimeout(() => resolve(null), PDS_LOOKUP_TIMEOUT_MS);
    }),
  ]).catch(() => null);
}

/** Does this text parse? Used to decide whether it is safe to overwrite. */
function isParseableJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Shared empty array so a clean dirty payload never changes identity. */
const NO_FIELDS = Object.freeze([]);
/** The two constant dirty payloads, frozen so the publishing effect can skip. */
const CLEAN_STATUS = Object.freeze({ dirty: false, fields: NO_FIELDS, note: null });
const RAW_DIRTY_STATUS = Object.freeze({ dirty: true, fields: NO_FIELDS, note: 'raw JSON edited' });

/**
 * Reusable record editor (form + raw JSON + save/delete) shared by the admin
 * page and the atmosphere debug overlay.
 *
 * Renders the editor controls only — callers are responsible for wrapping it
 * in any page chrome (titles, breadcrumbs, etc).
 *
 * Props:
 *   - agent:       an atproto Agent bound to the signed-in user's PDS
 *   - did:         repo DID to write to (typically the signed-in user's DID)
 *   - collection:  lexicon NSID, e.g. "app.bsky.feed.post"
 *   - rkey:        record key for editing existing records, or null/undefined
 *                  when creating a new one
 *   - compact:     when true, hides the rkey input for fixed-rkey new-record
 *                  flows (the debug overlay doesn't need it) and tightens
 *                  spacing.
 *   - onSaved:     called with the updated record after a successful save
 *   - onDeleted:   called after a successful delete
 *   - onCreated:   called with `{ rkey }` after a successful create
 *   - initialMode: 'form' (default) or 'raw' — useful when callers want to
 *                  drop the user straight into JSON editing.
 *   - hideActions: when true, the internal Save/Delete button row is not
 *                  rendered — the caller drives save/delete via the imperative
 *                  ref instead (see the quick-edit sheet's action bar).
 *   - onStatus:    called with `{ saving, deleting, loading, isNew }` whenever
 *                  those change, so an external controller can reflect state.
 *
 * The five props below are ADDITIVE and optional: every one of them is `undefined`
 * for the quick-edit sheet (EditSheet.jsx) and for /exploring, which is what keeps
 * this component's behaviour on public routes byte-for-byte what it was.
 *
 *   - mode:            'form' | 'raw' | 'preview'. When supplied the body mode is
 *                      CONTROLLED: the internal rawMode/preview state is bypassed
 *                      and `onModeChange` must drive it. Omit for today's
 *                      uncontrolled two-button toolbar.
 *   - onModeChange:    called with the mode the editor would like to be in.
 *   - hideModeToolbar: suppress the internal "Edit JSON" / "Preview" row. Note
 *                      `hideActions` does NOT hide it — that row has never had a
 *                      compact/hideActions guard, which is why the public sheet
 *                      shows it.
 *   - previewNote:     caption rendered under the preview body.
 *   - onDirtyChange:   called from its OWN effect with `{ dirty, fields, note }`
 *                      whenever that changes. Deliberately NOT folded into
 *                      `onStatus`: that effect's deps are four booleans that never
 *                      change while typing, so it never fires per keystroke —
 *                      adding dirtiness to it would republish EditModeContext on
 *                      every character and re-render every feed row under an open
 *                      quick-edit sheet. When this prop is absent the diff is not
 *                      computed at all.
 *
 * Ref (imperative handle): `{ save(), remove() }` — trigger a save or delete
 * from outside the component.
 */
const RecordEditor = forwardRef(function RecordEditor({
  agent,
  did,
  collection,
  rkey,
  compact = false,
  onSaved,
  onDeleted,
  onCreated,
  initialMode = 'form',
  initialValue = null,
  hideActions = false,
  onStatus,
  mode,
  onModeChange,
  hideModeToolbar = false,
  previewNote = null,
  onDirtyChange,
}, ref) {
  const lex = lexiconFor(collection);
  const isNew = !rkey;

  // The one baseline every dirty check is measured against, always written
  // through `normalizeForDiff`. It replaces an `original` state that was written
  // in three places, in three different shapes, and read in none.
  const [baseline, setBaseline] = useState(null);
  const [value, setValue] = useState(null);
  const [rkeyDraft, setRkeyDraft] = useState(
    lex?.rkeyMode === 'fixed' ? lex.rkeyDefault || '' : '',
  );
  const [rawMode, setRawMode] = useState(initialMode === 'raw' || !lex);
  const [preview, setPreview] = useState(false);
  const [rawText, setRawText] = useState('');
  // The text the JSON view was last SEEDED with. Raw mode has no field
  // granularity — the whole record is one textarea — so "has the owner edited
  // the JSON?" can only be answered by comparing the text against the text we
  // put there, not against the record.
  const [rawSeed, setRawSeed] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  // A transient object URL so a cover image set from inside a link card shows
  // in the cover field right away (a fresh blob has no `_url` until reload).
  const [coverPreview, setCoverPreview] = useState(null);
  const coverPreviewRef = useRef(null);
  coverPreviewRef.current = coverPreview;
  useEffect(() => () => {
    if (coverPreviewRef.current) URL.revokeObjectURL(coverPreviewRef.current);
  }, []);

  /** Put text in the JSON view and remember it as the "unedited" reading. */
  const seedRaw = useCallback((text) => {
    setRawText(text);
    setRawSeed(text);
  }, []);

  // Where the PDS endpoint lands once the display-only lookup resolves. A REF,
  // not state: it is read when leaving the JSON view (to re-bake the display
  // URLs the raw text never carries) and must not re-render anything on arrival.
  // It stays null on the new-record branch, which never runs `load()` — so every
  // read of it has to tolerate null, exactly as `annotateRecordBlobs` already does.
  const pdsRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (isNew) {
      // Merge any caller-supplied presets (e.g. a default publication for a
      // new creative work) over the lexicon's blank defaults.
      const draft = { ...blankRecordFor(collection), ...(initialValue || {}) };
      setValue(draft);
      setBaseline(normalizeForDiff(draft, lex));
      seedRaw(JSON.stringify(draft, null, 2));
      if (!lex) setRawMode(true);
      return undefined;
    }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await agent.com.atproto.repo.getRecord({
          repo: did,
          collection,
          rkey,
        });
        const fetched = (res?.data || res)?.value || {};
        if (cancelled) return;
        // Normalize BlobRef instances to plain JSON *before* any clone/migrate
        // (structuredClone would corrupt them and strip images on save).
        const plain = toPlainRecord(fetched);
        const migrated = lex?.migrate ? lex.migrate(plain) : plain;
        setValue(migrated);
        setBaseline(normalizeForDiff(migrated, lex));
        // The raw-JSON view and payload must stay clean of `_url` annotations.
        seedRaw(JSON.stringify(stripUrlAnnotations(migrated), null, 2));
        if (!lex) setRawMode(true);

        // Baking display URLs onto blob refs is the LAST thing the record needs
        // and it used to be the first thing it waited for: this resolve sat in
        // front of the first field, unbounded, for a measured 28.6 seconds when
        // plc.directory was slow. It is display-only — the record loads, edits
        // and saves without it — so it now runs after the form has painted, is
        // bounded, and is skipped entirely for record types that cannot carry a
        // blob in the first place.
        if (!couldCarryBlobs(lex)) return;
        resolvePdsBounded(did).then((pds) => {
          if (cancelled || !pds) return;
          pdsRef.current = pds;
          setValue((prev) => {
            // Only annotate the value we loaded. If the owner has already typed,
            // `prev` is a different object and their edit outranks a cosmetic URL.
            if (prev !== migrated) return prev;
            // Annotation mutates, so it has to run on a copy or React would see
            // the same object back and skip the render the new URLs are for.
            const annotated = toPlainRecord(prev);
            annotateRecordBlobs(annotated, lex, pds, did);
            return annotated;
          });
        });
      } catch (err) {
        if (!cancelled) setError(err?.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [agent, did, collection, rkey, isNew, lex, initialValue, seedRaw]);

  const updateField = useCallback((key, next) => {
    setValue((prev) => ({ ...(prev || {}), [key]: next }));
  }, []);

  /* --- which body is on screen ----------------------------------------- */

  // Controlled when the caller passes `mode`. The internal `rawMode`/`preview`
  // state stays put — untouched and unread — so an uncontrolled caller behaves
  // exactly as it did before this prop existed.
  const controlled = mode != null;
  // `|| !lex` folds in what the render used to spell out at each use site: with
  // no lexicon there is no form to draw, so raw is the only body available.
  const rawActive = (controlled ? mode === 'raw' : rawMode) || !lex;
  const previewActive = controlled ? mode === 'preview' : preview;

  /**
   * The outgoing record built from the FORM's value, whatever body is on screen.
   * Split out from `buildRecordPayload` — which dispatches on the active body —
   * because the JSON view seeds itself from here at the very moment raw mode
   * becomes active, and a dispatching build would hand it back the stale text it
   * is about to replace, silently discarding every form edit made beforehand.
   *
   * @param {{stampAuto?: boolean}} [opts] `stampAuto: false` skips the
   *   `autoOnEdit` bump. The JSON view seeds itself that way, because a payload
   *   built for display would otherwise show an `updatedAt` the record does not
   *   carry — a field invented by the act of looking at it.
   */
  const buildFormPayload = useCallback(({ stampAuto = true } = {}) => {
    const next = { ...(value || {}) };
    if (lex?.typeFieldValue) next.$type = lex.typeFieldValue;
    if (lex?.fields && stampAuto) {
      for (const f of lex.fields) {
        if (f.autoOnEdit && !isNew) {
          next[f.key] = new Date().toISOString();
        }
      }
    }
    if (lex?.fields) {
      for (const f of lex.fields) {
        if (f.type === 'blocks') continue; // an empty pub.leaflet.content shell is still a valid body
        if (!f.required && (next[f.key] === '' || next[f.key] === undefined || next[f.key] === null)) {
          delete next[f.key];
        }
        // Drop empty arrays (tags, highlights, resume entries, skill groups, …)
        // for optional fields so records stay clean.
        if (Array.isArray(next[f.key]) && next[f.key].length === 0 && !f.required) {
          delete next[f.key];
        }
      }
    }
    if (Array.isArray(lex?.stripLegacyKeys)) {
      for (const k of lex.stripLegacyKeys) delete next[k];
    }
    // Normalize first (runs BlobRef.toJSON on freshly uploaded blobs → clean
    // wire form; a plain recursive walk would mangle those instances), then
    // drop the `_url` display annotations so they never reach the PDS.
    return stripUrlAnnotations(toPlainRecord(next));
  }, [value, lex, isNew]);

  /**
   * What Save writes. The JSON body is AUTHORITATIVE while it is the active one:
   * saving from the JSON tab saves that text, not the form behind it.
   */
  const buildRecordPayload = useCallback(() => {
    if (rawActive) {
      const parsed = JSON.parse(rawText);
      if (lex?.typeFieldValue && !parsed.$type) parsed.$type = lex.typeFieldValue;
      return parsed;
    }
    return buildFormPayload();
  }, [buildFormPayload, lex, rawActive, rawText]);

  /**
   * The record on screen is now the record the PDS holds. Re-baseline from it so
   * the status strip goes clean the instant the write returns rather than after
   * a refetch, re-seed both bodies from the same object, and flash "Saved.".
   */
  const markSaved = useCallback(
    (record) => {
      setBaseline(normalizeForDiff(record, lex));
      setValue(record);
      seedRaw(JSON.stringify(record, null, 2));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
    },
    [lex, seedRaw],
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    try {
      const record = buildRecordPayload();
      if (isNew) {
        if (lex?.rkeyMode === 'fixed') {
          const chosen = rkeyDraft.trim();
          if (!chosen) throw new Error('Pick an rkey for this record.');
          const finalRecord = lex.derive ? lex.derive(record, { rkey: chosen }) : record;
          await agent.com.atproto.repo.putRecord({
            repo: did,
            collection,
            rkey: chosen,
            record: finalRecord,
          });
          // Refresh the editor's own state before handing off, exactly as the
          // edit path below does. Today this branch returns without it, leaving
          // the form claiming unsaved changes to a record already written — a
          // gap that only stayed invisible because every caller hard-navigated
          // afterwards. The workbench navigates in place.
          markSaved(finalRecord);
          onCreated?.({ rkey: chosen, record: finalRecord });
          return;
        }
        const res = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection,
          record,
        });
        const data = res?.data || res;
        const newRkey = rkeyFromUri(data?.uri || '');
        // If the lexicon has rkey-derived fields (e.g. site.standard.document.path),
        // stamp them now and re-put the record. Cheap enough — one extra write
        // on first save, then plain putRecord on every subsequent edit.
        if (lex?.derive && newRkey) {
          const finalRecord = lex.derive(record, { rkey: newRkey });
          await agent.com.atproto.repo.putRecord({
            repo: did,
            collection,
            rkey: newRkey,
            record: finalRecord,
          });
          onCreated?.({ rkey: newRkey, record: finalRecord, uri: data?.uri });
          return;
        }
        onCreated?.({ rkey: newRkey, record, uri: data?.uri });
        return;
      }
      const finalRecord = lex?.derive ? lex.derive(record, { rkey }) : record;
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection,
        rkey,
        record: finalRecord,
      });
      markSaved(finalRecord);
      onSaved?.(finalRecord);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (isNew) return;
    if (!window.confirm(`Delete ${collection}/${rkey}? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
      onDeleted?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      // Reset on SUCCESS too. Every caller before the workbench either unmounted
      // or hard-navigated on delete, so the flag never had to come back down; a
      // persistent pane would leave the button stuck on "Deleting…" forever.
      setDeleting(false);
    }
  }

  /* --- entering and leaving the JSON body ------------------------------- */

  /** Seed the textarea from the FORM's record, without the auto `updatedAt` bump. */
  function enterRawBody() {
    // Never clobber unparsed work. Text this view could not read on the way out
    // means the owner is mid-edit in JSON and came back to finish; their text is
    // the thing to keep, not a re-serialization of the value they were replacing.
    if (rawText.trim() && !isParseableJson(rawText)) return;
    seedRaw(JSON.stringify(buildFormPayload({ stampAuto: false }), null, 2));
  }

  /**
   * Parse the textarea back into the form's value. Returns false when the text
   * is not valid JSON, which is the uncontrolled toolbar's cue to stay put.
   */
  function leaveRawBody() {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return false;
    }
    // `rawText` is stored `_url`-free, so a plain `setValue(parsed)` drops every
    // display URL baked on at load: existing images come back as "Click to
    // upload" in the blocks editor and vanish from Preview. Re-bake them from
    // the PDS cached at load — never a fresh `resolvePds` per toggle — and note
    // that `pdsRef` is null on the new-record branch, where `annotateRecordBlobs`
    // no-ops by its own contract.
    annotateRecordBlobs(parsed, lex, pdsRef.current, did);
    setValue(parsed);
    return true;
  }

  function toggleRawMode() {
    if (!lex) return; // raw is forced for unknown lexicons
    // Controlled: ask, don't act. The caller flips `mode`, and the effect below
    // does the same enter/leave work this function does for everyone else.
    if (controlled) {
      onModeChange?.(rawActive ? 'form' : 'raw');
      return;
    }
    if (!rawMode) enterRawBody();
    else if (!leaveRawBody()) return; // stay in raw mode if parse fails
    setRawMode((m) => !m);
  }

  function togglePreview() {
    if (controlled) {
      onModeChange?.(previewActive ? (rawActive ? 'raw' : 'form') : 'preview');
      return;
    }
    setPreview((p) => !p);
  }

  // A controlled caller changes `mode` from the outside, so the enter/leave work
  // has to happen here rather than in `toggleRawMode`. Ref-held so the effect can
  // depend on the transition alone and not on two closures that change identity
  // every keystroke. Uncontrolled callers — the public quick-edit sheet and
  // /exploring — never reach this branch, which is what keeps their behaviour
  // (parse-error refusal included) byte-for-byte what it was.
  const enterRawRef = useRef(null);
  const leaveRawRef = useRef(null);
  enterRawRef.current = enterRawBody;
  leaveRawRef.current = leaveRawBody;
  const wasRawRef = useRef(rawActive);
  useEffect(() => {
    const wasRaw = wasRawRef.current;
    wasRawRef.current = rawActive;
    if (!controlled || wasRaw === rawActive) return;
    // Unparseable JSON on the way out keeps the last good value AND the text:
    // nothing is lost, the tab bar is not fought, and the error the textarea
    // already shows is the explanation.
    if (rawActive) enterRawRef.current();
    else leaveRawRef.current();
  }, [controlled, rawActive]);

  // Expose save/delete imperatively so an external controller (the quick-edit
  // sheet's action bar) can drive them. Stable handle backed by refs so it
  // always calls the latest closures.
  const saveRef = useRef(null);
  const deleteRef = useRef(null);
  saveRef.current = handleSave;
  deleteRef.current = handleDelete;
  useImperativeHandle(
    ref,
    () => ({
      save: () => saveRef.current?.(),
      remove: () => deleteRef.current?.(),
    }),
    [],
  );

  useEffect(() => {
    onStatus?.({ saving, deleting, loading, isNew });
  }, [saving, deleting, loading, isNew, onStatus]);

  /* --- dirtiness -------------------------------------------------------- */

  // ONE memo returning the whole payload, labels included. Splitting it into a
  // `{dirty, keys}` memo plus a `labelFields()` call at the use site would hand
  // the consumer a fresh array every render and loop any effect that stores it.
  const dirtyStatus = useMemo(() => {
    // Nobody is listening. The walk below is not free on a long blocks body, and
    // the public quick-edit sheet passes no handler — it must not pay for a
    // question it never asks.
    if (!onDirtyChange) return null;
    // Raw mode has no field granularity: the whole record is one textarea, so
    // the only honest comparison is text against the text we seeded it with.
    if (rawActive && rawText !== rawSeed) return RAW_DIRTY_STATUS;
    if (!baseline) return CLEAN_STATUS;
    // Falls through to the field diff when the textarea is untouched, because
    // edits made in the form BEFORE switching to JSON are still unsaved.
    const { dirty, keys } = diffRecord(baseline, normalizeForDiff(value, lex), lex);
    if (!dirty) return CLEAN_STATUS;
    return { dirty: true, fields: labelFields(keys, lex), note: null };
  }, [onDirtyChange, value, rawText, rawSeed, rawActive, baseline, lex]);

  useEffect(() => {
    if (dirtyStatus) onDirtyChange?.(dirtyStatus);
  }, [dirtyStatus, onDirtyChange]);

  if (loading) {
    return <AdminEditorSkeleton fields={compact ? 3 : 4} />;
  }

  return (
    <div className={`record-editor reveal${compact ? ' record-editor-compact' : ''}`}>
      {/* A caller with its own tab bar hides this row. `hideActions` deliberately
          does NOT — that prop is about Save/Delete, and this row has never been
          under a compact or hideActions guard, which is why the public sheet
          shows it. */}
      {!hideModeToolbar && (
        <div className="admin-toolbar admin-toolbar-inline">
          {lex && !previewActive && (
            <button
              type="button"
              className="admin-link-subtle"
              onClick={toggleRawMode}
            >
              {rawActive ? 'Use form' : 'Edit JSON'}
            </button>
          )}
          {lex && (
            <button
              type="button"
              className="admin-link-subtle"
              onClick={togglePreview}
            >
              {previewActive ? 'Back to editor' : 'Preview'}
            </button>
          )}
        </div>
      )}

      {isNew && lex?.rkeyMode === 'fixed' && !compact && (
        <div className="admin-field">
          <label className="admin-field-label" htmlFor="record-editor-rkey">
            Record key (rkey)
          </label>
          <input
            id="record-editor-rkey"
            className="admin-input"
            value={rkeyDraft}
            onChange={(e) => setRkeyDraft(e.target.value)}
            placeholder={lex.rkeyPlaceholder || 'rkey'}
          />
          {lex.rkeyPlaceholder && (
            <p className="admin-field-hint">
              Typical values: <code>{lex.rkeyPlaceholder}</code>
            </p>
          )}
        </div>
      )}

      {previewActive && lex ? (
        <>
          <RecordPreview lex={lex} record={previewRecordFor(rawActive, rawText, value)} />
          {/* `.wb-editor-*` because the caption is the workbench's, not the
              preview's: `.record-preview*` is frozen public API owned by
              Admin.css, and this component renders on public routes too. */}
          {previewNote && <p className="admin-field-hint wb-editor-note">{previewNote}</p>}
        </>
      ) : rawActive ? (
        <RawJsonEditor value={rawText} onChange={setRawText} />
      ) : (
        <FormEditor
          lex={lex}
          value={value || {}}
          onChange={updateField}
          agent={agent}
          did={did}
          collection={collection}
          rkey={rkey}
          coverPreview={coverPreview}
          onSetCover={(key, blob, previewUrl) => {
            updateField(key, blob);
            setCoverPreview((prev) => {
              if (prev && prev !== previewUrl) URL.revokeObjectURL(prev);
              return previewUrl || null;
            });
          }}
        />
      )}

      {error && <p className="admin-error">{error}</p>}
      {savedFlash && <p className="admin-success">Saved.</p>}

      {!hideActions && (
        <div className="admin-actions">
          <button
            type="button"
            className="admin-gate-button"
            onClick={handleSave}
            disabled={saving || deleting}
          >
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
          {!isNew && (
            <button
              type="button"
              className="admin-gate-button admin-danger"
              onClick={handleDelete}
              disabled={saving || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default RecordEditor;

/* ------------------------------------------------------------------ */
/* Field renderers                                                      */
/* ------------------------------------------------------------------ */

function FormEditor({ lex, value, onChange, agent, did, collection, rkey, coverPreview, onSetCover }) {
  // If this record type carries a top-level image field (e.g. a document's
  // coverImage), link cards can offer to reuse their preview image as it.
  const coverField = lex.fields.find((f) => f.type === 'image');
  const setCover = coverField
    ? (blob, previewUrl) => onSetCover(coverField.key, blob, previewUrl)
    : null;

  return (
    <div className="admin-form">
      {lex.fields.map((f) => (
        <Field
          key={f.key}
          field={f}
          value={value[f.key]}
          record={value}
          onChange={(v) => onChange(f.key, v)}
          agent={agent}
          did={did}
          collection={collection}
          rkey={rkey}
          onSetCover={f.type === 'blocks' ? setCover : undefined}
          externalPreview={coverField && f.key === coverField.key ? coverPreview : undefined}
        />
      ))}
    </div>
  );
}

/**
 * Choose what to preview. In form mode the live `value` is authoritative; in
 * raw-JSON mode parse the textarea (falling back to `value` if it's mid-edit
 * and not valid JSON yet).
 */
function previewRecordFor(rawMode, rawText, value) {
  if (rawMode) {
    try {
      return JSON.parse(rawText);
    } catch {
      return value || {};
    }
  }
  return value || {};
}

/**
 * Render a record roughly as it appears on the site: title + lead, then any
 * `blocks` body via the shared LeafletDocument renderer and any `markdown`
 * body via the markdown pipeline. Other fields (timestamps, pickers) are
 * omitted — this is a reading preview, not a field dump.
 */
function RecordPreview({ lex, record }) {
  const v = record || {};
  const fields = lex?.fields || [];
  const lead = v.description ?? v.intro ?? v.tagline ?? v.summary ?? '';

  const bodies = fields
    .map((f) => {
      if (f.type === 'blocks' && v[f.key]) {
        return <LeafletDocument key={f.key} doc={v[f.key]} />;
      }
      if (f.type === 'markdown' && v[f.key]) {
        const html = renderMarkdown(v[f.key], v.bodyFormat || 'markdown');
        return (
          <div
            key={f.key}
            className="blog-prose"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
      return null;
    })
    .filter(Boolean);

  const empty = !v.title && !lead && bodies.length === 0;

  return (
    <div className="record-preview blog-article">
      {v.title && <h1 className="record-preview-title">{v.title}</h1>}
      {lead && <p className="record-preview-lead">{lead}</p>}
      {bodies}
      {empty && <p className="admin-field-hint">Nothing to preview yet.</p>}
    </div>
  );
}

function Field({ field, value, record, onChange, agent, did, collection, rkey, onSetCover, externalPreview }) {
  const id = `record-editor-field-${field.key}`;
  let control;
  switch (field.type) {
    case 'text':
      control = (
        <input
          id={id}
          className="admin-input"
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          maxLength={field.maxLength || undefined}
        />
      );
      break;
    case 'textarea':
      control = (
        <textarea
          id={id}
          className="admin-input admin-textarea"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          maxLength={field.maxLength || undefined}
          rows={4}
        />
      );
      break;
    case 'markdown':
      control = (
        <textarea
          id={id}
          className="admin-input admin-textarea admin-textarea-tall admin-mono"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={16}
        />
      );
      break;
    case 'datetime':
      control = <DatetimeField id={id} value={value} onChange={onChange} />;
      break;
    case 'tags':
      control = (
        <TagsInput id={id} value={value} onChange={onChange} placeholder="comma, separated" />
      );
      break;
    case 'number':
      control = (
        <input
          id={id}
          className="admin-input"
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
      break;
    case 'select':
      control = (
        <select
          id={id}
          className="admin-input"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {!field.required && <option value="">—</option>}
          {(field.options || []).map((opt) => {
            const val = typeof opt === 'string' ? opt : opt.value;
            const lbl = typeof opt === 'string' ? opt : opt.label ?? opt.value;
            return (
              <option key={val} value={val}>
                {lbl}
              </option>
            );
          })}
        </select>
      );
      break;
    case 'boolean':
      control = (
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
      break;
    case 'json':
      control = <JsonField id={id} value={value} onChange={onChange} />;
      break;
    case 'bskyThread':
      control = <BskyThreadField id={id} value={value} onChange={onChange} />;
      break;
    case 'highlights':
      control = (
        <HighlightsField
          value={value}
          onChange={onChange}
          agent={agent}
          did={did}
          // Existing records get "used by <resume>" chips + delete guards;
          // a record still being created has no URI to scan for yet.
          recordUri={rkey ? `at://${did}/${collection}/${rkey}` : null}
          usageKeys={
            collection === COLLECTIONS.resumeEducation
              ? { listKey: 'education', refKey: 'education' }
              : { listKey: 'entries', refKey: 'job' }
          }
        />
      );
      break;
    case 'recordRefs':
      control = (
        <RecordRefsField field={field} value={value} onChange={onChange} agent={agent} did={did} />
      );
      break;
    case 'skillGroups':
      control = <SkillGroupsField value={value} onChange={onChange} />;
      break;
    case 'links':
      control = <LinksField value={value} onChange={onChange} agent={agent} did={did} />;
      break;
    case 'contact':
      control = <ContactField value={value} onChange={onChange} />;
      break;
    case 'category':
      control = (
        <CategoryField
          id={id}
          value={value}
          onChange={onChange}
          placeholder={field.placeholder}
          suggestions={field.suggestions || []}
        />
      );
      break;
    case 'blocks':
      control = (
        <BlocksEditor
          agent={agent}
          did={did}
          value={value}
          onChange={onChange}
          onSetCover={onSetCover}
        />
      );
      break;
    case 'image':
      control = (
        <ImageField
          id={id}
          value={value}
          onChange={onChange}
          agent={agent}
          externalPreview={externalPreview}
        />
      );
      break;
    case 'arenaCover':
      control = (
        <ArenaCoverField value={value} onChange={onChange} arenaSlug={record?.arenaSlug} />
      );
      break;
    case 'publicationPicker':
      control = (
        <PublicationPickerField
          id={id}
          value={value}
          onChange={onChange}
          agent={agent}
          did={did}
        />
      );
      break;
    default:
      control = (
        <input
          id={id}
          className="admin-input"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }

  return (
    <div className="admin-field">
      {field.type !== 'boolean' && (
        <label className="admin-field-label" htmlFor={id}>
          {field.label}
          {field.required && <span className="admin-field-required"> *</span>}
        </label>
      )}
      {control}
      {field.hint && <p className="admin-field-hint">{field.hint}</p>}
      {field.maxLength && typeof value === 'string' && (
        <p className="admin-field-hint">
          {value.length} / {field.maxLength}
        </p>
      )}
    </div>
  );
}

function DatetimeField({ id, value, onChange }) {
  const local = isoToLocalInput(value);
  return (
    <div className="admin-datetime">
      <input
        id={id}
        className="admin-input"
        type="datetime-local"
        step="1"
        value={local}
        onChange={(e) => {
          const next = localInputToIso(e.target.value);
          onChange(next);
        }}
      />
      <button type="button" className="admin-link-subtle" onClick={() => onChange(new Date().toISOString())}>
        now
      </button>
    </div>
  );
}

function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function localInputToIso(local) {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function JsonField({ id, value, onChange }) {
  const [text, setText] = useState(() => stringifyJson(value));
  const [parseError, setParseError] = useState(null);

  useEffect(() => {
    setText(stringifyJson(value));
  }, [value]);

  return (
    <div>
      <textarea
        id={id}
        className="admin-input admin-textarea admin-mono"
        rows={6}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (!next.trim()) {
            setParseError(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(next);
            setParseError(null);
            onChange(parsed);
          } catch (err) {
            setParseError(err.message);
          }
        }}
      />
      {parseError && <p className="admin-field-hint admin-error-inline">JSON error: {parseError}</p>}
    </div>
  );
}

function stringifyJson(v) {
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return '';
  }
}

/**
 * Links a Bluesky post whose reply thread becomes a blog post's comments
 * (stored on `commentsUri`, which BlogPost.jsx feeds to getPostThread). The
 * author can paste any of: a bsky.app post URL, an `at://` URI, or a bare
 * rkey — all normalized to the canonical `at://{did}/app.bsky.feed.post/{rkey}`
 * form that legacy migrated posts already use. A handle-based URL (or bare
 * rkey) assumes the post is the site owner's own; a DID in the URL is kept.
 */
function BskyThreadField({ id, value, onChange }) {
  // `raw` mirrors what the author typed; the record stores the normalized URI.
  const [raw, setRaw] = useState(value || '');
  // Ignore the echo of our own emit so re-normalization doesn't clobber typing;
  // still re-sync when the record itself loads/changes underneath us.
  const lastEmitted = useRef(value || '');
  useEffect(() => {
    if ((value || '') !== lastEmitted.current) {
      setRaw(value || '');
      lastEmitted.current = value || '';
    }
  }, [value]);

  const normalized = normalizeBskyThread(raw);
  return (
    <div>
      <input
        id={id}
        className="admin-input"
        type="text"
        value={raw}
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          const norm = normalizeBskyThread(next) || undefined;
          lastEmitted.current = norm || '';
          onChange(norm);
        }}
        placeholder="https://bsky.app/profile/you/post/3k… — or an rkey"
      />
      {raw.trim() &&
        (normalized ? (
          <p className="admin-field-hint">
            Comments load from <code>{normalized}</code>
          </p>
        ) : (
          <p className="admin-field-hint admin-error-inline">
            Couldn’t read a Bluesky post reference from that.
          </p>
        ))}
    </div>
  );
}

/** rkey / bsky.app URL / at:// URI → canonical at:// post URI (or '' if none). */
function normalizeBskyThread(input) {
  const s = (input || '').trim();
  if (!s) return '';
  if (s.startsWith('at://')) return s;
  // A post URL: …/profile/{handle-or-did}/post/{rkey}
  const url = s.match(/\/profile\/([^/\s]+)\/post\/([a-z0-9]+)/i);
  if (url) {
    const repo = url[1].startsWith('did:') ? url[1] : ME_DID;
    return `at://${repo}/app.bsky.feed.post/${url[2]}`;
  }
  // A bare rkey — assume the owner's own post.
  if (/^[a-z0-9]+$/i.test(s)) return `at://${ME_DID}/app.bsky.feed.post/${s}`;
  return '';
}

function RawJsonEditor({ value, onChange }) {
  const [parseError, setParseError] = useState(null);
  return (
    <div className="admin-field">
      <label className="admin-field-label">Raw record JSON</label>
      <textarea
        className="admin-input admin-textarea admin-textarea-tall admin-mono"
        value={value}
        rows={20}
        onChange={(e) => {
          onChange(e.target.value);
          try {
            JSON.parse(e.target.value);
            setParseError(null);
          } catch (err) {
            setParseError(err.message);
          }
        }}
      />
      {parseError && <p className="admin-field-hint admin-error-inline">JSON error: {parseError}</p>}
    </div>
  );
}

export function rkeyFromUri(uri) {
  const m = String(uri || '').match(/\/([^/]+)$/);
  return m ? m[1] : uri;
}

function CategoryField({ id, value, onChange, placeholder, suggestions }) {
  return (
    <div className="category-field">
      <input
        id={id}
        className="admin-input"
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
      />
      {suggestions.length > 0 && (
        <div className="category-field-suggestions">
          {suggestions.map((s) => {
            const active = (value || '').toLowerCase() === s.toLowerCase();
            return (
              <button
                key={s}
                type="button"
                className={`category-field-chip${active ? ' is-active' : ''}`}
                onClick={() => onChange(s)}
              >
                {s}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Single-blob image field (e.g. a document's `coverImage`). Click or drop to
 * upload to the PDS; stores the returned BlobRef. Mirrors ImageBlockEditor's
 * upload flow but for one top-level field rather than a content block.
 */
function ImageField({ id, value, onChange, agent, externalPreview }) {
  const [status, setStatus] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus("That doesn't look like an image.");
      return;
    }
    setStatus('Uploading…');
    const local = URL.createObjectURL(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(local);
    try {
      const { blob } = await uploadImageFile(agent, file);
      onChange(blob);
      setStatus(null);
    } catch (err) {
      setStatus(`Upload failed: ${err?.message || err}`);
    }
  }

  const displayUrl = previewUrl || value?._url || externalPreview || null;

  return (
    <div className="image-block-editor">
      <div
        className={`image-block-dropzone${displayUrl ? ' has-image' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFile(e.dataTransfer?.files?.[0]);
        }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        {displayUrl ? (
          <img src={displayUrl} alt="" />
        ) : (
          <div className="image-block-dropzone-empty">Click to upload or drop an image</div>
        )}
        <input
          id={id}
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) handleFile(file);
          }}
        />
      </div>
      {status && <p className="admin-field-hint">{status}</p>}
      {value && (
        <button type="button" className="admin-link-subtle" onClick={() => onChange(undefined)}>
          Remove image
        </button>
      )}
    </div>
  );
}

/**
 * Cover picker for an are.na gallery (`is.dame.arena.channel`). Loads the
 * channel's images (through the same-origin proxy) and lets the author click
 * one to front the gallery; the stored value is that block's are.na id.
 */
function ArenaCoverField({ value, onChange, arenaSlug }) {
  const [blocks, setBlocks] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const slug = (arenaSlug || '').trim();
    if (!slug) {
      setBlocks(null);
      setStatus('Enter the are.na channel slug first, then reopen this record to pick a cover.');
      return undefined;
    }
    setStatus('Loading images…');
    setBlocks(null);
    // Cap the pull so a huge channel doesn't hammer the API — enough to choose from.
    fetchAllBlocks(slug, { maxPages: 2 })
      .then(({ blocks: bs, truncated }) => {
        if (cancelled) return;
        // Only image/link blocks can be a cover — text tiles have no thumbnail.
        const pickable = bs.filter((b) => b.thumb?.src);
        setBlocks(pickable);
        setStatus(
          pickable.length === 0
            ? 'No images found in that channel.'
            : truncated
              ? `Showing the first ${pickable.length} images.`
              : null,
        );
      })
      .catch((err) => {
        if (!cancelled) setStatus(`Could not load images: ${err?.message || err}`);
      });
    return () => {
      cancelled = true;
    };
  }, [arenaSlug]);

  return (
    <div className="arena-cover-field">
      <div className="arena-cover-actions">
        <span className="admin-field-hint">
          {value ? 'Selected image fronts the gallery.' : 'Using the first image (default).'}
        </span>
        {value != null && value !== '' && (
          <button type="button" className="admin-link-subtle" onClick={() => onChange(undefined)}>
            Use first image
          </button>
        )}
      </div>
      {status && <p className="admin-field-hint">{status}</p>}
      {Array.isArray(blocks) && blocks.length > 0 && (
        <ul className="arena-cover-grid">
          {blocks.map((b) => {
            const selected = String(b.id) === String(value);
            return (
              <li key={b.id}>
                <button
                  type="button"
                  className={`arena-cover-thumb${selected ? ' is-selected' : ''}`}
                  onClick={() => onChange(selected ? undefined : b.id)}
                  title={b.title || 'Untitled block'}
                  aria-pressed={selected}
                >
                  <img src={b.thumb?.src} alt={b.alt || ''} loading="lazy" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PublicationPickerField({ id, value, onChange, agent, did }) {
  const [pubs, setPubs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection: 'site.standard.publication',
          limit: 50,
        });
        const records = (res?.data || res)?.records || [];
        if (!cancelled) setPubs(records);
      } catch (err) {
        if (!cancelled) setError(err?.message || String(err));
      }
    }
    if (agent && did) load();
    return () => {
      cancelled = true;
    };
  }, [agent, did]);

  if (error) {
    return <p className="admin-field-hint admin-error-inline">Couldn't load publications: {error}</p>;
  }
  if (pubs == null) {
    return <p className="admin-field-hint">Loading publications…</p>;
  }
  if (pubs.length === 0) {
    return (
      <p className="admin-field-hint">
        No site.standard.publication records found under this DID. Create one in standard.site first.
      </p>
    );
  }
  return (
    <select
      id={id}
      className="admin-input"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— pick a publication —</option>
      {pubs.map((r) => {
        // site.standard.publication records carry a `name`; fall back to a
        // legacy `title`, then the rkey if neither is present.
        const label = r?.value?.name || r?.value?.title || rkeyFromUri(r.uri);
        return (
          <option key={r.uri} value={r.uri}>
            {label}
          </option>
        );
      })}
    </select>
  );
}
