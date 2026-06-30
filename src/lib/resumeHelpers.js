// Pure helpers for assembling a resume view out of its backlinked records.
//
// A resume (is.dame.resume) stores ordered AT-URI references to jobs and
// education records and, per entry, an optional list of highlight ids. These
// helpers resolve those references against the fetched job/education records,
// apply the per-entry highlight selection + visibility rules, and format the
// partial dates the schema uses ("YYYY" / "YYYY-MM").

import { rkeyFromAtUri } from './atproto.js';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a partial date string. Accepts "YYYY" or "YYYY-MM" (extra precision
 * is tolerated and truncated). Returns '' for empty/invalid input.
 *
 *   "2025-01" → "Jan 2025"
 *   "2010"    → "2010"
 */
export function formatPartialDate(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return String(value);
  const year = m[1];
  if (!m[2]) return year;
  const monthIdx = parseInt(m[2], 10) - 1;
  const month = MONTHS[monthIdx];
  return month ? `${month} ${year}` : year;
}

/**
 * Format a job/education date range. `current` (or a missing end date when the
 * record is flagged current) renders as "– Present".
 *
 *   { startDate: '2022-07', endDate: '2024-06' } → "Jul 2022 – Jun 2024"
 *   { startDate: '2025-01', current: true }      → "Jan 2025 – Present"
 *   { startDate: '2010', endDate: '2015' }       → "2010 – 2015"
 */
export function formatDateRange({ startDate, endDate, current } = {}) {
  const start = formatPartialDate(startDate);
  const end = current ? 'Present' : formatPartialDate(endDate);
  if (start && end) return `${start} – ${end}`;
  return start || end || '';
}

const VISIBLE = (h) => (h?.visibility || 'public') !== 'private';

/**
 * Resolve which highlights a resume entry shows for its job, honoring the
 * entry's explicit `highlightIds` ordering when present (otherwise every
 * highlight in natural order), then dropping any marked `private`.
 */
export function selectHighlights(job, entry) {
  const all = Array.isArray(job?.highlights) ? job.highlights : [];
  if (entry?.highlightIds?.length) {
    const byId = new Map(all.map((h) => [h.id, h]));
    return entry.highlightIds.map((id) => byId.get(id)).filter(Boolean).filter(VISIBLE);
  }
  return all.filter(VISIBLE);
}

/** Index an array of `{ uri, value }` records by AT URI. */
function indexByUri(records) {
  const map = new Map();
  for (const r of records || []) {
    if (r?.uri) map.set(r.uri, r);
  }
  return map;
}

/**
 * Resolve a resume record into a render-ready shape:
 *
 *   {
 *     value,                              // the raw resume value
 *     rkey, slug,
 *     experience: [                       // consecutive same-org entries grouped
 *       { organization, organizationUrl, roles: [
 *         { uri, title, summary, dateRange, location, locationType,
 *           employmentType, highlights }
 *       ] }
 *     ],
 *     education: [{ uri, value, highlights }],
 *     skills, contact,
 *   }
 *
 * `unresolved` collects entry URIs whose job/education record wasn't found
 * (e.g. a stale snapshot) so the caller can decide whether to wait for live.
 */
export function resolveResume(resumeRecord, jobs, education) {
  const value = resumeRecord?.value || {};
  const jobMap = indexByUri(jobs);
  const eduMap = indexByUri(education);
  const unresolved = [];

  const roles = [];
  for (const entry of value.entries || []) {
    const job = jobMap.get(entry.job)?.value;
    if (!job) {
      unresolved.push(entry.job);
      continue;
    }
    roles.push({
      uri: entry.job,
      organization: job.organization,
      organizationUrl: job.organizationUrl,
      title: entry.titleOverride || job.title,
      summary: entry.summaryOverride || job.summary,
      employmentType: job.employmentType,
      location: job.location,
      locationType: job.locationType,
      dateRange: formatDateRange(job),
      highlights: selectHighlights(job, entry),
    });
  }

  // Group consecutive roles at the same organization (mirrors how LinkedIn
  // nests multiple titles under one company).
  const experience = [];
  for (const role of roles) {
    const last = experience[experience.length - 1];
    if (last && last.organization === role.organization) {
      last.roles.push(role);
    } else {
      experience.push({
        organization: role.organization,
        organizationUrl: role.organizationUrl,
        roles: [role],
      });
    }
  }

  const education_ = [];
  for (const e of value.education || []) {
    const rec = eduMap.get(e.education)?.value;
    if (!rec) {
      unresolved.push(e.education);
      continue;
    }
    education_.push({
      uri: e.education,
      value: rec,
      dateRange: formatDateRange(rec),
      highlights: selectHighlights(rec, e),
    });
  }

  return {
    value,
    rkey: rkeyFromAtUri(resumeRecord?.uri),
    slug: value.slug || rkeyFromAtUri(resumeRecord?.uri),
    uri: resumeRecord?.uri,
    cid: resumeRecord?.cid,
    experience,
    education: education_,
    skills: Array.isArray(value.skills) ? value.skills : [],
    contact: value.contact || null,
    unresolved,
  };
}

const renderable = (r) => r?.value && (r.value.visibility || 'public') !== 'private';

/**
 * Choose the resume to show at /resume (no slug): the featured one, else the
 * first public one, else any renderable one. `private` resumes are skipped.
 */
export function pickDefaultResume(resumes) {
  const list = (resumes || []).filter(renderable);
  return (
    list.find((r) => r.value.featured && r.value.visibility !== 'unlisted') ||
    list.find((r) => (r.value.visibility || 'public') === 'public') ||
    list[0] ||
    null
  );
}

/** Find a resume by slug (or record key). Skips `private` resumes. */
export function findResumeBySlug(resumes, slug) {
  return (
    (resumes || [])
      .filter(renderable)
      .find((r) => (r.value.slug || rkeyFromAtUri(r.uri)) === slug) || null
  );
}

/** Public, listed resumes (for the version switcher). */
export function listPublicResumes(resumes) {
  return (resumes || []).filter(
    (r) => r?.value && (r.value.visibility || 'public') === 'public',
  );
}
