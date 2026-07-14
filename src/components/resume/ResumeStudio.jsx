import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, PenLine, ExternalLink, Plus } from 'lucide-react';
import PageShell from '../PageShell.jsx';
import { AdminRecordListSkeleton } from '../Skeleton.jsx';
import { rkeyFromUri } from '../RecordEditor.jsx';
import { COLLECTIONS } from '../../config.js';
import {
  formatDateRange,
  duplicateResumeValue,
  slugifyResumeTitle,
} from '../../lib/resumeHelpers.js';
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
 */
export default function ResumeStudio({ agent, did }) {
  const { resumes, jobs, education, loading, error, reload } = useResumeBundle(agent, did);
  const [actionError, setActionError] = useState(null);

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
    <PageShell
      title="Resume studio"
      intro="Every version of the resume, and the canonical jobs and education records they draw from. Tailor a version to choose, reorder, re-word, and fork its bullets; edit a job to change the shared facts and bullet pool."
      headTitle="Resume studio — Admin — dame.is"
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
        <code className="admin-collection-nsid">{COLLECTIONS.resume}</code>
        <Link
          to={`/admin?c=${encodeURIComponent(COLLECTIONS.resume)}&mode=new`}
          className="admin-gate-button admin-gate-button-tight"
        >
          New version
        </Link>
      </div>

      {(error || actionError) && <p className="admin-error">{error || actionError}</p>}

      {loading ? (
        <AdminRecordListSkeleton rows={6} label="Loading resume records" />
      ) : (
        <>
          <VersionsSection
            agent={agent}
            did={did}
            resumes={resumes}
            jobsByUri={jobsByUri}
            onChanged={reload}
            onError={setActionError}
          />
          <RecordsSection
            heading="Jobs"
            note="Canonical positions — each owns its facts and the shared pool of bullets (and their forked phrasings)."
            collection={COLLECTIONS.resumeJob}
            records={sortedJobs}
            labelFor={(v) => [v.title, v.organization].filter(Boolean).join(' · ')}
            newLabel="New job"
          />
          <RecordsSection
            heading="Education"
            note="Canonical education entries, referenced by versions the same way jobs are."
            collection={COLLECTIONS.resumeEducation}
            records={sortedEducation}
            labelFor={(v) => [v.institution, v.studyType || v.area].filter(Boolean).join(' · ')}
            newLabel="New education entry"
          />
        </>
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Versions                                                             */
/* ------------------------------------------------------------------ */

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

function VersionsSection({ agent, did, resumes, jobsByUri, onChanged, onError }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null); // rkey being written

  const activeRkey = useMemo(() => {
    const found = (resumes || []).find((rec) => rec.value?.featured);
    return found ? rkeyFromUri(found.uri) : null;
  }, [resumes]);

  // The one version shown at /for-hire: featured=true here, cleared elsewhere.
  async function setActive(rkey) {
    if (busy) return;
    setBusy(rkey);
    onError(null);
    try {
      for (const rec of resumes) {
        const r = rkeyFromUri(rec.uri);
        const shouldBeActive = r === rkey;
        if (shouldBeActive === !!rec.value?.featured) continue;
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: COLLECTIONS.resume,
          rkey: r,
          record: { ...rec.value, featured: shouldBeActive, updatedAt: new Date().toISOString() },
        });
      }
      onChanged?.();
    } catch (err) {
      onError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  // Fork a whole version: copy the record under a new slug (never featured,
  // private until published) and jump straight into tailoring it.
  async function duplicate(rec) {
    const srcRkey = rkeyFromUri(rec.uri);
    const taken = new Set((resumes || []).map((r) => rkeyFromUri(r.uri)));
    let suggestion = `${rec.value?.slug || srcRkey}-copy`;
    while (taken.has(suggestion)) suggestion = `${suggestion}-2`;
    const input = window.prompt(
      'Slug for the new version (also its record key and /for-hire/<slug> URL):',
      suggestion,
    );
    if (input == null) return;
    const slug = slugifyResumeTitle(input);
    if (!slug) {
      onError('That slug is empty once cleaned up — use letters, numbers, and dashes.');
      return;
    }
    if (taken.has(slug)) {
      onError(`A version with the slug “${slug}” already exists.`);
      return;
    }
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
      navigate(`/admin?view=resume-tailor&r=${encodeURIComponent(slug)}`);
    } catch (err) {
      onError(err?.message || String(err));
      setBusy(null);
    }
  }

  return (
    <section className="admin-page-section rs-section">
      <h2 className="admin-collection-group-heading small-caps">Versions</h2>
      <p className="admin-collection-group-note">
        Each version selects, orders, and phrases its own view of the shared records. The
        active one is what <code>/for-hire</code> shows.
      </p>
      {(resumes || []).length === 0 ? (
        <p className="placeholder-card">
          No resume versions yet. <Link to={`/admin?c=${encodeURIComponent(COLLECTIONS.resume)}&mode=new`}>Create the first one.</Link>
        </p>
      ) : (
        <ul className="rs-version-list reveal-stagger">
          {resumes.map((rec) => {
            const r = rkeyFromUri(rec.uri);
            const v = rec.value || {};
            const isActive = r === activeRkey;
            const counts = versionCounts(v, jobsByUri);
            const vis = v.visibility || 'private';
            const slug = v.slug || r;
            return (
              <li key={rec.uri} className={`rs-version${isActive ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className="rs-active-radio"
                  onClick={() => !isActive && setActive(r)}
                  disabled={!!busy}
                  aria-pressed={isActive}
                  title={isActive ? 'Active — shown at /for-hire' : 'Make this the active version'}
                >
                  <span className="rs-radio-dot" aria-hidden="true" />
                </button>
                <div className="rs-version-main">
                  <div className="rs-version-head">
                    <Link
                      className="rs-version-title"
                      to={`/admin?view=resume-tailor&r=${encodeURIComponent(r)}`}
                    >
                      {v.title || r}
                    </Link>
                    {isActive && <span className="rs-chip rs-chip-accent small-caps">active</span>}
                    {vis !== 'public' && <span className="rs-chip small-caps">{vis}</span>}
                    {busy === r && <span className="rs-chip small-caps">saving…</span>}
                  </div>
                  <div className="rs-version-meta">
                    <code className="admin-record-rkey">{slug}</code>
                    <span className="rs-dot">·</span>
                    {counts.jobs} job{counts.jobs === 1 ? '' : 's'}
                    <span className="rs-dot">·</span>
                    {counts.bullets} bullet{counts.bullets === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="rs-version-actions">
                  <Link
                    className="admin-gate-button admin-gate-button-tight"
                    to={`/admin?view=resume-tailor&r=${encodeURIComponent(r)}`}
                  >
                    <PenLine size={13} aria-hidden="true" /> Tailor
                  </Link>
                  <button
                    type="button"
                    className="admin-gate-button admin-gate-button-tight"
                    onClick={() => duplicate(rec)}
                    disabled={!!busy}
                    title="Fork this version under a new slug"
                  >
                    <Copy size={13} aria-hidden="true" /> Duplicate
                  </button>
                  <Link
                    className="admin-link-subtle rs-version-raw"
                    to={`/admin?c=${encodeURIComponent(COLLECTIONS.resume)}&r=${encodeURIComponent(r)}`}
                    title="Open the raw record editor"
                  >
                    record
                  </Link>
                  {vis !== 'private' && (
                    <Link
                      className="admin-link-subtle rs-version-raw"
                      to={`/for-hire/${encodeURIComponent(slug)}`}
                      title="View on the site"
                    >
                      <ExternalLink size={12} aria-hidden="true" /> view
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Canonical record lists (jobs / education)                            */
/* ------------------------------------------------------------------ */

function RecordsSection({ heading, note, collection, records, labelFor, newLabel }) {
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
            const dates = formatDateRange(v);
            return (
              <li key={rec.uri} className="admin-record-row">
                <Link
                  to={`/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(r)}`}
                  className="admin-record-link"
                >
                  <code className="admin-record-rkey">{r}</code>
                  <span className="admin-record-main">
                    <span className="admin-record-preview">{labelFor(v) || r}</span>
                    <span className="rs-record-counts">
                      {highlights.length} bullet{highlights.length === 1 ? '' : 's'}
                      {forks > 0 && ` · ${forks} fork${forks === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  {dates && <span className="admin-record-time small-caps">{dates}</span>}
                </Link>
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
