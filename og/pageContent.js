// Edge-safe resolver for a top-level page surface's editable copy, sourced from
// the PDS record the SPA itself renders. Lets the crawler-facing <head>
// description and the OG card subtitle track what's on the user's PDS instead of
// the static defaults in og/pages.js — so every social card is editable, not
// hardcoded.
//
// Resolution order (mirrors src/hooks/usePageContent.js + og/records.js):
//   1. the build/deploy snapshot under /data/*.json  (the "latest deployment")
//   2. a time-boxed live getRecord                    (records newer than the build)
//   3. null → caller keeps the static og/pages.js copy
//
// Everything is defensive: any miss/hiccup returns null so a slow or broken PDS
// never blocks the card. Plain fetch only, so it runs in the Edge runtime.

import { ME_DID, COLLECTIONS } from '../src/config.js';
import { resolvePds, getRecord } from '../src/lib/atproto.js';

const SNAPSHOT_TIMEOUT_MS = 2000;
const PDS_TIMEOUT_MS = 2500;

// Which PDS record backs each routed top-level surface's OG copy. Every content
// page reads from an is.dame.page/<rkey> record, and by DEFAULT the rkey is the
// path segment (/blogging → is.dame.page/blogging), so pages are covered without
// listing them one by one. Only the exceptions need an entry below:
//   • URL and record key differ — /available is is.dame.page/resume,
//     /welcoming is is.dame.page/guestbook;
//   • the record lives in another collection — /themself is is.dame.profile/self.
// `fields` are the record-value keys tried in order for the description; the
// page default (`description` then `intro`) matches the fields the SPA renders
// via usePageContent, and the profile uses its own `tagline`. A route that
// resolves to no record — or a record missing those fields — keeps the static
// og/pages.js copy.
const DEFAULT_FIELDS = ['description', 'intro'];
const SOURCE_OVERRIDES = {
  '/available': { collection: COLLECTIONS.page, rkey: 'resume' },
  '/welcoming': { collection: COLLECTIONS.page, rkey: 'guestbook' },
  '/themself': { collection: COLLECTIONS.profile, rkey: 'self', fields: ['tagline'] },
};

/**
 * The PDS record source backing a route's OG copy, or null when the route has
 * no backing record — the home index and any nested/dynamic route (those carry
 * their own cards, resolved in og/records.js).
 *
 *   { collection, rkey, fields }
 */
function sourceForPath(pathname) {
  const override = SOURCE_OVERRIDES[pathname];
  if (override) return { fields: DEFAULT_FIELDS, ...override };
  // Default: a single-segment route maps 1:1 to is.dame.page/<segment>.
  const seg = String(pathname || '').replace(/^\/+|\/+$/g, '');
  if (!seg || seg.includes('/')) return null;
  return { collection: COLLECTIONS.page, rkey: seg, fields: DEFAULT_FIELDS };
}

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

/**
 * The build snapshot for a source, or null. The is.dame.page snapshot is a
 * { [rkey]: record } map at /data/pages.json; the extended profile is a single
 * record at /data/extendedProfile.json. Both carry the { uri, cid, value } shape.
 */
async function snapshotRecord(origin, source) {
  if (!origin) return null;
  if (source.collection === COLLECTIONS.profile) {
    const rec = await fetchJson(`${origin}/data/extendedProfile.json`, SNAPSHOT_TIMEOUT_MS);
    return rec?.value ? rec : null;
  }
  const pages = await fetchJson(`${origin}/data/pages.json`, SNAPSHOT_TIMEOUT_MS);
  const rec = pages && typeof pages === 'object' ? pages[source.rkey] : null;
  return rec?.value ? rec : null;
}

/** The record for a source: build snapshot first, then a live PDS fallback for
 *  records authored/edited since the last build. */
async function resolveRecord(origin, source) {
  const snap = await snapshotRecord(origin, source);
  if (snap?.value) return snap;
  const live = await withTimeout(liveRecord(source), PDS_TIMEOUT_MS);
  if (live?.value) return live;
  return null;
}

async function liveRecord(source) {
  const pds = await resolvePds(ME_DID).catch(() => null);
  if (!pds) return null;
  return getRecord(pds, {
    repo: ME_DID,
    collection: source.collection,
    rkey: source.rkey,
  }).catch(() => null);
}

/**
 * Resolve a top-level page route to its PDS-backed OG copy, or null when the
 * route has no backing record / no copy yet (→ caller keeps the static
 * og/pages.js defaults).
 *
 *   { title, desc }  — `desc` is the record's first non-empty copy field (a
 *   dedicated `description`, else `intro` for pages / `tagline` for the profile);
 *   `title` is the record's own title when it has one. Empty strings otherwise.
 */
export async function pageContentMeta(pathname, origin) {
  const source = sourceForPath(pathname);
  if (!source) return null;
  const rec = await resolveRecord(origin, source);
  const v = rec?.value || {};
  const desc = firstText(...source.fields.map((f) => v[f]));
  const title = firstText(v.title);
  if (!desc && !title) return null;
  return { title, desc };
}
