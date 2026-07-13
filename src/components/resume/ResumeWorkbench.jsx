import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronUp, ChevronDown, GitBranch, PenLine, Plus, RotateCcw, X } from 'lucide-react';
import PageShell from '../PageShell.jsx';
import { AdminEditorSkeleton } from '../Skeleton.jsx';
import { SkillGroupsField, ContactField } from '../resumeFields.jsx';
import { useEditMode } from '../../hooks/useEditMode.jsx';
import { COLLECTIONS } from '../../config.js';
import { rkeyFromAtUri } from '../../lib/atproto.js';
import {
  formatDateRange,
  parseHighlightRef,
  makeHighlightRef,
  nextHighlightId,
  nextVariantId,
  resolveHighlightRef,
  collectHighlightUsage,
} from '../../lib/resumeHelpers.js';
import { useResumeBundle } from './useResumeBundle.js';
import './resumeStudio.css';

/**
 * The tailoring workbench — a resume-centric editor for one version.
 *
 * Everything you'd do to adapt a resume for an audience happens on this one
 * page: reframe the headline/summary, pick and order jobs, and work the
 * bullets — include/exclude, reorder, re-word, and fork a bullet into an
 * alternate phrasing that only this version uses.
 *
 * Bullet copy lives on the canonical job/education records, so those edits are
 * *staged* here (the touched records are listed next to Save) and written back
 * together with the resume in one save. Forking creates a variant on the job
 * (`highlights[].variants`) and points this resume's selection at it
 * (`highlightIds: ["h3#v2"]`); the canonical text and every other version stay
 * untouched.
 */

const KINDS = {
  job: {
    listKey: 'entries',
    refKey: 'job',
    collection: COLLECTIONS.resumeJob,
    overrides: true,
    heading: 'Experience',
    noun: 'job',
  },
  education: {
    listKey: 'education',
    refKey: 'education',
    collection: COLLECTIONS.resumeEducation,
    overrides: false,
    heading: 'Education',
    noun: 'education entry',
  },
};

/** Label a canonical record for card heads and pickers. */
function recordLabel(kind, value) {
  if (kind === 'job') {
    return [value?.title, value?.organization].filter(Boolean).join(' · ');
  }
  return [value?.institution, value?.studyType || value?.area].filter(Boolean).join(' · ');
}

/** The refs an entry currently selects — explicit list, or the default set. */
function refsFor(entry, value) {
  if (Array.isArray(entry?.highlightIds)) return entry.highlightIds;
  const hs = Array.isArray(value?.highlights) ? value.highlights : [];
  return hs.filter((h) => (h.visibility || 'public') !== 'private').map((h) => h.id);
}

