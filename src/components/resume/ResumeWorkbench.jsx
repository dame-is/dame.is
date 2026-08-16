import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, GitBranch, PenLine, Plus, RotateCcw, X } from 'lucide-react';
import { AdminEditorSkeleton, AdminRecordListSkeleton } from '../Skeleton.jsx';
import { SkillGroupsField, ContactField, TagsInput } from '../resumeFields.jsx';
import { COLLECTIONS } from '../../config.js';
import { useAdminShell } from '../../admin/useAdminShell.jsx';
import { rkeyFromAtUri } from '../../lib/atproto.js';
import { setActiveResume } from '../../lib/resumeAdmin.js';
import {
  formatDateRange,
  parseHighlightRef,
  makeHighlightRef,
  nextHighlightId,
  nextVariantId,
  resolveHighlightRef,
  collectHighlightUsage,
} from '../../lib/resumeHelpers.js';
import { workSlug } from '../../lib/publications.js';
import { useResumeBundle } from './useResumeBundle.js';
import './resumeStudio.css';

/** The default set of link ids for an entry: every non-private link, in order. */
function defaultLinkIds(job) {
  const links = Array.isArray(job?.links) ? job.links : [];
  return links.filter((l) => (l.visibility || 'public') !== 'private').map((l) => l.id);
}

/** Human label for a link — the resolved post title, its label, or its URL. */
function linkLabel(link, docByUri) {
  if (!link) return '';
  if (link.work) {
    const doc = docByUri?.get(link.work);
    return link.label || doc?.value?.title || workSlug(doc?.value) || link.work;
  }
  return link.label || link.url || '(untitled link)';
}

/**
 * The tailoring workbench — a resume-centric editor for one version.
 *
 * Everything you'd do to adapt a resume for an audience happens on this one
 * page: reframe the headline/summary, pick and order jobs, and work the
 * bullets — include/exclude, reorder, re-word, and fork a bullet into an
 * alternate phrasing that only this version uses.
 *
 * Bullet copy lives on the canonical job/education records, so those edits are
 * *staged* here (the touched records are counted on the status strip) and
 * written back together with the resume in one save. Forking creates a variant
 * on the job (`highlights[].variants`) and points this resume's selection at it
 * (`highlightIds: ["h3#v2"]`); the canonical text and every other version stay
 * untouched.
 *
 * As a studio it is a BODY, not a page: StudioPane draws the title and the NSID,
 * the rail is the way back, and the workbench's status strip owns Save and
 * Delete — so this file renders no PageShell and no save bar. It used to publish
 * its controls into the site-wide bottom edit bar through `setPageEditor`; that
 * bar belongs to the public quick-edit sheet, and this was one of the last two
 * places teaching it to serve two masters. `registerActions` + `reportDirty`
 * replace it exactly.
 */

const KINDS = {
  job: {
    listKey: 'entries',
    refKey: 'job',
    collection: COLLECTIONS.resumeJob,
    overrides: true,
    heading: 'Experience',
    noun: 'job',
    // Carried as data rather than derived from the noun's first letter: the
    // template that needs it ("— add a job to this version —") read "a
    // education entry" for the whole life of this surface, and a rule of thumb
    // over one vowel is what produced that. Two nouns, two articles, written
    // down.
    article: 'a',
    note: 'Which jobs this version shows, in order — and per job, exactly which bullets, in which phrasing.',
  },
  education: {
    listKey: 'education',
    refKey: 'education',
    collection: COLLECTIONS.resumeEducation,
    overrides: false,
    heading: 'Education',
    noun: 'education entry',
    article: 'an',
    note: 'Which education records this version shows, in order.',
  },
};

/** The section notes the loading state has to stand in for, said once. */
const NOTES = {
  framing: "This version's own copy — name, headline, and summary. Job facts stay on the job records.",
  skills: 'Skill groups live on the version itself — emphasis is the most audience-specific part.',
  contact: 'Leave blank to fall back to the site profile.',
};

/**
 * Label a canonical record for card heads and pickers.
 *
 * The separator is bound to the segment AFTER it with a no-break space, so a
 * card title that has to wrap breaks as "Senior designer" / "· Field & Rule"
 * rather than stranding the middle dot at the end of the line — which is what
 * a 320px screen did to every two-part title here.
 */
function recordLabel(kind, value) {
  const parts =
    kind === 'job'
      ? [value?.title, value?.organization]
      : [value?.institution, value?.studyType || value?.area];
  return parts.filter(Boolean).join(' ·\u00a0');
}

