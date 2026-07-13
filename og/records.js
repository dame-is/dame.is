// Edge-safe resolver for per-record page metadata (blog posts, creative works,
// curated channels). middleware.js uses this to give record routes a real
// "<record title> — dame.is" <title>, a per-record OG card, and the record's
// own at:// URI in the crawler-facing <head>, instead of the generic section
// card. Plain fetch only, so it runs in the Edge runtime.
//
// A record route is /{section}/{slug}. The slug is NOT always an rkey:
//   • /blogging/:id      → id is the rkey of a site.standard.document (or a
//                          pub.leaflet.document)
//   • /creating/:slug    → slug is the doc's human `path` (e.g. "how-i-made-…"),
//                          matched against portfolio-homed standard docs — the
//                          rkey rarely equals the slug, which is exactly why the
//                          old getRecord-by-rkey lookup silently missed and
//                          every work fell back to the /creating section card
//   • /curating/:slug    → slug is the channel rkey
//
// Resolution mirrors the SPA (src/hooks/useAtUri.js): match against the static
// JSON snapshots the site already ships under /data/*.json (fast, edge-cached,
// and they carry uri + cid), falling back to a time-boxed live PDS lookup for
// records too fresh to be in the latest snapshot. Everything is defensive: any
// failure returns null and the caller falls back to the section card, so a
// slow/broken PDS never blocks the page.

import { ME_DID, COLLECTIONS } from '../src/config.js';
import { resolvePds, getRecord, listRecords, rkeyFromAtUri } from '../src/lib/atproto.js';
import { workSlug, showOnCreating, showOnBlog, isDraft } from '../src/lib/publications.js';

const SNAPSHOT_TIMEOUT_MS = 2000;
const PDS_TIMEOUT_MS = 2500;

// Sections whose leaf pages render a single AT-Protocol record.
const RECORD_SECTIONS = new Set(['blogging', 'creating', 'curating']);

/** Resolve after `ms`, whichever comes first, so a hung fetch never blocks. */
function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSnapshot(origin, name) {
  if (!origin) return null;
  const json = await fetchJson(`${origin}/data/${name}.json`, SNAPSHOT_TIMEOUT_MS);
  return Array.isArray(json) ? json : null;
}

function endsWithRkey(uri, rkey) {
  if (!uri || !rkey) return false;
  const m = String(uri).match(/\/([^/]+)$/);
  return Boolean(m) && m[1] === rkey;
}

function collectionFromUri(uri) {
  const m = String(uri || '').match(/^at:\/\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}

/** True if `pathname` looks like a slug-addressed record route we can resolve. */
export function isRecordRoute(pathname) {
  const segs = (pathname || '').split('/').filter(Boolean);
  return segs.length === 2 && RECORD_SECTIONS.has(segs[0]);
}

// ── resolvers: snapshot-first, then a time-boxed live PDS fallback ───────────

// /blogging/:id — id is the rkey; standard docs first, then leaflets.
async function resolveBlog(origin, slug) {
  const blogs = await fetchSnapshot(origin, 'blogs');
  const std = Array.isArray(blogs)
    ? blogs.find((r) => endsWithRkey(r?.uri, slug) && !isDraft(r?.value) && showOnBlog(r?.value))
    : null;
  if (std) return std;
  const leaflets = await fetchSnapshot(origin, 'leaflets');
  const leaf = Array.isArray(leaflets) ? leaflets.find((r) => endsWithRkey(r?.uri, slug)) : null;
  if (leaf) return leaf;
  return withTimeout(liveByRkey(slug, [COLLECTIONS.blogging, COLLECTIONS.leaflet]), PDS_TIMEOUT_MS);
}

// /creating/:slug — slug is the doc's `path` (or an rkey); portfolio-homed
// standard docs first, then legacy is.dame.creating.work.
async function resolveWork(origin, slug) {
  const blogs = await fetchSnapshot(origin, 'blogs');
  const std = Array.isArray(blogs)
    ? blogs.find(
        (r) =>
          !isDraft(r?.value) &&
          showOnCreating(r?.value) &&
          (workSlug(r?.value) === slug || rkeyFromAtUri(r?.uri) === slug),
      )
    : null;
  if (std) return std;
  const works = await fetchSnapshot(origin, 'creations');
  const legacy = Array.isArray(works)
    ? works.find((r) => !isDraft(r?.value) && workSlug(r?.value) === slug)
    : null;
  if (legacy) return legacy;
  return withTimeout(liveWorkBySlug(slug), PDS_TIMEOUT_MS);
}

// /curating/:slug — slug is the channel rkey.
async function resolveChannel(origin, slug) {
  return withTimeout(liveByRkey(slug, [COLLECTIONS.arenaChannel]), PDS_TIMEOUT_MS);
}

async function liveByRkey(rkey, collections) {
  const pds = await resolvePds(ME_DID).catch(() => null);
  if (!pds) return null;
  for (const collection of collections) {
    const rec = await getRecord(pds, { repo: ME_DID, collection, rkey }).catch(() => null);
    if (rec?.value) return rec;
  }
  return null;
}

async function liveWorkBySlug(slug) {
  const pds = await resolvePds(ME_DID).catch(() => null);
  if (!pds) return null;
  const std = await listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.blogging, max: 200 }).catch(() => []);
  const byStd = std.find(
    (r) =>
      !isDraft(r?.value) &&
      showOnCreating(r?.value) &&
      (workSlug(r?.value) === slug || rkeyFromAtUri(r?.uri) === slug),
  );
  if (byStd) return byStd;
  const legacy = await listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 }).catch(() => []);
  return legacy.find((r) => !isDraft(r?.value) && workSlug(r?.value) === slug) || null;
}

function shapeMeta(record, section) {
  const v = (record && record.value) || {};
  const title = String(v.title || v.name || '').trim();
  if (!title) return null;
  const description = String(v.description || v.summary || v.subtitle || '').trim();
  const atUri = record.uri || null;
  const cid = record.cid || null;
  return { title, description, section, atUri, cid, nsid: collectionFromUri(atUri) };
}

/**
 * Resolve a record route to
 * `{ title, description, section, atUri, cid, nsid }`, or null if it's not a
 * record route or the record can't be resolved. `title` is the record's own
 * title; `description` is its summary/subtitle when present; `atUri`/`cid`
 * point at the canonical record; `nsid` is its collection.
 */
export async function recordMeta(pathname, origin) {
  const segs = (pathname || '').split('/').filter(Boolean);
  if (segs.length !== 2) return null;
  const [section, rawSlug] = segs;
  if (!RECORD_SECTIONS.has(section)) return null;

  let slug = rawSlug;
  try { slug = decodeURIComponent(rawSlug); } catch {}

  let record = null;
  try {
    if (section === 'blogging') record = await resolveBlog(origin, slug);
    else if (section === 'creating') record = await resolveWork(origin, slug);
    else if (section === 'curating') record = await resolveChannel(origin, slug);
  } catch {
    record = null;
  }
  return record ? shapeMeta(record, section) : null;
}