function moveItem(arr, from, to) {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function ResumeWorkbench({ agent, did, rkey }) {
  const navigate = useNavigate();
  const { setPageEditor } = useEditMode();
  const { resumes, jobs, education, loading: bundleLoading, error: loadError } = useResumeBundle(agent, did);

  // The resume value being tailored, plus staged drafts of every canonical
  // job/education record (bullet copy edits and forks land on those).
  const [draft, setDraft] = useState(null);
  const [recordDrafts, setRecordDrafts] = useState(() => new Map()); // uri → value
  const [dirtyUris, setDirtyUris] = useState(() => new Set());
  const [resumeDirty, setResumeDirty] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState(null);
  // One bullet's copy editor open at a time: `${listKey}:${uri}:${baseId}`.
  const [editingKey, setEditingKey] = useState(null);

  // Initialize drafts once per rkey, from the loaded bundle.
  const initializedFor = useRef(null);
  useEffect(() => {
    if (bundleLoading || initializedFor.current === rkey) return;
    const rec = (resumes || []).find((r) => rkeyFromAtUri(r.uri) === rkey);
    if (!rec) {
      setNotFound(true);
      initializedFor.current = rkey;
      return;
    }
    const m = new Map();
    for (const r of [...(jobs || []), ...(education || [])]) {
      m.set(r.uri, JSON.parse(JSON.stringify(r.value)));
    }
    setDraft(JSON.parse(JSON.stringify(rec.value)));
    setRecordDrafts(m);
    setDirtyUris(new Set());
    setResumeDirty(false);
    setNotFound(false);
    initializedFor.current = rkey;
  }, [bundleLoading, resumes, jobs, education, rkey]);

  const isLoading = bundleLoading || (!draft && !notFound);
  const dirty = resumeDirty || dirtyUris.size > 0;

  // Other versions, for "also shown on …" context when editing shared copy.
  const otherResumes = useMemo(
    () => (resumes || []).filter((r) => rkeyFromAtUri(r.uri) !== rkey),
    [resumes, rkey],
  );

  /* ---------------------------- mutations --------------------------- */

  const patchDraft = useCallback((patch) => {
    setDraft((prev) => ({ ...(prev || {}), ...patch }));
    setResumeDirty(true);
    setSavedFlash(false);
  }, []);

  const stageRecord = useCallback((uri, nextValue) => {
    setRecordDrafts((prev) => {
      const next = new Map(prev);
      next.set(uri, nextValue);
      return next;
    });
    setDirtyUris((prev) => new Set(prev).add(uri));
    setSavedFlash(false);
  }, []);

  const patchEntry = useCallback((listKey, index, patch) => {
    setDraft((prev) => {
      const list = Array.isArray(prev?.[listKey]) ? prev[listKey].slice() : [];
      list[index] = { ...list[index], ...patch };
      // `undefined` values mean "drop the key" (e.g. clearing an override or
      // resetting a selection to the default-all state).
      for (const k of Object.keys(list[index])) {
        if (list[index][k] === undefined) delete list[index][k];
      }
      return { ...prev, [listKey]: list };
    });
    setResumeDirty(true);
    setSavedFlash(false);
  }, []);

  const moveEntry = useCallback((listKey, from, to) => {
    setDraft((prev) => {
      const list = Array.isArray(prev?.[listKey]) ? prev[listKey] : [];
      return { ...prev, [listKey]: moveItem(list, from, to) };
    });
    setResumeDirty(true);
  }, []);

  const removeEntry = useCallback((listKey, index) => {
    setDraft((prev) => {
      const list = (prev?.[listKey] || []).slice();
      list.splice(index, 1);
      return { ...prev, [listKey]: list };
    });
    setResumeDirty(true);
  }, []);

  const addEntry = useCallback((listKey, refKey, uri) => {
    setDraft((prev) => {
      const list = Array.isArray(prev?.[listKey]) ? prev[listKey] : [];
      return { ...prev, [listKey]: [...list, { [refKey]: uri }] };
    });
    setResumeDirty(true);
  }, []);

  /* ----------------------------- saving ----------------------------- */

  const save = useCallback(async () => {
    if (saving || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      // Canonical records first, so the resume never points at bullets that
      // don't exist yet (freshly forked variants, added bullets).
      for (const uri of dirtyUris) {
        const parts = String(uri).replace(/^at:\/\//, '').split('/');
        const [, collection, r] = parts;
        const value = recordDrafts.get(uri);
        if (!collection || !r || !value) continue;
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection,
          rkey: r,
          record: { ...value, $type: value.$type || collection, updatedAt: now },
        });
      }
      const record = { ...draft, $type: COLLECTIONS.resume, updatedAt: now };
      if (!record.createdAt) record.createdAt = now;
      for (const k of ['headline', 'summary']) {
        if (!record[k]) delete record[k];
      }
      for (const k of ['entries', 'education', 'skills']) {
        if (Array.isArray(record[k]) && record[k].length === 0) delete record[k];
      }
      if (!record.contact) delete record.contact;
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: COLLECTIONS.resume,
        rkey,
        record,
      });
      setDirtyUris(new Set());
      setResumeDirty(false);
      setSavedFlash(true);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [agent, did, rkey, draft, recordDrafts, dirtyUris, saving]);

  const remove = useCallback(async () => {
    if (deleting) return;
    if (!window.confirm(`Delete this resume version (${rkey})? The jobs and their bullets stay — only the version is removed.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: COLLECTIONS.resume,
        rkey,
      });
      navigate('/admin?view=resume');
    } catch (err) {
      setError(err?.message || String(err));
      setDeleting(false);
    }
  }, [agent, did, rkey, deleting, navigate]);

  const close = useCallback(() => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    navigate('/admin?view=resume');
  }, [dirty, navigate]);

  // Ride the bottom-chrome edit bar (same contract as the record editor page).
  const saveRef = useRef(null);
  const removeRef = useRef(null);
  const closeRef = useRef(null);
  saveRef.current = save;
  removeRef.current = remove;
  closeRef.current = close;
  useEffect(() => {
    setPageEditor({
      save: () => saveRef.current?.(),
      remove: () => removeRef.current?.(),
      close: () => closeRef.current?.(),
      saving,
      deleting,
      loading: isLoading || notFound,
      canDelete: true,
      isNew: false,
    });
    return () => setPageEditor(null);
  }, [setPageEditor, saving, deleting, isLoading, notFound]);

  // Losing a workbench session to a stray tab-close hurts; warn while dirty.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /* ----------------------------- render ----------------------------- */

  const headTitle = `Tailor — ${draft?.title || rkey} — Admin — dame.is`;

  if (notFound) {
    return (
      <PageShell title="Tailor resume" headTitle={headTitle}>
        <p className="placeholder-card">
          No resume version <code>{rkey}</code>.{' '}
          <Link to="/admin?view=resume">Back to the studio.</Link>
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell title={draft?.title ? `Tailor · ${draft.title}` : 'Tailor resume'} headTitle={headTitle}>
      <div className="admin-toolbar">
        <Link to="/admin?view=resume" className="admin-link-subtle">← Resume studio</Link>
        <code className="admin-record-rkey">{rkey}</code>
        {dirty && !saving && (
          <span className="rs-chip rs-chip-warn small-caps" title={
            dirtyUris.size > 0
              ? 'Includes copy edits on the shared job records — saving writes those too.'
              : undefined
          }>
            unsaved{dirtyUris.size > 0 ? ` · ${dirtyUris.size} shared record${dirtyUris.size === 1 ? '' : 's'}` : ''}
          </span>
        )}
        {savedFlash && <span className="rs-chip rs-chip-accent small-caps">saved</span>}
        <span className="rw-toolbar-links">
          <Link
            className="admin-link-subtle"
            to={`/admin?c=${encodeURIComponent(COLLECTIONS.resume)}&r=${encodeURIComponent(rkey)}`}
          >
            raw record
          </Link>
          {draft && (draft.visibility || 'private') !== 'private' && (
            <Link className="admin-link-subtle" to={`/for-hire/${encodeURIComponent(draft.slug || rkey)}`}>
              view ↗
            </Link>
          )}
        </span>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {loadError && <p className="admin-error">{loadError}</p>}

      {isLoading ? (
        <AdminEditorSkeleton fields={5} />
      ) : (
        <div className="rw reveal">
          <FramingSection draft={draft} patchDraft={patchDraft} />

          {['job', 'education'].map((kind) => (
            <EntriesSection
              key={kind}
              kind={kind}
              draft={draft}
              records={kind === 'job' ? jobs : education}
              recordDrafts={recordDrafts}
              dirtyUris={dirtyUris}
              otherResumes={otherResumes}
              resumeSlug={draft?.slug || rkey}
              editingKey={editingKey}
              setEditingKey={setEditingKey}
              patchEntry={patchEntry}
              moveEntry={moveEntry}
              removeEntry={removeEntry}
              addEntry={addEntry}
              stageRecord={stageRecord}
            />
          ))}

          <section className="rw-section">
            <h2 className="admin-collection-group-heading small-caps">Skills</h2>
            <p className="admin-collection-group-note">
              Skill groups live on the version itself — emphasis is the most audience-specific part.
            </p>
            <SkillGroupsField
              value={draft?.skills}
              onChange={(v) => patchDraft({ skills: v })}
            />
          </section>

          <section className="rw-section">
            <h2 className="admin-collection-group-heading small-caps">Contact</h2>
            <p className="admin-collection-group-note">
              Leave blank to fall back to the site profile.
            </p>
            <ContactField
              value={draft?.contact}
              onChange={(v) => patchDraft({ contact: v })}
            />
          </section>
        </div>
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Framing (the version's own copy)                                     */
/* ------------------------------------------------------------------ */

function FramingSection({ draft, patchDraft }) {
  return (
    <section className="rw-section">
      <h2 className="admin-collection-group-heading small-caps">Framing</h2>
      <p className="admin-collection-group-note">
        This version's own copy — name, headline, and summary. Job facts stay on the job records.
      </p>
      <div className="rw-framing">
        <label className="rf-inline-field rf-inline-field-block">
          <span className="rf-inline-label">Title (internal name)</span>
          <input
            className="admin-input"
            type="text"
            value={draft?.title ?? ''}
            placeholder="Product & design résumé"
            onChange={(e) => patchDraft({ title: e.target.value })}
          />
        </label>
        <label className="rf-inline-field rf-inline-field-block">
          <span className="rf-inline-label">Slug (URL at /for-hire/…)</span>
          <input
            className="admin-input"
            type="text"
            value={draft?.slug ?? ''}
            onChange={(e) => patchDraft({ slug: e.target.value })}
          />
        </label>
        <label className="rf-inline-field rf-inline-field-block rw-framing-wide">
          <span className="rf-inline-label">Headline</span>
          <input
            className="admin-input"
            type="text"
            value={draft?.headline ?? ''}
            placeholder="Creative Technologist & Product Designer"
            onChange={(e) => patchDraft({ headline: e.target.value })}
          />
        </label>
        <label className="rf-inline-field rf-inline-field-block rw-framing-wide">
          <span className="rf-inline-label">Summary (Markdown)</span>
          <textarea
            className="admin-input admin-textarea"
            rows={5}
            value={draft?.summary ?? ''}
            onChange={(e) => patchDraft({ summary: e.target.value })}
          />
        </label>
        <label className="rf-inline-field">
          <span className="rf-inline-label">Visibility</span>
          <select
            className="admin-input rf-select-sm"
            value={draft?.visibility || 'private'}
            onChange={(e) => patchDraft({ visibility: e.target.value })}
          >
            <option value="public">public — listed + rendered</option>
            <option value="unlisted">unlisted — URL only</option>
            <option value="private">private — not rendered</option>
          </select>
        </label>
        <label className="admin-checkbox rf-checkbox">
          <input
            type="checkbox"
            checked={Boolean(draft?.featured)}
            onChange={(e) => patchDraft({ featured: e.target.checked })}
          />
          <span>Active — the default at /for-hire (keep to one version)</span>
        </label>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Experience / education entries                                       */
/* ------------------------------------------------------------------ */

function EntriesSection({
  kind,
  draft,
  records,
  recordDrafts,
  dirtyUris,
  otherResumes,
  resumeSlug,
  editingKey,
  setEditingKey,
  patchEntry,
  moveEntry,
  removeEntry,
  addEntry,
  stageRecord,
}) {
  const { listKey, refKey, collection, heading, noun } = KINDS[kind];
  const entries = Array.isArray(draft?.[listKey]) ? draft[listKey] : [];

  const referenced = new Set(entries.map((e) => e?.[refKey]).filter(Boolean));
  const available = (records || []).filter((r) => !referenced.has(r.uri));

  return (
    <section className="rw-section">
      <h2 className="admin-collection-group-heading small-caps">{heading}</h2>
      <p className="admin-collection-group-note">
        {kind === 'job'
          ? 'Which jobs this version shows, in order — and per job, exactly which bullets, in which phrasing.'
          : 'Which education records this version shows, in order.'}
      </p>

      {entries.length === 0 && (
        <p className="admin-field-hint">No {noun} on this version yet — add one below.</p>
      )}

      <div className="rw-entries">
        {entries.map((entry, i) => (
          <EntryCard
            key={`${entry?.[refKey] || 'missing'}-${i}`}
            kind={kind}
            entry={entry}
            index={i}
            count={entries.length}
            recordValue={recordDrafts.get(entry?.[refKey])}
            recordUri={entry?.[refKey]}
            recordDirty={dirtyUris.has(entry?.[refKey])}
            otherResumes={otherResumes}
            resumeSlug={resumeSlug}
            editingKey={editingKey}
            setEditingKey={setEditingKey}
            patchEntry={patchEntry}
            moveEntry={moveEntry}
            removeEntry={removeEntry}
            stageRecord={stageRecord}
          />
        ))}
      </div>

      <AddEntryRow
        noun={noun}
        kind={kind}
        available={available}
        collection={collection}
        onAdd={(uri) => addEntry(listKey, refKey, uri)}
      />
    </section>
  );
}

function AddEntryRow({ noun, kind, available, collection, onAdd }) {
  const [pick, setPick] = useState('');
  return (
    <div className="rw-add-entry">
      {available.length > 0 ? (
        <>
          <select
            className="admin-input rf-ref-select"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">— add a {noun} to this version —</option>
            {available.map((r) => (
              <option key={r.uri} value={r.uri}>
                {recordLabel(kind, r.value) || rkeyFromAtUri(r.uri)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="admin-gate-button admin-gate-button-tight"
            disabled={!pick}
            onClick={() => {
              onAdd(pick);
              setPick('');
            }}
          >
            <Plus size={13} aria-hidden="true" /> Add
          </button>
        </>
      ) : (
        <p className="admin-field-hint">
          Every {noun} is already on this version.
        </p>
      )}
      <Link
        className="admin-link-subtle rw-add-entry-new"
        to={`/admin?c=${encodeURIComponent(collection)}&mode=new`}
      >
        New {noun} record →
      </Link>
    </div>
  );
}

/**
 * One job/education on this version: header facts, per-version overrides, and
 * the bullet board (included bullets in this version's order, then the rest).
 */
function EntryCard({
  kind,
  entry,
  index,
  count,
  recordValue,
  recordUri,
  recordDirty,
  otherResumes,
  resumeSlug,
  editingKey,
  setEditingKey,
  patchEntry,
  moveEntry,
  removeEntry,
  stageRecord,
}) {
  const { listKey, refKey, collection, overrides } = KINDS[kind];
  const highlights = Array.isArray(recordValue?.highlights) ? recordValue.highlights : [];
  const explicit = Array.isArray(entry?.highlightIds);
  const refs = refsFor(entry, recordValue);
  const refByBase = new Map(refs.map((r) => [parseHighlightRef(r).id, r]));
  const excluded = highlights.filter((h) => !refByBase.has(h.id));
  const rkey = rkeyFromAtUri(recordUri);

  // How the *other* versions use this record's bullets — context for editing
  // shared (canonical) copy.
  const usage = useMemo(
    () =>
      collectHighlightUsage({
        resumes: otherResumes,
        recordUri,
        listKey,
        refKey,
        highlights,
      }),
    [otherResumes, recordUri, listKey, refKey, highlights],
  );

  const setRefs = (next) => patchEntry(listKey, index, { highlightIds: next });

  const toggleBullet = (baseId, on) => {
    if (on) {
      setRefs([...refs, baseId]);
    } else {
      const key = `${listKey}:${recordUri}:${baseId}`;
      if (editingKey === key) setEditingKey(null);
      setRefs(refs.filter((r) => parseHighlightRef(r).id !== baseId));
    }
  };

  const moveBullet = (pos, dir) => setRefs(moveItem(refs, pos, pos + dir));

  const setVariant = (baseId, variantId) =>
    setRefs(refs.map((r) => (parseHighlightRef(r).id === baseId ? makeHighlightRef(baseId, variantId || null) : r)));

  const setBulletText = (baseId, variantId, text) => {
    const nextHighlights = highlights.map((h) => {
      if (h.id !== baseId) return h;
      if (variantId) {
        return {
          ...h,
          variants: (h.variants || []).map((v) => (v.id === variantId ? { ...v, text } : v)),
        };
      }
      return { ...h, text };
    });
    stageRecord(recordUri, { ...recordValue, highlights: nextHighlights });
  };

  // Fork the phrasing this version currently shows into a new variant on the
  // canonical record, select it here, and open it for rewording.
  const forkBullet = (baseId) => {
    const h = highlights.find((x) => x.id === baseId);
    if (!h) return;
    const currentRef = refByBase.get(baseId) || baseId;
    const currentText = resolveHighlightRef(recordValue, currentRef)?.text ?? h.text ?? '';
    const vid = nextVariantId(h.variants);
    const nextHighlights = highlights.map((x) =>
      x.id === baseId
        ? { ...x, variants: [...(x.variants || []), { id: vid, text: currentText, label: resumeSlug }] }
        : x,
    );
    stageRecord(recordUri, { ...recordValue, highlights: nextHighlights });
    setRefs(refs.map((r) => (parseHighlightRef(r).id === baseId ? makeHighlightRef(baseId, vid) : r)));
    setEditingKey(`${listKey}:${recordUri}:${baseId}`);
  };

  const addBullet = () => {
    const hid = nextHighlightId(highlights);
    stageRecord(recordUri, {
      ...recordValue,
      highlights: [...highlights, { id: hid, text: '', visibility: 'public' }],
    });
    setRefs([...refs, hid]);
    setEditingKey(`${listKey}:${recordUri}:${hid}`);
  };

  if (recordUri && !recordValue) {
    return (
      <div className="rw-entry rf-card">
        <div className="rf-card-head">
          <p className="admin-error-inline rw-entry-missing">
            Referenced record not found: <code>{recordUri}</code>
          </p>
          <div className="rf-controls">
            <button
              type="button"
              className="rf-icon-btn rf-icon-btn-danger"
              onClick={() => removeEntry(listKey, index)}
              aria-label="Remove entry"
              title="Remove entry"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const overrideOpen = Boolean(entry?.titleOverride || entry?.summaryOverride);

  return (
    <div className="rw-entry rf-card">
      <div className="rw-entry-head">
        <div className="rw-entry-title">
          <strong>{recordLabel(kind, recordValue) || rkey}</strong>
          <span className="rw-entry-dates">{formatDateRange(recordValue)}</span>
          {recordDirty && (
            <span className="rs-chip rs-chip-warn small-caps" title="This shared record has staged copy edits — Save writes them.">
              edited
            </span>
          )}
        </div>
        <div className="rf-controls">
          <Link
            className="rf-icon-btn"
            to={`/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(rkey || '')}`}
            aria-label="Open the full record"
            title="Open the full record (facts, dates, all bullets)"
          >
            <PenLine size={15} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="rf-icon-btn"
            onClick={() => moveEntry(listKey, index, index - 1)}
            disabled={index === 0}
            aria-label="Move up"
            title="Move up"
          >
            <ChevronUp size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rf-icon-btn"
            onClick={() => moveEntry(listKey, index, index + 1)}
            disabled={index === count - 1}
            aria-label="Move down"
            title="Move down"
          >
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rf-icon-btn rf-icon-btn-danger"
            onClick={() => removeEntry(listKey, index)}
            aria-label="Remove from this version"
            title="Remove from this version (the record itself stays)"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {overrides && (
        <details className="rw-overrides" open={overrideOpen}>
          <summary className="rf-inline-label">Title & summary for this version</summary>
          <div className="rf-overrides">
            <label className="rf-inline-field rf-inline-field-block">
              <span className="rf-inline-label">Title override</span>
              <input
                className="admin-input"
                type="text"
                value={entry?.titleOverride ?? ''}
                placeholder={recordValue?.title || 'Falls back to the job title'}
                onChange={(e) => patchEntry(listKey, index, { titleOverride: e.target.value || undefined })}
              />
            </label>
            <label className="rf-inline-field rf-inline-field-block">
              <span className="rf-inline-label">Summary override</span>
              <textarea
                className="admin-input admin-textarea"
                rows={2}
                value={entry?.summaryOverride ?? ''}
                placeholder={recordValue?.summary || 'Falls back to the job summary'}
                onChange={(e) => patchEntry(listKey, index, { summaryOverride: e.target.value || undefined })}
              />
            </label>
          </div>
        </details>
      )}

      <div className="rw-bullets">
        <div className="rw-bullets-head">
          <span className="rf-inline-label">
            {refs.length} of {highlights.length} bullet{highlights.length === 1 ? '' : 's'} shown
            {!explicit && highlights.length > 0 && ' — default (all, job order)'}
          </span>
          {explicit && (
            <button
              type="button"
              className="admin-link-subtle rw-reset"
              onClick={() => {
                setEditingKey(null);
                patchEntry(listKey, index, { highlightIds: undefined });
              }}
              title="Back to the default: every non-private bullet, in the job's order, canonical phrasing"
            >
              <RotateCcw size={12} aria-hidden="true" /> reset to default
            </button>
          )}
        </div>

        {highlights.length === 0 && (
          <p className="admin-field-hint">This record has no bullets yet.</p>
        )}

        <ul className="rw-bullet-list">
          {refs.map((ref, pos) => {
            const { id: baseId } = parseHighlightRef(ref);
            const h = highlights.find((x) => x.id === baseId);
            if (!h) {
              return (
                <li key={ref} className="rw-bullet is-missing">
                  <span className="admin-error-inline">
                    Unknown bullet <code>{ref}</code>
                  </span>
                  <button
                    type="button"
                    className="admin-link-subtle"
                    onClick={() => setRefs(refs.filter((r) => r !== ref))}
                  >
                    remove
                  </button>
                </li>
              );
            }
            return (
              <BulletRow
                key={ref}
                included
                refString={ref}
                highlight={h}
                recordValue={recordValue}
                pos={pos}
                lastPos={refs.length - 1}
                editing={editingKey === `${listKey}:${recordUri}:${baseId}`}
                usageRows={usage.get(baseId) || []}
                onToggle={(on) => toggleBullet(baseId, on)}
                onMove={(dir) => moveBullet(pos, dir)}
                onSetVariant={(vid) => setVariant(baseId, vid)}
                onFork={() => forkBullet(baseId)}
                onStartEdit={() => setEditingKey(`${listKey}:${recordUri}:${baseId}`)}
                onStopEdit={() => setEditingKey(null)}
                onEditText={(text) => {
                  const { variantId } = parseHighlightRef(refByBase.get(baseId) || baseId);
                  setBulletText(baseId, variantId, text);
                }}
              />
            );
          })}
        </ul>

        {excluded.length > 0 && (
          <>
            <div className="rw-excluded-divider small-caps">not on this version</div>
            <ul className="rw-bullet-list rw-bullet-list-excluded">
              {excluded.map((h) => (
                <BulletRow
                  key={h.id}
                  included={false}
                  refString={h.id}
                  highlight={h}
                  recordValue={recordValue}
                  usageRows={usage.get(h.id) || []}
                  onToggle={(on) => toggleBullet(h.id, on)}
                />
              ))}
            </ul>
          </>
        )}

        <button type="button" className="rf-add rw-add-bullet" onClick={addBullet}>
          <Plus size={15} aria-hidden="true" /> Add bullet
          <span className="rw-add-bullet-note">(added to the shared {KINDS[kind].noun} record)</span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One bullet                                                           */
/* ------------------------------------------------------------------ */

function BulletRow({
  included,
  refString,
  highlight: h,
  recordValue,
  pos = 0,
  lastPos = 0,
  editing = false,
  usageRows,
  onToggle,
  onMove,
  onSetVariant,
  onFork,
  onStartEdit,
  onStopEdit,
  onEditText,
}) {
  const { variantId } = parseHighlightRef(refString);
  const variants = Array.isArray(h.variants) ? h.variants : [];
  const resolved = resolveHighlightRef(recordValue, refString);
  const shownText = resolved?.text ?? h.text ?? '';
  const activeVariant = variantId ? variants.find((v) => v.id === variantId) : null;

  // Other versions showing this bullet — and specifically its canonical text —
  // to flag when a re-word would ripple beyond this version.
  const othersOnBullet = [];
  const seen = new Set();
  for (const u of usageRows || []) {
    if (seen.has(u.rkey)) continue;
    seen.add(u.rkey);
    othersOnBullet.push(u);
  }
  const othersOnCanonical = othersOnBullet.filter((u) =>
    (usageRows || []).some((r) => r.rkey === u.rkey && !r.variantId),
  );

  return (
    <li className={`rw-bullet${included ? '' : ' is-excluded'}${editing ? ' is-editing' : ''}`}>
      <label className="admin-checkbox rw-bullet-check" title={included ? 'Shown on this version' : 'Include on this version'}>
        <input type="checkbox" checked={included} onChange={(e) => onToggle(e.target.checked)} />
      </label>

      <div className="rw-bullet-body">
        {editing ? (
          <div className="rw-bullet-editor">
            <textarea
              className="admin-input admin-textarea"
              rows={3}
              autoFocus
              value={shownText}
              placeholder="Shipped X, driving Y% growth…"
              onChange={(e) => onEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                  e.preventDefault();
                  onStopEdit();
                }
              }}
            />
            <div className="rw-bullet-editor-foot">
              {variantId ? (
                <span className="admin-field-hint">
                  Editing the <strong>{activeVariant?.label || variantId}</strong> phrasing — only
                  versions that pick it change.
                </span>
              ) : othersOnCanonical.length > 0 ? (
                <span className="admin-field-hint rw-shared-warning">
                  Canonical text — also shown on{' '}
                  {othersOnCanonical.map((u) => u.label).join(', ')}. Fork to re-word just this
                  version.
                </span>
              ) : (
                <span className="admin-field-hint">
                  Canonical text — no other version shows it.
                </span>
              )}
              <div className="rw-bullet-editor-actions">
                {!variantId && (
                  <button type="button" className="admin-link-subtle" onClick={onFork}>
                    <GitBranch size={12} aria-hidden="true" /> fork instead
                  </button>
                )}
                <button type="button" className="admin-gate-button admin-gate-button-tight" onClick={onStopEdit}>
                  Done
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="rw-bullet-text"
            onClick={() => (included && onStartEdit ? onStartEdit() : onToggle(true))}
            title={included ? 'Click to edit this bullet’s copy' : 'Include on this version'}
          >
            {shownText || <em>(empty bullet)</em>}
          </button>
        )}

        <div className="rw-bullet-meta">
          <code className="rf-id">{refString}</code>
          {h.featured && <span className="rf-badge rf-badge-accent">featured</span>}
          {h.metric && <span className="rf-badge">metric</span>}
          {(h.visibility || 'public') !== 'public' && <span className="rf-badge">{h.visibility}</span>}
          {included && variants.length > 0 && (
            <label className="rf-inline-field rw-phrasing">
              <span className="rf-inline-label">phrasing</span>
              <select
                className="admin-input rf-select-sm"
                value={variantId || ''}
                onChange={(e) => onSetVariant(e.target.value || null)}
              >
                <option value="">canonical</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label || v.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!included && variants.length > 0 && (
            <span className="rf-badge">{variants.length} fork{variants.length === 1 ? '' : 's'}</span>
          )}
          {included && !editing && (
            <>
              <button type="button" className="admin-link-subtle rw-bullet-action" onClick={onStartEdit}>
                <PenLine size={12} aria-hidden="true" /> reword
              </button>
              <button
                type="button"
                className="admin-link-subtle rw-bullet-action"
                onClick={onFork}
                title="Copy this phrasing into a new variant only this version uses"
              >
                <GitBranch size={12} aria-hidden="true" /> fork
              </button>
            </>
          )}
          {othersOnBullet.length > 0 && (
            <span className="rf-usage" title={`Also shown on: ${othersOnBullet.map((u) => u.label).join(', ')}`}>
              also on {othersOnBullet.map((u) => u.label).join(', ')}
            </span>
          )}
        </div>
      </div>

      {included && onMove && (
        <div className="rf-controls rw-bullet-order">
          <button
            type="button"
            className="rf-icon-btn"
            onClick={() => onMove(-1)}
            disabled={pos === 0}
            aria-label="Move bullet up"
            title="Move up"
          >
            <ChevronUp size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rf-icon-btn"
            onClick={() => onMove(1)}
            disabled={pos === lastPos}
            aria-label="Move bullet down"
            title="Move down"
          >
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
  );
}