/** The one destructive question this surface asks, named after its subject. */
function deleteQuestion(name) {
  return `Delete the resume version “${name}”? The jobs and their bullets stay — only the version is removed.`;
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

/** Merge a patch, dropping any key set to `undefined` so records stay clean. */
function applyPatch(obj, patch) {
  const next = { ...obj, ...patch };
  for (const k of Object.keys(patch)) {
    if (next[k] === undefined) delete next[k];
  }
  return next;
}

export default function ResumeWorkbench({ agent, did, rkey, bundle }) {
  const { go, registerActions, registerBar, reportDirty, invalidate, stacked } = useAdminShell();
  const {
    resumes,
    jobs,
    education,
    documents,
    loading: bundleLoading,
    error: loadError,
    applyWrites,
    reload,
  } = useResumeBundle(agent, did, bundle);

  // The bundle arrives inside a prop object StudioPane rebuilds every render, so
  // its callbacks have no stable identity. `save` must not be rebuilt with them
  // — it is registered with the shell, and a new identity there republishes the
  // context to every consumer — so it reaches them through latest-value refs.
  const applyWritesRef = useRef(null);
  const reloadRef = useRef(null);
  applyWritesRef.current = applyWrites;
  reloadRef.current = reload;

  // Portfolio posts by URI, so a job's `work` links can be labeled with the
  // post's live title in the selection UI.
  const docByUri = useMemo(() => {
    const m = new Map();
    for (const r of documents || []) m.set(r.uri, r);
    return m;
  }, [documents]);

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

  const isLoading = bundleLoading || (!draft && !notFound);
  const dirty = resumeDirty || dirtyUris.size > 0;
  // Read from the init effect below, which must not list `dirty` as a
  // dependency: re-running that effect on every keystroke is exactly the
  // clobber it exists to prevent. Assigning during render is the pattern
  // useAdminShell uses for its own latest-value refs.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // What `featured` was when this draft was seeded. The checkbox is staged like
  // every other field, so save() can only tell whether the ACTIVE version
  // changed — the thing that has to clear every sibling — by comparing to this.
  const featuredAtLoad = useRef(false);

  // Initialize drafts once per rkey, from the loaded bundle. The "not yet"
  // sentinel is `undefined`, NOT null: `?view=resume-tailor` with no `&r=` is a
  // reachable hand-typed URL (the rail and the Front Desk hide the surface
  // because it is `requiresRkey`, they do not make it unreachable), and against
  // a null sentinel that rkey would match on the first run and leave the pane on
  // its skeleton forever.
  const initializedFor = useRef(undefined);
  useEffect(() => {
    if (bundleLoading || initializedFor.current === rkey) return;

    // The shell's `go()` asks before a rail or list click discards staged work,
    // but the BROWSER BACK BUTTON does not go through `go()` — so this effect
    // can still fire on top of a dirty draft, and reseeding would silently drop
    // staged copy edits on shared job records with no undo anywhere in the
    // admin. Bail, say why, and put the URL back on the version the draft
    // actually belongs to, so Save can never write it under the wrong rkey.
    const heldFor = initializedFor.current;
    if (heldFor && dirtyRef.current) {
      setError(
        `Unsaved changes on “${heldFor}” — save them here first, or leave from the rail to discard them.`,
      );
      go({ view: 'resume-tailor', r: heldFor }, { replace: true, force: true });
      return;
    }

    const rec = (resumes || []).find((r) => rkeyFromAtUri(r.uri) === rkey);
    if (!rec) {
      // Deliberately NOT latched. The bundle is hoisted and shared, so a record
      // written elsewhere (a duplicate, a rename) can arrive in a later render;
      // latching here would freeze this pane on "no such version" forever.
      setNotFound(true);
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
    setError(null);
    featuredAtLoad.current = Boolean(rec.value?.featured);
    initializedFor.current = rkey;
  }, [bundleLoading, resumes, jobs, education, rkey, go]);

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

  // What to call this version in a question about destroying it. The rkey is
  // the fallback rather than the answer: "3l22xte65zzo" is not a thing anyone
  // recognises under pressure.
  const versionName = draft?.title || rkey;

  const save = useCallback(async () => {
    if (saving || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const written = [];
      // Canonical records first, so the resume never points at bullets that
      // don't exist yet (freshly forked variants, added bullets).
      for (const uri of dirtyUris) {
        const parts = String(uri).replace(/^at:\/\//, '').split('/');
        const [, collection, r] = parts;
        const value = recordDrafts.get(uri);
        if (!collection || !r || !value) continue;
        const staged = { ...value, $type: value.$type || collection, updatedAt: now };
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection,
          rkey: r,
          record: staged,
        });
        written.push({ collection, uri, value: staged });
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
      const uri = `at://${did}/${COLLECTIONS.resume}/${rkey}`;
      written.push({ collection: COLLECTIONS.resume, uri, value: record });

      // The "Active" checkbox is staged like every other field — nothing is
      // written on click — but the flag is an exclusive one: bare /available
      // renders whichever version has it, so two of them is a coin toss over
      // what a stranger reads. Only when it actually changed does the
      // sibling-clearing pass run, and it runs AFTER our own writes, against a
      // list where this record already carries what we just saved, so it cannot
      // put the pre-save value back.
      const activeChanged = Boolean(record.featured) !== featuredAtLoad.current;
      if (activeChanged) {
        const siblings = (resumes || []).map((r) => (r.uri === uri ? { uri, value: record } : r));
        await setActiveResume(agent, did, siblings, record.featured ? rkey : null);
      }
      // Keep the hoisted bundle honest without a four-collection sweep: it is
      // shared with the resume studio, which stays mounted behind this pane and
      // would otherwise keep describing the pre-save records.
      applyWritesRef.current?.(written);
      // The one case write-through cannot describe from here: clearing the flag
      // touched versions this pane never held. Refetch for those, on top of the
      // write-through above so the record on screen is right immediately either
      // way.
      if (activeChanged) reloadRef.current?.();
      featuredAtLoad.current = Boolean(record.featured);
      setDirtyUris(new Set());
      setResumeDirty(false);
      setSavedFlash(true);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [agent, did, rkey, draft, recordDrafts, dirtyUris, saving, resumes]);

  // `asked` is how the action bar's ⋯ menu says it has already put the question
  // — with the version's NAME in it, which a generic bar confirm cannot do. The
  // status strip's own Delete button has no confirm of its own, so the default
  // path still asks here.
  const remove = useCallback(async ({ asked = false } = {}) => {
    if (deleting) return;
    if (!asked && !window.confirm(deleteQuestion(versionName))) return;
    setDeleting(true);
    setError(null);
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: COLLECTIONS.resume,
        rkey,
      });
      applyWritesRef.current?.([
        { collection: COLLECTIONS.resume, uri: `at://${did}/${COLLECTIONS.resume}/${rkey}`, value: null },
      ]);
      invalidate([COLLECTIONS.resume]);
      // `force`: the record is gone, so there is nothing left to warn about —
      // and the draft the shell would ask to protect describes it.
      go({ view: 'resume', r: null, c: null, mode: null, for: null }, { force: true });
    } catch (err) {
      setError(err?.message || String(err));
      setDeleting(false);
    }
  }, [agent, did, rkey, deleting, go, invalidate, versionName]);

  /* --- what the shell needs to know ------------------------------------- */

  // `save` and `remove` close over the whole draft, so they change identity on
  // every keystroke. Registering them directly would republish the shell context
  // — and re-render every consumer of it — per character typed, so what gets
  // registered is a pair of stable wrappers around latest-value refs.
  const saveRef = useRef(null);
  const removeRef = useRef(null);
  saveRef.current = save;
  removeRef.current = remove;
  const stableSave = useCallback(() => saveRef.current?.(), []);
  const stableRemove = useCallback((opts) => removeRef.current?.(opts), []);

  // `rkey` is in the dependency list although the body never reads it, and that
  // is load-bearing rather than sloppy. The shell drops `actions` DURING RENDER
  // whenever the subject changes, on the promise that the pane's own effect
  // re-registers straight after — but switching from one version to another
  // changes nothing else here (same wrappers, same flags, draft already
  // truthy), so without `rkey` the effect would not re-run and Save would
  // simply vanish from the strip.
  //
  // NULL when there is no record. `loading: true` only greys the buttons out,
  // which left `?view=resume-tailor` with no `&r=` — a hand-typable URL — under
  // a live Save/Delete bar for a version that does not exist, above a sentence
  // saying so. `registerActions(null)` is what makes the strip (and the bar's ⋯
  // Delete) disappear entirely, so the empty state stands on its own.
  useEffect(() => {
    registerActions(
      notFound
        ? null
        : {
            save: stableSave,
            remove: stableRemove,
            saving,
            deleting,
            loading: isLoading,
            canDelete: true,
            isNew: false,
          },
    );
  }, [registerActions, stableSave, stableRemove, saving, deleting, isLoading, notFound, rkey]);

  // Below 60rem Delete lives in the bar's ⋯ menu, and the shell will append its
  // own generic `Delete record…` whenever `canDelete` — which would ask "Delete
  // this record?" and then hand off to a `remove` that asks a SECOND time. One
  // item with the reserved id `delete` replaces it with the question that names
  // the version, and tells `remove` it has already been asked.
  useEffect(() => {
    registerBar(
      notFound
        ? null
        : {
            overflow: [
              {
                id: 'delete',
                label: deleting ? 'Deleting…' : 'Delete version…',
                icon: 'Archive',
                tone: 'danger',
                disabled: saving || deleting,
                confirm: deleteQuestion(versionName),
                onPress: () => removeRef.current?.({ asked: true }),
              },
            ],
          },
    );
    return () => registerBar(null);
  }, [registerBar, notFound, deleting, saving, versionName]);

  // The strip names no fields on purpose. A tailoring session touches dozens of
  // bullet refs, orders and overrides that have no single field label between
  // them; what actually needs saying is how many SHARED job records this save
  // will also write, which is the one thing the count carries.
  const dirtyState = useMemo(
    () => (dirty ? { dirty: true, fields: [], records: dirtyUris.size, note: null } : null),
    [dirty, dirtyUris],
  );
  // `rkey` again, for the same reason and one sharper case: the init effect
  // above can REFUSE a version switch that would discard staged work and put the
  // URL back. The shell reset `dirty` to CLEAN on the way through, so unless
  // this re-asserts, the strip would claim nothing is unsaved and `go()` would
  // stop guarding the very edits that just blocked the navigation.
  useEffect(() => {
    reportDirty(dirtyState);
  }, [reportDirty, dirtyState, rkey]);

  // Teardown, separately from the two publishing effects above: leaving this
  // surface must not strand a Save button or an "unsaved changes" sentence on
  // whatever opens next.
  useEffect(
    () => () => {
      registerActions(null);
      reportDirty(null);
    },
    [registerActions, reportDirty],
  );

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

  if (notFound) {
    return (
      <p className="placeholder-card">
        {/* Two ways to land here: a version that no longer exists, or the bare
            surface with no `&r=` at all — which says nothing about a missing
            record and should not pretend it does.

            The key is deliberately not the last thing before the full stop. An
            inline <code> carries its own trailing padding, so a sentence that
            ended on the chip printed as "No resume version doesnotexist999 ."
            — five pixels of air between the glyph and the period that belongs
            to it. */}
        {rkey ? (
          <>
            No resume version has the key <code>{rkey}</code> — it may have been renamed or
            deleted.{' '}
          </>
        ) : (
          'Tailoring works on one version at a time. '
        )}
        <Link to="/admin?view=resume">Back to the studio.</Link>
      </p>
    );
  }

  return (
    <div className="rw-studio">
      {/* The pane head names the SURFACE ("Tailor version"); WHICH version is
          being tailored is this row's job — with the rkey, because that is the
          record's address and the /available slug is derived from it. The
          "unsaved" chip that used to live here is gone: the status strip says
          it now, shared-record count and all, and two of them disagreeing by a
          render is worse than one saying it once. */}
      <div className="admin-toolbar">
        <strong className="rw-version-name">{draft?.title || rkey}</strong>
        {/* A version with no title falls back to its rkey for the name, and
            printing the same string twice side by side reads as a rendering
            bug rather than as two facts. */}
        {draft?.title && <code className="admin-record-rkey">{rkey}</code>}
        {savedFlash && <span className="rs-chip rs-chip-accent small-caps">saved</span>}
        <span className="rw-toolbar-links">
          <Link
            className="admin-link-subtle"
            to={`/admin?c=${encodeURIComponent(COLLECTIONS.resume)}&r=${encodeURIComponent(rkey)}`}
          >
            raw record
          </Link>
          {draft && (draft.visibility || 'private') !== 'private' && (
            <Link className="admin-link-subtle" to={`/available/${encodeURIComponent(draft.slug || rkey)}`}>
              view ↗
            </Link>
          )}
        </span>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {loadError && <p className="admin-error">{loadError}</p>}

      {isLoading ? (
        <TailorSkeleton />
      ) : (
        <div className="rw reveal">
          <FramingSection draft={draft} patchDraft={patchDraft} />

          {['job', 'education'].map((kind) => (
            <EntriesSection
              key={kind}
              kind={kind}
              stacked={stacked}
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
              docByUri={docByUri}
            />
          ))}

          <section className="rw-section">
            <h2 className="admin-collection-group-heading small-caps">Skills</h2>
            <p className="admin-collection-group-note">{NOTES.skills}</p>
            <SkillGroupsField
              value={draft?.skills}
              onChange={(v) => patchDraft({ skills: v })}
            />
          </section>

          <section className="rw-section">
            <h2 className="admin-collection-group-heading small-caps">Contact</h2>
            <p className="admin-collection-group-note">{NOTES.contact}</p>
            <ContactField
              value={draft?.contact}
              onChange={(v) => patchDraft({ contact: v })}
            />
          </section>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading                                                              */
/* ------------------------------------------------------------------ */

/**
 * The shape the page is about to be, not a generic form.
 *
 * The old placeholder was five field blocks — the framing section and nothing
 * else — under a page that resolves to five titled sections and roughly twice
 * that height, so the pane grew ~880px the moment the bundle landed and every
 * heading below the fold arrived unannounced. The headings and their notes here
 * are the REAL ones (shared with the render below through `NOTES` / `KINDS`),
 * so the rhythm that appears while loading is the rhythm that stays.
 */
function TailorSkeleton() {
  return (
    <div className="rw">
      <section className="rw-section">
        <h2 className="admin-collection-group-heading small-caps">Framing</h2>
        <p className="admin-collection-group-note">{NOTES.framing}</p>
        <AdminEditorSkeleton fields={5} />
      </section>
      {['job', 'education'].map((kind) => (
        <section className="rw-section" key={kind}>
          <h2 className="admin-collection-group-heading small-caps">{KINDS[kind].heading}</h2>
          <p className="admin-collection-group-note">{KINDS[kind].note}</p>
          <AdminRecordListSkeleton
            rows={kind === 'job' ? 3 : 1}
            label={`Loading ${KINDS[kind].heading.toLowerCase()}`}
          />
        </section>
      ))}
      {[
        ['Skills', NOTES.skills],
        ['Contact', NOTES.contact],
      ].map(([heading, note]) => (
        <section className="rw-section" key={heading}>
          <h2 className="admin-collection-group-heading small-caps">{heading}</h2>
          <p className="admin-collection-group-note">{note}</p>
          <AdminRecordListSkeleton rows={1} label={`Loading ${heading.toLowerCase()}`} />
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Framing (the version's own copy)                                     */
/* ------------------------------------------------------------------ */

function FramingSection({ draft, patchDraft }) {
  return (
    <section className="rw-section">
      <h2 className="admin-collection-group-heading small-caps">Framing</h2>
      <p className="admin-collection-group-note">{NOTES.framing}</p>
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
          <span className="rf-inline-label">Slug (URL at /available/…)</span>
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
        {/* Still a staged edit — nothing is written on click. What changed is
            what Save then does with it: ticking this now clears the flag on
            every other version, so "keep to one version" stopped being an
            instruction to the reader — which is what the second sentence says,
            in place of an "it" and an "elsewhere" the reader had to resolve. */}
        <label className="admin-checkbox rf-checkbox rw-active-check">
          <input
            type="checkbox"
            checked={Boolean(draft?.featured)}
            onChange={(e) => patchDraft({ featured: e.target.checked })}
          />
          <span>
            Active — the version that bare /available shows. Saving this clears the flag on every
            other version.
          </span>
        </label>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Experience / education entries                                       */
/* ------------------------------------------------------------------ */

/** One empty array for every entry-less section, so "no entries" is one identity. */
const NO_ENTRIES = [];

/**
 * Put the keyboard back where the owner left it after a reorder or a removal.
 *
 * React reuses the card's DOM node now that the key is its ref URI, but a node
 * that MOVES in the document is removed and re-inserted, and removal blurs — so
 * the button that was just pressed still loses focus. This re-finds it by the
 * record it belongs to (`data-entry-uri`) and the job it does (`data-ctl`),
 * both of which survive the move.
 *
 * Falling back matters as much as the happy path: "move down" on the card that
 * has just reached the bottom is now disabled and cannot hold focus, so focus
 * goes to its opposite number rather than to <body>.
 */
function restoreEntryFocus(root, intent) {
  if (!root || !intent) return;
  const cards = Array.from(root.querySelectorAll('[data-entry-uri]'));
  if (intent.kind === 'move') {
    const card = cards.find((el) => el.dataset.entryUri === intent.uri);
    const pick = (name) => card?.querySelector(`[data-ctl="${name}"]:not(:disabled)`);
    const target = pick(intent.control) || pick(intent.control === 'up' ? 'down' : 'up') || pick('remove');
    target?.focus();
    return;
  }
  // A removal: the card that took the removed one's place, or the last card, or
  // — when the list has just emptied — whatever adds the next one.
  const next = cards[Math.min(intent.index, cards.length - 1)];
  const target = next?.querySelector('[data-ctl="remove"]') || root.querySelector('[data-add-focus]');
  target?.focus();
}

function EntriesSection({
  kind,
  stacked,
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
  docByUri,
}) {
  const { listKey, refKey, collection, heading, noun, note } = KINDS[kind];
  // Memoized for its IDENTITY, which is what the focus effect below watches:
  // `draft` is a new object per keystroke anywhere in the form, but the entry
  // array inside it only changes when the order or the membership does, and a
  // shared empty constant keeps the no-entries case from looking like a change.
  const entries = useMemo(
    () => (Array.isArray(draft?.[listKey]) ? draft[listKey] : NO_ENTRIES),
    [draft, listKey],
  );

  const referenced = new Set(entries.map((e) => e?.[refKey]).filter(Boolean));
  const available = (records || []).filter((r) => !referenced.has(r.uri));

  // Where the keyboard should land once the next list has painted. A ref rather
  // than state: this is a note about a render that is already scheduled, and
  // storing it in state would schedule a second one.
  const sectionRef = useRef(null);
  const focusIntent = useRef(null);
  useLayoutEffect(() => {
    const intent = focusIntent.current;
    if (!intent) return;
    focusIntent.current = null;
    restoreEntryFocus(sectionRef.current, intent);
  }, [entries]);

  const move = (index, to, control) => {
    focusIntent.current = { kind: 'move', uri: entries[index]?.[refKey], control };
    moveEntry(listKey, index, to);
  };
  const drop = (index) => {
    focusIntent.current = { kind: 'remove', index };
    removeEntry(listKey, index);
  };

  return (
    <section className="rw-section" ref={sectionRef}>
      <h2 className="admin-collection-group-heading small-caps">{heading}</h2>
      <p className="admin-collection-group-note">{note}</p>

      {entries.length === 0 && (
        <p className="admin-field-hint">No {noun} on this version yet — add one below.</p>
      )}

      <div className="rw-entries">
        {entries.map((entry, i) => (
          <EntryCard
            /* The ref URI ALONE, never the index. With the index in the key,
               every card below a moved one got a new key, so React unmounted
               and remounted the lot: the pressed button's DOM node was
               destroyed (focus fell to <body>, 23 tab stops from the pane) and
               every card's local state went with it — including the open
               "options" panel on cards that had not moved. A record can appear
               on a version once, so the URI is already unique. */
            key={entry?.[refKey] || `missing-${i}`}
            kind={kind}
            stacked={stacked}
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
            onMove={move}
            onRemove={drop}
            stageRecord={stageRecord}
            docByUri={docByUri}
          />
        ))}
      </div>

      <AddEntryRow
        kind={kind}
        available={available}
        collection={collection}
        onAdd={(uri) => addEntry(listKey, refKey, uri)}
      />
    </section>
  );
}

function AddEntryRow({ kind, available, collection, onAdd }) {
  const { noun, article } = KINDS[kind];
  const [pick, setPick] = useState('');
  return (
    <div className="rw-add-entry">
      {available.length > 0 ? (
        <>
          <select
            className="admin-input rf-ref-select"
            data-add-focus=""
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            {/* The article travels with the noun. Deriving it from the first
                letter is what produced "a education entry" here for months. */}
            <option value="">
              — add {article} {noun} to this version —
            </option>
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
        data-add-focus=""
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
  stacked,
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
  onMove,
  onRemove,
  stageRecord,
  docByUri,
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

  // All bullet-property edits are canonical: they mutate the highlight (or one
  // of its variants) on the shared job/education record and stage that record.
  const updateHighlights = (mapFn) =>
    stageRecord(recordUri, { ...recordValue, highlights: highlights.map(mapFn) });

  const patchHighlight = (baseId, patch) =>
    updateHighlights((h) => (h.id === baseId ? applyPatch(h, patch) : h));

  const patchVariant = (baseId, variantId, patch) =>
    updateHighlights((h) =>
      h.id === baseId
        ? { ...h, variants: (h.variants || []).map((v) => (v.id === variantId ? applyPatch(v, patch) : v)) }
        : h,
    );

  const setBulletText = (baseId, variantId, text) =>
    variantId ? patchVariant(baseId, variantId, { text }) : patchHighlight(baseId, { text });

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
      <div className="rw-entry rf-card" data-entry-uri={recordUri}>
        <div className="rf-card-head">
          <p className="admin-error-inline rw-entry-missing">
            Referenced record not found: <code>{recordUri}</code>
          </p>
          <div className="rf-controls">
            <button
              type="button"
              className="rf-icon-btn rf-icon-btn-danger"
              data-ctl="remove"
              onClick={() => onRemove(index)}
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

  const entryName = recordLabel(kind, recordValue) || rkey;

  return (
    <div className="rw-entry rf-card" data-entry-uri={recordUri}>
      <div className="rw-entry-head">
        <div className="rw-entry-title">
          <strong>{entryName}</strong>
          <span className="rw-entry-dates">{formatDateRange(recordValue)}</span>
          {recordDirty && (
            <span className="rs-chip rs-chip-warn small-caps" title="This shared record has staged copy edits — Save writes them.">
              edited
            </span>
          )}
        </div>
        {/* Every control names the entry it acts on. Four glyph buttons in a row
            all read "Move up" to a screen reader otherwise, and on a version
            with three jobs that is three identical announcements. */}
        <div className="rf-controls">
          <Link
            className="rf-icon-btn"
            data-ctl="open"
            to={`/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(rkey || '')}`}
            aria-label={`Open the full record for ${entryName}`}
            title="Open the full record (facts, dates, all bullets)"
          >
            <PenLine size={15} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="rf-icon-btn"
            data-ctl="up"
            onClick={() => onMove(index, index - 1, 'up')}
            disabled={index === 0}
            aria-label={`Move ${entryName} up`}
            title="Move up"
          >
            <ChevronUp size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rf-icon-btn"
            data-ctl="down"
            onClick={() => onMove(index, index + 1, 'down')}
            disabled={index === count - 1}
            aria-label={`Move ${entryName} down`}
            title="Move down"
          >
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rf-icon-btn rf-icon-btn-danger"
            data-ctl="remove"
            onClick={() => onRemove(index)}
            aria-label={`Remove ${entryName} from this version`}
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

      <BoardShell
        stacked={stacked}
        /* Same grammar as the work-samples board four rows down, which led with
           its label while this one led with its count — two labels doing one
           job, written two ways, inside one card. */
        label={`Bullets — ${refs.length} of ${highlights.length} shown${
          !explicit && highlights.length > 0 ? ' (default: all, in job order)' : ''
        }`}
        reset={
          explicit && (
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
          )
        }
      >
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
                onPatchHighlight={(patch) => patchHighlight(baseId, patch)}
                onPatchVariant={(vid, patch) => patchVariant(baseId, vid, patch)}
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
                  onPatchHighlight={(patch) => patchHighlight(h.id, patch)}
                  onPatchVariant={(vid, patch) => patchVariant(h.id, vid, patch)}
                />
              ))}
            </ul>
          </>
        )}

        <button type="button" className="rf-add rw-add-bullet" onClick={addBullet}>
          <Plus size={15} aria-hidden="true" /> Add bullet
          <span className="rw-add-bullet-note">(added to the shared {KINDS[kind].noun} record)</span>
        </button>
      </BoardShell>

      {kind === 'job' && (
        <LinkBoard
          links={Array.isArray(recordValue?.links) ? recordValue.links : []}
          entry={entry}
          stacked={stacked}
          docByUri={docByUri}
          collection={collection}
          rkey={rkey}
          onChange={(linkIds) => patchEntry(listKey, index, { linkIds })}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The two selection boards                                             */
/* ------------------------------------------------------------------ */

/**
 * The frame both selection boards sit in: a small-caps count line, an optional
 * "reset to default" beside it, and the list itself.
 *
 * Below the stacked breakpoint the list FOLDS behind that count line. A bullet
 * board is the densest thing in the admin — per bullet, a checkbox, two order
 * buttons and three text actions — and a job with eight of them buries the next
 * job a screen and a half down a phone. The count line is the summary either
 * way, so a closed board still says what it is hiding, and the disclosure is a
 * `<details>`: it has keyboard behaviour, an accessible name and open state
 * without a line of script (see admin-mobile-design.md §6).
 *
 * `reset` moves inside the fold when stacked, because a control that discards a
 * whole selection should not be reachable without opening the thing it is about.
 */
function BoardShell({ stacked, label, reset, className = '', children }) {
  const classes = `rw-bullets${className ? ` ${className}` : ''}`;
  if (stacked) {
    return (
      <div className={classes}>
        <details className="rw-board">
          <summary className="rw-board-summary rf-inline-label">{label}</summary>
          <div className="rw-board-body">
            {reset}
            {children}
          </div>
        </details>
      </div>
    );
  }
  return (
    <div className={classes}>
      <div className="rw-bullets-head">
        <span className="rf-inline-label">{label}</span>
        {reset}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Work samples (per-version link selection)                            */
/* ------------------------------------------------------------------ */

/**
 * Choose which of a job's `links` (portfolio pieces / URLs) show under it on
 * this version, and in what order. Same include/exclude/reorder model as the
 * bullet board; the link pool itself is edited on the job record. Selection is
 * stored on the resume entry as `linkIds` (omit = all non-private).
 */
function LinkBoard({ links, entry, stacked, docByUri, collection, rkey, onChange }) {
  const explicit = Array.isArray(entry?.linkIds);
  const refs = explicit ? entry.linkIds : defaultLinkIds({ links });
  const included = new Set(refs);
  const byId = new Map(links.map((l) => [l.id, l]));
  const excluded = links.filter((l) => !included.has(l.id));
  const naturalIndex = new Map(links.map((l, i) => [l.id, i]));

  const toggle = (id, on) => {
    if (!on) {
      onChange(refs.filter((r) => r !== id));
      return;
    }
    const idx = naturalIndex.get(id) ?? Infinity;
    const next = refs.slice();
    let at = next.length;
    for (let k = 0; k < next.length; k += 1) {
      if ((naturalIndex.get(next[k]) ?? Infinity) > idx) {
        at = k;
        break;
      }
    }
    next.splice(at, 0, id);
    onChange(next);
  };
  const moveLink = (pos, dir) => onChange(moveItem(refs, pos, pos + dir));

  return (
    <BoardShell
      stacked={stacked}
      className="rw-links"
      label={`Work samples — ${refs.length} of ${links.length} shown${
        !explicit && links.length > 0 ? ' (default: all)' : ''
      }`}
      reset={
        explicit && (
          <button
            type="button"
            className="admin-link-subtle rw-reset"
            onClick={() => onChange(undefined)}
            title="Back to the default: every non-private link, in the job's order"
          >
            <RotateCcw size={12} aria-hidden="true" /> reset to default
          </button>
        )
      }
    >
      {links.length === 0 ? (
        <p className="admin-field-hint">
          No work samples on this job yet.{' '}
          <Link to={`/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(rkey || '')}`}>
            Add portfolio links on the job record →
          </Link>
        </p>
      ) : (
        <>
          <ul className="rw-bullet-list">
            {refs.map((id, pos) => {
              const link = byId.get(id);
              if (!link) {
                return (
                  <li key={id} className="rw-bullet is-missing">
                    <span className="admin-error-inline">
                      Unknown link <code>{id}</code>
                    </span>
                    <button
                      type="button"
                      className="admin-link-subtle"
                      onClick={() => onChange(refs.filter((r) => r !== id))}
                    >
                      remove
                    </button>
                  </li>
                );
              }
              return (
                <LinkRow
                  key={id}
                  included
                  link={link}
                  docByUri={docByUri}
                  pos={pos}
                  lastPos={refs.length - 1}
                  onToggle={(on) => toggle(id, on)}
                  onMove={(dir) => moveLink(pos, dir)}
                />
              );
            })}
          </ul>
          {excluded.length > 0 && (
            <>
              <div className="rw-excluded-divider small-caps">not on this version</div>
              <ul className="rw-bullet-list rw-bullet-list-excluded">
                {excluded.map((link) => (
                  <LinkRow
                    key={link.id}
                    included={false}
                    link={link}
                    docByUri={docByUri}
                    onToggle={(on) => toggle(link.id, on)}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </BoardShell>
  );
}

function LinkRow({ included, link, docByUri, pos = 0, lastPos = 0, onToggle, onMove }) {
  const label = linkLabel(link, docByUri);
  const kind = link.work ? 'post' : 'link';
  return (
    <li className={`rw-bullet${included ? '' : ' is-excluded'}`}>
      <label className="admin-checkbox rw-bullet-check">
        <input type="checkbox" checked={included} onChange={(e) => onToggle(e.target.checked)} />
      </label>
      <div className="rw-bullet-body">
        <span className="rw-link-title">{label}</span>
        <div className="rw-bullet-meta">
          <span className="rf-badge">{kind}</span>
          {(link.visibility || 'public') !== 'public' && (
            <span className="rf-badge">{link.visibility}</span>
          )}
          {link.description && <span className="rw-link-desc">{link.description}</span>}
        </div>
      </div>
      {included && onMove && (
        <div className="rf-controls rw-bullet-order">
          <button
            type="button"
            className="rf-icon-btn"
            onClick={() => onMove(-1)}
            disabled={pos === 0}
            aria-label="Move up"
            title="Move up"
          >
            <ChevronUp size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rf-icon-btn"
            onClick={() => onMove(1)}
            disabled={pos === lastPos}
            aria-label="Move down"
            title="Move down"
          >
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
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
  onPatchHighlight,
  onPatchVariant,
}) {
  const [showOptions, setShowOptions] = useState(false);
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
          {!editing && onPatchHighlight && (
            <button
              type="button"
              className={`admin-link-subtle rw-bullet-action${showOptions ? ' is-open' : ''}`}
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
              title="Featured, metric, visibility, and tags for this bullet"
            >
              {showOptions ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}{' '}
              options
            </button>
          )}
          {othersOnBullet.length > 0 && (
            <span className="rf-usage" title={`Also shown on: ${othersOnBullet.map((u) => u.label).join(', ')}`}>
              also on {othersOnBullet.map((u) => u.label).join(', ')}
            </span>
          )}
        </div>

        {showOptions && onPatchHighlight && (
          <div className="rw-bullet-options">
            <div className="rw-bullet-options-row">
              <label className="admin-checkbox rf-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(h.featured)}
                  onChange={(e) => onPatchHighlight({ featured: e.target.checked || undefined })}
                />
                <span>Featured</span>
              </label>
              <label className="admin-checkbox rf-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(h.metric)}
                  onChange={(e) => onPatchHighlight({ metric: e.target.checked || undefined })}
                />
                <span>Metric</span>
              </label>
              <label className="rf-inline-field">
                <span className="rf-inline-label">Visibility</span>
                <select
                  className="admin-input rf-select-sm"
                  value={h.visibility || 'public'}
                  onChange={(e) =>
                    onPatchHighlight({ visibility: e.target.value === 'public' ? undefined : e.target.value })
                  }
                >
                  <option value="public">public</option>
                  <option value="unlisted">unlisted</option>
                  <option value="private">private</option>
                </select>
              </label>
            </div>
            <label className="rf-inline-field rf-inline-field-block">
              <span className="rf-inline-label">Tags</span>
              <TagsInput
                value={h.tags}
                placeholder="growth, leadership"
                onChange={(tags) => onPatchHighlight({ tags: tags.length ? tags : undefined })}
              />
            </label>
            {variantId && onPatchVariant && (
              <label className="rf-inline-field rf-inline-field-block">
                <span className="rf-inline-label">Phrasing label ({variantId})</span>
                <input
                  className="admin-input"
                  type="text"
                  value={activeVariant?.label ?? ''}
                  placeholder="e.g. design-focused"
                  onChange={(e) => onPatchVariant(variantId, { label: e.target.value || undefined })}
                />
              </label>
            )}
            <p className="admin-field-hint">
              Featured, metric, visibility, and tags live on the shared bullet — changing them affects
              every version that uses it.
            </p>
          </div>
        )}
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
