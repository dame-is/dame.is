import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, PenLine, ExternalLink, MoreHorizontal, Plus } from 'lucide-react';
import { AdminRecordListSkeleton } from '../Skeleton.jsx';
import { rkeyFromUri } from '../RecordEditor.jsx';
import { COLLECTIONS } from '../../config.js';
import AdminSheet from '../../admin/AdminSheet.jsx';
import { useAdminShell } from '../../admin/useAdminShell.jsx';
import {
  formatDateRange,
  duplicateResumeValue,
  slugifyResumeTitle,
} from '../../lib/resumeHelpers.js';
import {
  renameRecordKey,
  backlinksFor,
  countBacklinks,
  setActiveResume,
} from '../../lib/resumeAdmin.js';
import { useResumeBundle } from './useResumeBundle.js';
import './resumeStudio.css';

/**
 * Resume studio — the admin home for everything resume-shaped.
 *
 * One page that shows every resume *version* (with tailor / duplicate /
 * set-active actions) above the canonical *jobs* and *education* records they
 * draw from. The per-version "Tailor" link opens the workbench
 * (`/admin?view=resume-tailor&r=<rkey>`), which is where bullets get selected,
 * reordered, forked into variants, and re-worded per version.
 *
 * As a studio it is a BODY, not a page: StudioPane draws the title, the blurb
 * and the NSID, and the rail is the way back — so there is no PageShell, no
 * "← All collections" link and no second `<h1>` here. It registers nothing with
 * the status strip either, because every action on this surface writes
 * immediately; there is never anything staged to save.
 *
 * `bundle` is the working set hoisted into StudioPane so this surface and the
 * tailoring workbench share one fetch (see useResumeBundle).
 */

/** The section notes, hoisted so the loading state can stand in for them. */
const SECTIONS = {
  versions: {
    heading: 'Versions',
    rows: 3,
  },
  jobs: {
    heading: 'Jobs',
    note: 'Canonical positions — each owns its facts and the shared pool of bullets (and their forked phrasings).',
    rows: 3,
  },
  education: {
    heading: 'Education',
    note: 'Canonical education entries, referenced by versions the same way jobs are.',
    rows: 1,
  },
};

/** The id the versions row-menu registers with the shell's one-sheet-at-a-time. */
const VERSION_SHEET = 'resume-version-actions';

