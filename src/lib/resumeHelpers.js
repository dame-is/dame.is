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

/* ------------------------------------------------------------------ */
/* Highlight refs & variants                                            */
/* ------------------------------------------------------------------ */
//
// A resume's `highlightIds` entry is either a bare highlight id ("h3" → the
// bullet's canonical text) or "<highlightId>#<variantId>" ("h3#v2" → that
// forked phrasing from the highlight's `variants`). These helpers are the one
// place that syntax is parsed/produced.

/** Split a highlight ref into its base id and optional variant id. */
export function parseHighlightRef(ref) {
  const s = String(ref || '');
  const i = s.indexOf('#');
  if (i === -1) return { id: s, variantId: null };
  return { id: s.slice(0, i), variantId: s.slice(i + 1) || null };
}

/** Build a highlight ref string from a base id and optional variant id. */
export function makeHighlightRef(id, variantId) {
  return variantId ? `${id}#${variantId}` : id;
}

/** Next unique `hN` id for a new highlight in this list. */
export function nextHighlightId(list) {
  const used = new Set((list || []).map((h) => h?.id).filter(Boolean));
  let n = (list || []).length + 1;
  while (used.has(`h${n}`)) n += 1;
  return `h${n}`;
}

/** Next unique `vN` id for a new variant of one highlight. */
export function nextVariantId(variants) {
  const used = new Set((variants || []).map((v) => v?.id).filter(Boolean));
  let n = (variants || []).length + 1;
  while (used.has(`v${n}`)) n += 1;
  return `v${n}`;
}

/**
 * Resolve one highlight ref against a job/education record's highlights.
 * Returns a render-ready bullet — the base highlight with `text` swapped for
 * the variant's when the ref names one — or null when the base id is gone.
 * A dangling variant id degrades to the canonical text rather than dropping
 * the bullet. `refId` echoes the ref that actually resolved (so keys stay
 * stable and editors can round-trip the selection).
 */
export function resolveHighlightRef(record, ref) {
  const all = Array.isArray(record?.highlights) ? record.highlights : [];
  const { id, variantId } = parseHighlightRef(ref);
  const h = all.find((x) => x?.id === id);
  if (!h) return null;
  if (variantId) {
    const v = (h.variants || []).find((x) => x?.id === variantId);
    if (v) return { ...h, refId: makeHighlightRef(id, variantId), text: v.text, variantId };
  }
  return { ...h, refId: h.id, variantId: null };
}

/**
 * Resolve which highlights a resume entry shows for its job, honoring the
 * entry's explicit `highlightIds` ordering (and any `#variant` phrasing picks)
 * when present — otherwise every highlight in natural order, canonical text —
 * then dropping any marked `private`.
 */
export function selectHighlights(job, entry) {
  const all = Array.isArray(job?.highlights) ? job.highlights : [];
  // An array — even an empty one — is an explicit selection ("show none" is a
  // legitimate tailoring choice). Only a missing list means "all non-private".
  if (Array.isArray(entry?.highlightIds)) {
    return entry.highlightIds
      .map((ref) => resolveHighlightRef(job, ref))
      .filter(Boolean)
      .filter(VISIBLE);
  }
  return all.filter(VISIBLE).map((h) => ({ ...h, refId: h.id, variantId: null }));
}

/**
 * Resolve which links (portfolio pieces / external URLs) a resume entry shows
 * for its job. Same selection semantics as highlights: an explicit `linkIds`
 * array (even empty) wins, otherwise every non-private link in natural order.
 */
export function selectLinks(job, entry) {
  const all = Array.isArray(job?.links) ? job.links : [];
  if (Array.isArray(entry?.linkIds)) {
    const byId = new Map(all.map((l) => [l.id, l]));
    return entry.linkIds.map((id) => byId.get(id)).filter(Boolean).filter(VISIBLE);
  }
  return all.filter(VISIBLE);
}

/**
 * Resolve an entry's selected links into a render-ready shape. A `work` link is
 * matched against the fetched portfolio documents (a Map<uri, {value}>) so it
 * can render as an embed of the live post; an unresolved or external link keeps
 * its stored `url`. Returns `{ id, label, description, href, doc, isWork }`.
 */
export function resolveLinks(job, entry, docMap) {
  return selectLinks(job, entry).map((link) => {
    const doc = link.work ? docMap.get(link.work)?.value || null : null;
    return {
      id: link.id,
      label: link.label || '',
      description: link.description || '',
      href: link.work || link.url || '',
      url: link.url || '',
      work: link.work || '',
      doc,
      isWork: Boolean(link.work),
    };
  });
}

/**
 * Scan every resume for uses of one job/education record's bullets.
 *
 * Returns Map<baseHighlightId, Array<{ rkey, label, variantId, implicit }>> —
 * one entry per (resume, selection). `implicit: true` marks resumes that show
 * the bullet because they omit `highlightIds` (default = all non-private), so
 * `highlights` must be passed to expand that default. Powers the "used by"
 * chips and the are-you-sure guards in the admin editors.
 */
export function collectHighlightUsage({ resumes, recordUri, listKey, refKey, highlights }) {
  const usage = new Map();
  const push = (baseId, info) => {
    if (!baseId) return;
    if (!usage.has(baseId)) usage.set(baseId, []);
    usage.get(baseId).push(info);
  };
  for (const rec of resumes || []) {
    const v = rec?.value || {};
    const rkey = rkeyFromAtUri(rec.uri);
    const label = v.title || v.slug || rkey;
    for (const entry of v[listKey] || []) {
      if (entry?.[refKey] !== recordUri) continue;
      if (Array.isArray(entry.highlightIds)) {
        for (const ref of entry.highlightIds) {
          const { id, variantId } = parseHighlightRef(ref);
          push(id, { rkey, label, variantId, implicit: false });
        }
      } else {
        for (const h of highlights || []) {
          if (!VISIBLE(h)) continue;
          push(h.id, { rkey, label, variantId: null, implicit: true });
        }
      }
    }
  }
  return usage;
}

/** Kebab-case a title into a slug/rkey candidate. */
export function slugifyResumeTitle(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Deep-copy a resume value as a new draft version: fresh title/slug, never
 * featured, private until deliberately published, timestamps reset. The
 * entries/education selections (including variant picks), skills, and contact
 * all carry over — that's the point of forking a version.
 */
export function duplicateResumeValue(value, { title, slug } = {}) {
  const src = JSON.parse(JSON.stringify(value || {}));
  const now = new Date().toISOString();
  return {
    ...src,
    title: title || `${src.title || 'Untitled resume'} (copy)`,
    slug: slug || `${src.slug || 'resume'}-copy`,
    featured: false,
    visibility: 'private',
    createdAt: now,
    updatedAt: now,
  };
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
export function resolveResume(resumeRecord, jobs, education, documents) {
  const value = resumeRecord?.value || {};
  const jobMap = indexByUri(jobs);
  const eduMap = indexByUri(education);
  const docMap = indexByUri(documents);
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
      links: resolveLinks(job, entry, docMap),
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
 * Choose the single active resume shown at /for-hire: the one flagged
 * `featured` (set from the admin panel), else the first public one, else any
 * renderable one. `private` resumes are skipped.
 */
export function pickDefaultResume(resumes) {
  const list = (resumes || []).filter(renderable);
  return (
    list.find((r) => r.value.featured) ||
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
