// Edge-safe resolver for a top-level page surface's editable copy, sourced from
// the is.dame.page record the SPA itself renders. Lets the crawler-facing <head>
// description and the OG card subtitle track what's on the user's PDS instead of
// the static defaults in og/pages.js — so the social card is editable, not
// hardcoded.
//
// Resolution order (mirrors src/hooks/usePageContent.js + og/records.js):
//   1. the build/deploy snapshot at /data/pages.json  (the "latest deployment")
//   2. a time-boxed live is.dame.page getRecord         (records newer than the build)
//   3. null → caller keeps the static og/pages.js copy
//
// Everything is defensive: any miss/hiccup returns null so a slow or broken PDS
// never blocks the card. Plain fetch only, so it runs in the Edge runtime.

import { ME_DID, COLLECTIONS } from '../src/config.js';
import { resolvePds, getRecord } from '../src/lib/atproto.js';

const SNAPSHOT_TIMEOUT_MS = 2000;
const PDS_TIMEOUT_MS = 2500;

// Top-level routes whose OG copy is backed by an is.dame.page/<rkey> record.
// The URL and the record key can differ — /available is backed by the
// is.dame.page/resume record, and /welcoming by is.dame.page/guestbook. Add a
// route here to let it drive its own social copy from the PDS; unlisted routes
// keep their static og/pages.js copy.
const PAGE_RKEY_FOR_PATH = {
  '/available': 'resume',
  '/welcoming': 'guestbook',
};

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

const firstText = (...vals) => {
  for (const s of vals) {
    const t = String(s == null ? '' : s).trim();
    if (t) return t;
  }
  return '';
};

/** The is.dame.page record for a route's rkey: snapshot first, then a live PDS fallback. */
async function resolvePageRecord(origin, rkey) {
  // 1. Build snapshot — public/data/pages.json is a { [rkey]: record } map.
  if (origin) {
    const pages = await fetchJson(`${origin}/data/pages.json`, SNAPSHOT_TIMEOUT_MS);
    const rec = pages && typeof pages === 'object' ? pages[rkey] : null;
    if (rec?.value) return rec;
  }
  // 2. Live PDS — catches a record authored/edited since the last build.
  const live = await withTimeout(livePageRecord(rkey), PDS_TIMEOUT_MS);
  if (live?.value) return live;
  return null;
}

async function livePageRecord(rkey) {
  const pds = await resolvePds(ME_DID).catch(() => null);
  if (!pds) return null;
  return getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.page, rkey }).catch(() => null);
}

/**
 * Resolve a top-level page route to its PDS-backed OG copy, or null when the
 * route isn't page-backed or no record exists yet (→ caller keeps the static
 * og/pages.js defaults).
 *
 *   { title, desc }  — `desc` prefers a dedicated `description` on the record,
 *   else its `intro`; `title` is the record's own title. Empty strings when the
 *   record omits them.
 */
export async function pageContentMeta(pathname, origin) {
  const rkey = PAGE_RKEY_FOR_PATH[pathname];
  if (!rkey) return null;
  const rec = await resolvePageRecord(origin, rkey);
  const v = rec?.value || {};
  const desc = firstText(v.description, v.intro);
  const title = firstText(v.title);
  if (!desc && !title) return null;
  return { title, desc };
}