export default function ResumeStudio({ agent, did, bundle }) {
  const { invalidate } = useAdminShell();
  const { resumes, jobs, education, loading, error, reload, applyWrites } = useResumeBundle(
    agent,
    did,
    bundle,
  );
  const [actionError, setActionError] = useState(null);
  const [renamingUri, setRenamingUri] = useState(null);

  // What a rename is about to do to the rest of the repo, as a sentence, for
  // whichever key is currently typed into the inline form. It used to be the
  // body of a second native `confirm` stacked on top of the first — a create
  // AND a delete of an at:// record driven by two OS dialogs that ignore the
  // theme and cannot show a collision beside the field that caused it. Said
  // here, live, under the input, it is the same information the moment it is
  // true rather than after the decision.
  const renameNote = (collection, rec, toRkey) => {
    const fromRkey = rkeyFromUri(rec.uri);
    const backlinks = backlinksFor(collection);
    if (!backlinks.length) {
      return `Recreates this version as “${toRkey}” — its slug and /available URL follow the key — and deletes “${fromRkey}”.`;
    }
    const refCount = countBacklinks(resumes, rec.uri, backlinks);
    return `Recreates the record as “${toRkey}”, repoints ${refCount} resume version${
      refCount === 1 ? '' : 's'
    } that reference it, and deletes “${fromRkey}”.`;
  };

  // "Rename" a record's key. Because AT keys records immutably, this recreates
  // the record under the new key, repoints resume backlinks, and deletes the
  // old one (see renameRecordKey). The caller — the inline form in the row —
  // owns the question and the validation; this owns the writes.
  async function renameRecord(collection, rec, toRkey) {
    if (renamingUri) return;
    const fromRkey = rkeyFromUri(rec.uri);
    const v = rec.value || {};
    if (!toRkey || toRkey === fromRkey) return;

    setRenamingUri(rec.uri);
    setActionError(null);
    try {
      const value = collection === COLLECTIONS.resume ? { ...v, slug: toRkey } : v;
      await renameRecordKey({
        agent,
        did,
        collection,
        fromRkey,
        toRkey,
        value,
        resumes,
        backlinks: backlinksFor(collection),
      });
      reload();
      // A rename is a create AND a delete, so every cached view of this
      // collection — the rail's presence dot, the Front Desk's counts and its
      // "latest records" list — is now describing a record key that is gone.
      invalidate([collection]);
    } catch (err) {
      setActionError(err?.message || String(err));
    } finally {
      setRenamingUri(null);
    }
  }

  const jobsByUri = useMemo(() => {
    const m = new Map();
    for (const r of jobs || []) m.set(r.uri, r);
    return m;
  }, [jobs]);

  const sortedJobs = useMemo(
    () => [...(jobs || [])].sort((a, b) => String(b.value?.startDate || '').localeCompare(String(a.value?.startDate || ''))),
    [jobs],
  );
  const sortedEducation = useMemo(
    () => [...(education || [])].sort((a, b) => String(b.value?.startDate || '').localeCompare(String(a.value?.startDate || ''))),
    [education],
  );

  return (
    // A block container, not a bare fragment: the sections below space
    // themselves with collapsing top margins, which only happens inside one —
    // as flex items of `.wb-studio` they would get the pane's gap on top.
    <div className="rs-studio">
      {(error || actionError) && <p className="admin-error">{error || actionError}</p>}

      {loading ? (
        <StudioSkeleton />
      ) : (
        <>
          <VersionsSection
            agent={agent}
            did={did}
            resumes={resumes}
            jobsByUri={jobsByUri}
            onChanged={reload}
            onWritten={applyWrites}
            onError={setActionError}
            onRename={(rec, toRkey) => renameRecord(COLLECTIONS.resume, rec, toRkey)}
            renameNote={(rec, toRkey) => renameNote(COLLECTIONS.resume, rec, toRkey)}
            renamingUri={renamingUri}
          />
          <RecordsSection
            heading={SECTIONS.jobs.heading}
            note={SECTIONS.jobs.note}
            collection={COLLECTIONS.resumeJob}
            records={sortedJobs}
            labelFor={(v) => [v.title, v.organization].filter(Boolean).join(' · ')}
            newLabel="New job"
            onRename={(rec, toRkey) => renameRecord(COLLECTIONS.resumeJob, rec, toRkey)}
            renameNote={(rec, toRkey) => renameNote(COLLECTIONS.resumeJob, rec, toRkey)}
            renamingUri={renamingUri}
          />
          <RecordsSection
            heading={SECTIONS.education.heading}
            note={SECTIONS.education.note}
            collection={COLLECTIONS.resumeEducation}
            records={sortedEducation}
            labelFor={(v) => [v.institution, v.studyType || v.area].filter(Boolean).join(' · ')}
            newLabel="New education entry"
            onRename={(rec, toRkey) => renameRecord(COLLECTIONS.resumeEducation, rec, toRkey)}
            renameNote={(rec, toRkey) => renameNote(COLLECTIONS.resumeEducation, rec, toRkey)}
            renamingUri={renamingUri}
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading                                                              */
/* ------------------------------------------------------------------ */

/** The versions note, said once for both the loading state and the loaded one. */
function VersionsNote() {
  return (
    <p className="admin-collection-group-note">
      Each version selects, orders, and phrases its own view of the shared records. The
      active one is what <code>/available</code> shows.
    </p>
  );
}

/**
 * Three titled sections, because that is what this page resolves to.
 *
 * The old placeholder was six uniform rows — about 200px of undifferentiated
 * list standing in for 935px of content in three headed sections — so the pane
 * grew by roughly 735px when the bundle landed, and none of the structure below
 * the fold was announced. The headings and notes are the real ones; the row
 * counts are the fixture's shape (3 versions, 3 jobs, 1 education), which is
 * the honest guess before the data says otherwise.
 */
function StudioSkeleton() {
  return (
    <>
      <section className="admin-page-section rs-section">
        <h2 className="admin-collection-group-heading small-caps">{SECTIONS.versions.heading}</h2>
        <VersionsNote />
        <AdminRecordListSkeleton rows={SECTIONS.versions.rows} label="Loading resume versions" />
      </section>
      {['jobs', 'education'].map((key) => (
        <section className="admin-page-section rs-section" key={key}>
          <h2 className="admin-collection-group-heading small-caps">{SECTIONS[key].heading}</h2>
          <p className="admin-collection-group-note">{SECTIONS[key].note}</p>
          <AdminRecordListSkeleton
            rows={SECTIONS[key].rows}
            label={`Loading ${SECTIONS[key].heading.toLowerCase()}`}
          />
        </section>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Renaming and duplicating a key, in the row                           */
/* ------------------------------------------------------------------ */

/**
 * The inline form that replaced two stacked `window.prompt`s.
 *
 * Both operations it serves — renaming a record's key, and forking a version
 * under a new slug — are structural: they mint an at:// URI and, for a version,
 * a public /available URL. A native prompt cannot show the constraint next to
 * the field, cannot say what the typed key will actually be saved as, and
 * cannot put a collision anywhere but a banner at the top of the page, after
 * the fact. This says all three under the input, live, as you type.
 *
 * `slugifyResumeTitle` is the same normalizer the write path uses, so what the
 * hint promises is exactly what lands.
 *
 * @param {object} props
 * @param {string} props.label        The field's own label.
 * @param {string} props.from         The starting value (current key, or a suggestion).
 * @param {Set<string>} props.taken   Keys already in use in this collection.
 * @param {string|null} props.sameKeyMessage  Shown when the typed key is `from` — null when
 *                                    `from` is a suggestion rather than an existing key.
 * @param {(key: string) => string} props.noteFor  What this will do to the repo, live.
 * @param {string} props.submitLabel
 * @param {boolean} props.busy
 */
function KeyForm({ label, from, taken, sameKeyMessage, noteFor, submitLabel, busy, onCancel, onSubmit }) {
  const [typed, setTyped] = useState(from);
  const key = slugifyResumeTitle(typed);
  // Focused on open, in a frame of its own rather than with `autoFocus`. On a
  // phone this form is opened FROM the row's ⋯ sheet, and AdminSheet's focus
  // trap hands focus back to whatever opened it as it closes — which lands
  // after mount and would take the field back to the ⋯ button. The form only
  // exists because the owner just asked for it, and it stands in for a native
  // prompt that took focus outright; landing them a Tab away would be a
  // regression on the thing it replaced.
  const fieldRef = useRef(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => fieldRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  const problem = !key
    ? 'A key needs letters, numbers or dashes — that one is empty once cleaned up.'
    : sameKeyMessage && key === from
      ? sameKeyMessage
      : taken.has(key)
        ? `A record with the key “${key}” already exists.`
        : null;

  return (
    <form
      className="rs-keyform"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && !busy) onSubmit(key);
      }}
    >
      <label className="rf-inline-field rf-inline-field-block rs-keyform-field">
        <span className="rf-inline-label">{label}</span>
        <input
          ref={fieldRef}
          className="admin-input"
          type="text"
          value={typed}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <p className={`admin-field-hint rs-keyform-note${problem ? ' is-problem' : ''}`}>
        {problem || noteFor(key)}
      </p>
      <div className="rs-keyform-actions">
        <button
          type="submit"
          className="admin-gate-button admin-gate-button-tight"
          disabled={!!problem || busy}
        >
          {busy ? 'Working…' : submitLabel}
        </button>
        <button type="button" className="admin-link-subtle" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Versions                                                             */
/* ------------------------------------------------------------------ */

/**
 * What to call a version on screen.
 *
 * Deliberately NOT the rkey: a version's key is already in the row, in the mono
 * chip on the meta line, and a title slot that repeats it prints the same
 * twelve characters twice — which is the default state of every freshly created
 * version, not an edge case. An untitled one says so, and the row keeps a
 * heading you can read at a glance.
 */
function versionName(value) {
  return value?.title || 'Untitled version';
}

/**
 * The same name for a screen reader, where the rkey earns its place: three rows
 * all announcing "Untitled version" is three controls with one name, and the
 * chip that disambiguates them visually is not part of the button.
 */
function versionLabel(value, rkey) {
  return value?.title || `Untitled version ${rkey}`;
}

/** "5 jobs · 23 bullets" summary for one resume against the job pool. */
function versionCounts(value, jobsByUri) {
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  let bullets = 0;
  for (const entry of entries) {
    if (Array.isArray(entry.highlightIds)) {
      bullets += entry.highlightIds.length;
    } else {
      const hs = jobsByUri.get(entry.job)?.value?.highlights || [];
      bullets += hs.filter((h) => (h.visibility || 'public') !== 'private').length;
    }
  }
  return { jobs: entries.length, bullets };
}

function VersionsSection({
  agent,
  did,
  resumes,
  jobsByUri,
  onChanged,
  onWritten,
  onError,
  onRename,
  renameNote,
  renamingUri,
}) {
  const { go, invalidate, stacked, sheet, setSheet } = useAdminShell();
  const [busy, setBusy] = useState(null); // rkey being written
  // Which row has its key form open, and which question it is asking. One at a
  // time: two open forms would be two claims on the same collection's keys.
  const [form, setForm] = useState(null); // { uri, kind: 'rename' | 'duplicate' }
  // Which row the ⋯ menu belongs to. The shell owns whether a sheet is OPEN
  // (one at a time, cleared on any subject change); this owns which subject it
  // is about.
  const [menuUri, setMenuUri] = useState(null);

  const takenKeys = useMemo(
    () => new Set((resumes || []).map((r) => rkeyFromUri(r.uri))),
    [resumes],
  );

  const closeMenu = () => setSheet(null);
  const openForm = (uri, kind) => {
    setSheet(null);
    setForm({ uri, kind });
  };

  const activeRkey = useMemo(() => {
    const found = (resumes || []).find((rec) => rec.value?.featured);
    return found ? rkeyFromUri(found.uri) : null;
  }, [resumes]);

  // The one version shown at /available. The sibling-clearing write itself now
  // lives in resumeAdmin.js, because the workbench's "Active" checkbox has to
  // reach the same invariant from a staged save — this is the immediate half of
  // it, and all that is left here is the busy/error plumbing the picker needs.
  async function setActive(rkey) {
    if (busy) return;
    setBusy(rkey);
    onError(null);
    try {
      await setActiveResume(agent, did, resumes, rkey);
      onChanged?.();
    } catch (err) {
      onError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /** The slug a fork should start from: the source's, made unique. */
  function duplicateSuggestion(rec) {
    const srcRkey = rkeyFromUri(rec.uri);
    let suggestion = `${rec.value?.slug || srcRkey}-copy`;
    while (takenKeys.has(suggestion)) suggestion = `${suggestion}-2`;
    return suggestion;
  }

  // Fork a whole version: copy the record under a new slug (never featured,
  // private until published) and jump straight into tailoring it. The slug
  // comes from the row's own form — this used to be a third `window.prompt` on
  // this surface, and the collision it could raise landed as a banner at the
  // top of the page rather than beside the field that caused it.
  async function duplicate(rec, slug) {
    const srcRkey = rkeyFromUri(rec.uri);
    if (!slug) return;
    setForm(null);
    setBusy(srcRkey);
    onError(null);
    try {
      const record = duplicateResumeValue(rec.value, {
        slug,
        title: `${rec.value?.title || srcRkey} (copy)`,
      });
      record.$type = COLLECTIONS.resume;
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: COLLECTIONS.resume,
        rkey: slug,
        record,
      });
      invalidate([COLLECTIONS.resume]);
      // Write through before navigating. The bundle is hoisted into StudioPane,
      // which stays mounted across this navigation — so without this the
      // workbench would open on a version its snapshot has never heard of and
      // render "no such version".
      onWritten?.([
        { collection: COLLECTIONS.resume, uri: `at://${did}/${COLLECTIONS.resume}/${slug}`, value: record },
      ]);
      // `go`, not a router navigate: it merges into the URL the shell already
      // holds and leaves StudioPane mounted, so the workbench opens against the
      // bundle THIS studio already loaded rather than refetching all four
      // collections. `force` because the write has landed — there is nothing
      // left unsaved to warn about.
      go({ view: 'resume-tailor', r: slug, c: null, mode: null, for: null }, { force: true });
    } catch (err) {
      onError(err?.message || String(err));
      setBusy(null);
    }
  }

  const menuRec = (resumes || []).find((rec) => rec.uri === menuUri) || null;
  const menuName = menuRec ? versionName(menuRec.value) : '';

  return (
    <section className="admin-page-section rs-section">
      <h2 className="admin-collection-group-heading small-caps">{SECTIONS.versions.heading}</h2>
      <VersionsNote />
      {(resumes || []).length === 0 ? (
        // The "create the first one" link that used to live in this sentence is
        // now the add link below, which is on screen either way.
        <p className="placeholder-card">No resume versions yet.</p>
      ) : (
        <ul className="rs-version-list reveal-stagger">
          {resumes.map((rec) => {
            const r = rkeyFromUri(rec.uri);
            const v = rec.value || {};
            const isActive = r === activeRkey;
            const counts = versionCounts(v, jobsByUri);
            const vis = v.visibility || 'private';
            const slug = v.slug || r;
            const rowForm = form?.uri === rec.uri ? form.kind : null;
            const rowBusy = busy === r || renamingUri === rec.uri;
            return (
              <li key={rec.uri} className={`rs-version${isActive ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className="rs-active-radio"
                  onClick={() => !isActive && setActive(r)}
                  disabled={!!busy}
                  aria-pressed={isActive}
                  /* Named after the version rather than "Make this the active
                     version": three identical announcements in a column of
                     three tell a screen-reader user nothing about which one
                     they are on. */
                  aria-label={
                    isActive
                      ? `${versionLabel(v, r)} — the active version, shown at /available`
                      : `Make ${versionLabel(v, r)} the active version`
                  }
                  title={isActive ? 'Active — shown at /available' : 'Make this the active version'}
                >
                  <span className="rs-radio-dot" aria-hidden="true" />
                </button>
                <div className="rs-version-main">
                  <div className="rs-version-head">
                    {/* The version's own name leads the row. It used to be the
                        rkey — a 12-character base32 string, printed AGAIN in
                        the chip on the line below, which is the default state
                        of every freshly created version and reads as a
                        rendering bug rather than as two facts. The workbench
                        already refused to print it twice; this is the same
                        rule on the surface that lists them. */}
                    <Link
                      className={`rs-version-title${v.title ? '' : ' is-untitled'}`}
                      to={`/admin?view=resume-tailor&r=${encodeURIComponent(r)}`}
                    >
                      {versionName(v)}
                    </Link>
                    {isActive && <span className="rs-chip rs-chip-accent small-caps">active</span>}
                    {vis !== 'public' && <span className="rs-chip small-caps">{vis}</span>}
                    {rowBusy && <span className="rs-chip small-caps">saving…</span>}
                  </div>
                  {/* Separators are drawn by the items themselves (::before), so
                      a middle dot can never be the last thing on a wrapped line
                      the way a free-standing <span> could. */}
                  <div className="rs-version-meta">
                    <code className="admin-record-rkey">{slug}</code>
                    <span>
                      {counts.jobs} job{counts.jobs === 1 ? '' : 's'}
                    </span>
                    <span>
                      {counts.bullets} bullet{counts.bullets === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                {/* On a phone the three secondary links become one 44px control
                    (admin-mobile-design.md §6): 19px text links 4px apart are
                    not a target, and three of them is most of the row. It sits
                    at the row's top corner, beside what it is about, rather
                    than in the button cluster — at 320 the cluster is already
                    16px wider than the column. */}
                {stacked && (
                  <button
                    type="button"
                    className="rs-row-more"
                    onClick={() => {
                      setMenuUri(rec.uri);
                      setSheet(VERSION_SHEET);
                    }}
                    aria-haspopup="dialog"
                    aria-label={`More actions for ${versionLabel(v, r)}`}
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                )}
                <div className="rs-version-actions">
                  {/* Two buttons and nothing else in this row: it is the same
                      two on every version, so the column has one width and the
                      pair share a left edge down the list. The text links used
                      to sit beside them, and a private version has one fewer of
                      them — which measured 48px, and moved every button on that
                      row by all of it. */}
                  <div className="rs-version-buttons">
                    <Link
                      className="admin-gate-button admin-gate-button-tight"
                      to={`/admin?view=resume-tailor&r=${encodeURIComponent(r)}`}
                    >
                      <PenLine size={13} aria-hidden="true" /> Tailor
                    </Link>
                    <button
                      type="button"
                      className="admin-gate-button admin-gate-button-tight"
                      onClick={() => openForm(rec.uri, 'duplicate')}
                      disabled={!!busy || !!renamingUri}
                      title="Fork this version under a new slug"
                    >
                      <Copy size={13} aria-hidden="true" /> Duplicate
                    </button>
                  </div>
                  {!stacked && (
                    <div className="rs-version-links">
                      <Link
                        className="admin-link-subtle rs-version-raw"
                        to={`/admin?c=${encodeURIComponent(COLLECTIONS.resume)}&r=${encodeURIComponent(r)}`}
                        title="Open the raw record editor"
                      >
                        record
                      </Link>
                      {onRename && (
                        <button
                          type="button"
                          className="admin-link-subtle rs-version-raw"
                          onClick={() => openForm(rec.uri, 'rename')}
                          disabled={!!busy || !!renamingUri}
                          title="Change this version's key + slug (/available URL)"
                        >
                          {renamingUri === rec.uri ? 'renaming…' : 'rename'}
                        </button>
                      )}
                      {vis !== 'private' && (
                        <Link
                          className="admin-link-subtle rs-version-raw"
                          to={`/available/${encodeURIComponent(slug)}`}
                          title="View on the site"
                        >
                          <ExternalLink size={12} aria-hidden="true" /> view
                        </Link>
                      )}
                    </div>
                  )}
                </div>
                {rowForm === 'rename' && onRename && (
                  <KeyForm
                    label="New record key"
                    from={r}
                    taken={takenKeys}
                    sameKeyMessage="That is already this version's key."
                    noteFor={(key) => renameNote(rec, key)}
                    submitLabel="Rename"
                    busy={renamingUri === rec.uri}
                    onCancel={() => setForm(null)}
                    onSubmit={(key) => {
                      setForm(null);
                      onRename(rec, key);
                    }}
                  />
                )}
                {rowForm === 'duplicate' && (
                  <KeyForm
                    label="Slug for the copy"
                    from={duplicateSuggestion(rec)}
                    taken={takenKeys}
                    sameKeyMessage={null}
                    noteFor={(key) =>
                      `Copies this version to “${key}” — its record key and /available/${key} URL — private and not active, and opens it for tailoring.`
                    }
                    submitLabel="Duplicate"
                    busy={busy === r}
                    onCancel={() => setForm(null)}
                    onSubmit={(key) => duplicate(rec, key)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* One sheet for whichever row asked, rather than one per row: the shell
          keeps a single sheet open at a time and clears it on any subject
          change, so the menu cannot outlive the list it describes. */}
      <AdminSheet
        open={sheet === VERSION_SHEET && !!menuRec}
        onClose={closeMenu}
        id="rs-version-sheet"
        label={menuRec ? `Actions for ${menuName}` : 'Version actions'}
      >
        <p className="wb-sheet-heading">{menuName}</p>
        <ul className="wb-sheet-list">
          <li>
            <Link
              className="wb-sheet-row"
              to={`/admin?c=${encodeURIComponent(COLLECTIONS.resume)}&r=${encodeURIComponent(
                menuRec ? rkeyFromUri(menuRec.uri) : '',
              )}`}
              onClick={closeMenu}
            >
              <span className="wb-sheet-row-label">Open the raw record</span>
            </Link>
          </li>
          {onRename && (
            <li>
              <button
                type="button"
                className="wb-sheet-row"
                onClick={() => menuRec && openForm(menuRec.uri, 'rename')}
              >
                <span className="wb-sheet-row-label">Rename key and slug…</span>
              </button>
            </li>
          )}
          {menuRec && (menuRec.value?.visibility || 'private') !== 'private' && (
            <li>
              <Link
                className="wb-sheet-row"
                to={`/available/${encodeURIComponent(
                  menuRec.value?.slug || rkeyFromUri(menuRec.uri),
                )}`}
                onClick={closeMenu}
              >
                <span className="wb-sheet-row-label">View on the site ↗</span>
              </Link>
            </li>
          )}
        </ul>
      </AdminSheet>
      {/* "New version" used to sit in the studio's own toolbar, next to a back
          link the rail replaced. It belongs at the foot of the list it adds to
          anyway — exactly where Jobs and Education already put theirs. */}
      <Link
        className="rf-add rs-section-add"
        to={`/admin?c=${encodeURIComponent(COLLECTIONS.resume)}&mode=new`}
      >
        <Plus size={15} aria-hidden="true" /> New version
      </Link>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Canonical record lists (jobs / education)                            */
/* ------------------------------------------------------------------ */

function RecordsSection({
  heading,
  note,
  collection,
  records,
  labelFor,
  newLabel,
  onRename,
  renameNote,
  renamingUri,
}) {
  const [formUri, setFormUri] = useState(null);
  const takenKeys = useMemo(
    () => new Set((records || []).map((r) => rkeyFromUri(r.uri))),
    [records],
  );

  return (
    <section className="admin-page-section rs-section">
      <h2 className="admin-collection-group-heading small-caps">{heading}</h2>
      <p className="admin-collection-group-note">{note}</p>
      {(records || []).length === 0 ? (
        <p className="placeholder-card">Nothing here yet.</p>
      ) : (
        <ul className="admin-record-list reveal-stagger">
          {records.map((rec) => {
            const r = rkeyFromUri(rec.uri);
            const v = rec.value || {};
            const highlights = Array.isArray(v.highlights) ? v.highlights : [];
            const forks = highlights.reduce(
              (n, h) => n + (Array.isArray(h.variants) ? h.variants.length : 0),
              0,
            );
            const linkCount = Array.isArray(v.links) ? v.links.length : 0;
            const dates = formatDateRange(v);
            return (
              <li key={rec.uri} className="admin-record-row rs-record-row">
                <Link
                  to={`/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(r)}`}
                  className="admin-record-link"
                >
                  {/* Name first, key underneath — the same order as the version
                      rows above and as every row in the record list. This list
                      used to lead with the rkey, so one studio drew three
                      different row shapes. */}
                  <span className="admin-record-main">
                    <span className="admin-record-preview">{labelFor(v) || r}</span>
                    <span className="rs-record-counts">
                      <code className="admin-record-rkey">{r}</code>
                      <span>
                        {highlights.length} bullet{highlights.length === 1 ? '' : 's'}
                      </span>
                      {forks > 0 && (
                        <span>
                          {forks} fork{forks === 1 ? '' : 's'}
                        </span>
                      )}
                      {linkCount > 0 && (
                        <span>
                          {linkCount} link{linkCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                  </span>
                  {dates && <span className="admin-record-time small-caps">{dates}</span>}
                </Link>
                {onRename && (
                  <button
                    type="button"
                    className="admin-link-subtle rs-rename"
                    onClick={() => setFormUri((open) => (open === rec.uri ? null : rec.uri))}
                    disabled={!!renamingUri}
                    aria-expanded={formUri === rec.uri}
                    title="Change this record's key (slug), updating every version that references it"
                  >
                    {renamingUri === rec.uri ? 'renaming…' : 'rename key'}
                  </button>
                )}
                {formUri === rec.uri && onRename && (
                  <KeyForm
                    label="New record key"
                    from={r}
                    taken={takenKeys}
                    sameKeyMessage="That is already this record's key."
                    noteFor={(key) => renameNote(rec, key)}
                    submitLabel="Rename"
                    busy={renamingUri === rec.uri}
                    onCancel={() => setFormUri(null)}
                    onSubmit={(key) => {
                      setFormUri(null);
                      onRename(rec, key);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Link
        className="rf-add rs-section-add"
        to={`/admin?c=${encodeURIComponent(collection)}&mode=new`}
      >
        <Plus size={15} aria-hidden="true" /> {newLabel}
      </Link>
    </section>
  );
}
