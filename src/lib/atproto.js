// Tiny isomorphic AT Protocol client. No SDK — just fetch + JSON.

import { APPVIEW, PLC_DIRECTORY } from '../config.js';

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url} :: ${text.slice(0, 200)}`);
    err.status = res.status;
    err.url = url;
    throw err;
  }
  return res.json();
}

/**
 * Resolve a DID's PDS endpoint via the PLC directory.
 * Returns a URL string with no trailing slash.
 */
export async function resolvePds(did) {
  const doc = await getPlcDocument(did);
  const services = doc?.service || [];
  // Atproto PDS service id can be `#atproto_pds`.
  const pds =
    services.find((s) => s.id === '#atproto_pds')?.serviceEndpoint ||
    services[0]?.serviceEndpoint;
  if (!pds) throw new Error(`No PDS endpoint for ${did}`);
  return pds.replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// PLC directory — 30s in-memory cache so tab-switching on the explorer doesn't
// hammer plc.directory.

const PLC_DOC_TTL = 30_000;
const _plcDocCache = new Map(); // did -> { doc, ts }
const _plcAuditCache = new Map(); // did -> { log, ts }

/**
 * Fetch the DID document from the PLC directory. `did:plc:*` only — other
 * DID methods (`did:web:*`) will throw.
 */
export async function getPlcDocument(did) {
  if (!did) throw new Error('getPlcDocument: missing did');
  const cached = _plcDocCache.get(did);
  if (cached && Date.now() - cached.ts < PLC_DOC_TTL) return cached.doc;
  const doc = await fetchJson(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
  _plcDocCache.set(did, { doc, ts: Date.now() });
  return doc;
}

/**
 * Fetch the PLC audit log for a `did:plc:*`. Returns an array of operations
 * (oldest → newest).
 */
export async function getPlcAuditLog(did) {
  if (!did) throw new Error('getPlcAuditLog: missing did');
  const cached = _plcAuditCache.get(did);
  if (cached && Date.now() - cached.ts < PLC_DOC_TTL) return cached.log;
  const log = await fetchJson(`${PLC_DIRECTORY}/${encodeURIComponent(did)}/log/audit`);
  _plcAuditCache.set(did, { log, ts: Date.now() });
  return log;
}

/**
 * AppView — `com.atproto.identity.resolveHandle`. Falls back to bsky.social
 * if the appview can't resolve the handle.
 */
export async function resolveHandle(handle) {
  const qs = `handle=${encodeURIComponent(handle)}`;
  try {
    const res = await fetchJson(`${APPVIEW}/xrpc/com.atproto.identity.resolveHandle?${qs}`);
    if (res?.did) return res.did;
  } catch {
    // fall through
  }
  const res = await fetchJson(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?${qs}`);
  return res?.did || null;
}

/**
 * Normalize a user-supplied identifier (handle, DID, or PDS URL) into
 * `{ did, handle, pds }`. Throws on failure.
 *
 *   - DID input: `resolvePds` + `describeRepo` for the canonical handle.
 *   - Handle input: `resolveHandle` first, then DID flow.
 */
export async function resolveIdentifier(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw new Error('resolveIdentifier: empty input');

  let did = null;
  if (trimmed.startsWith('did:')) {
    did = trimmed;
  } else {
    did = await resolveHandle(trimmed);
    if (!did) throw new Error(`Could not resolve handle ${trimmed}`);
  }

  const pds = await resolvePds(did);
  let handle = null;
  try {
    const desc = await describeRepo(pds, did);
    handle = desc?.handle || null;
  } catch {
    // describeRepo failures are non-fatal; the caller can still browse by DID.
  }
  return { did, handle, pds };
}

/**
 * PDS — `com.atproto.repo.describeRepo`. Returns
 * `{ handle, did, didDoc, collections, handleIsCorrect }`.
 */
export async function describeRepo(pds, repo) {
  const params = new URLSearchParams({ repo });
  return fetchJson(`${pds}/xrpc/com.atproto.repo.describeRepo?${params}`);
}

/**
 * PDS — `com.atproto.repo.listRecords` (single page). Returns
 * `{ records, cursor }`. Use this when the caller wants to control
 * pagination (e.g. the explorer's "Load more" button); the higher-level
 * `listRecords` below auto-paginates and is dangerous for huge collections.
 */
export async function listRecordsPage(
  pds,
  { repo, collection, limit = 50, cursor, reverse = false } = {},
) {
  const params = new URLSearchParams({ repo, collection, limit: String(limit) });
  if (reverse) params.set('reverse', 'true');
  if (cursor) params.set('cursor', cursor);
  return fetchJson(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`);
}

/**
 * AppView — `app.bsky.actor.getProfile`.
 */
export async function getProfile(actor, { appview = APPVIEW, cache } = {}) {
  const url = `${appview}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
  // `cache: 'no-store'` lets callers that need a *current* value (e.g. the
  // hourly-changing avatar) bypass the browser HTTP cache.
  return fetchJson(url, cache ? { cache } : undefined);
}

/**
 * AppView — `app.bsky.feed.getPostThread`. Returns a thread view (parent
 * chain + replies) anchored at the given AT URI.
 */
export async function getPostThread(uri, { appview = APPVIEW, depth = 0, parentHeight = 6 } = {}) {
  const params = new URLSearchParams({
    uri,
    depth: String(depth),
    parentHeight: String(parentHeight),
  });
  return fetchJson(`${appview}/xrpc/app.bsky.feed.getPostThread?${params}`);
}

/**
 * AppView — `app.bsky.feed.getAuthorFeed`. Auto-paginates up to `max` items.
 */
export async function getAuthorFeed(actor, { appview = APPVIEW, limit = 100, max = 200 } = {}) {
  const items = [];
  let cursor = null;
  while (items.length < max) {
    const params = new URLSearchParams({ actor, limit: String(Math.min(limit, max - items.length)) });
    if (cursor) params.set('cursor', cursor);
    const res = await fetchJson(`${appview}/xrpc/app.bsky.feed.getAuthorFeed?${params}`);
    const batch = res?.feed || [];
    items.push(...batch);
    if (!res.cursor || batch.length === 0) break;
    cursor = res.cursor;
  }
  return items;
}

/**
 * PDS — `com.atproto.repo.listRecords`. Auto-paginates up to `max` records.
 * Returns the raw `records` array (each `{uri, cid, value}`).
 */
export async function listRecords(pds, { repo, collection, limit = 100, max = 500, reverse = false } = {}) {
  const records = [];
  let cursor = null;
  while (records.length < max) {
    const params = new URLSearchParams({
      repo,
      collection,
      limit: String(Math.min(limit, max - records.length)),
    });
    if (reverse) params.set('reverse', 'true');
    if (cursor) params.set('cursor', cursor);
    const res = await fetchJson(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`);
    const batch = res?.records || [];
    records.push(...batch);
    if (!res.cursor || batch.length === 0) break;
    cursor = res.cursor;
  }
  return records;
}

/**
 * PDS — `com.atproto.repo.getRecord`.
 */
export async function getRecord(pds, { repo, collection, rkey }) {
  const params = new URLSearchParams({ repo, collection, rkey });
  return fetchJson(`${pds}/xrpc/com.atproto.repo.getRecord?${params}`);
}

/**
 * Build an `at://` URI from parts.
 */
export function toAtUri({ did, collection, rkey }) {
  return `at://${did}/${collection}/${rkey}`;
}

/**
 * Extract the rkey from an `at://did/collection/rkey` URI.
 */
export function rkeyFromAtUri(atUri) {
  if (!atUri) return null;
  const m = String(atUri).match(/^at:\/\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * Convert an `at://` URI (or a bare DID) into the corresponding
 * `/exploring/...` SPA path. Returns `null` for empty/unparseable input.
 *
 *   at://did:plc:abc/app.bsky.feed.post/xyz  → /exploring/did:plc:abc/app.bsky.feed.post/xyz
 *   at://did:plc:abc/app.bsky.feed.post      → /exploring/did:plc:abc/app.bsky.feed.post
 *   at://did:plc:abc                         → /exploring/did:plc:abc
 *   did:plc:abc                              → /exploring/did:plc:abc
 */
export function explorerPathFromAtUri(input) {
  if (!input) return null;
  const s = String(input);
  if (s.startsWith('did:')) return `/exploring/${s}`;
  const m = s.match(/^at:\/\/([^/]+)(?:\/([^/?#]+)(?:\/([^/?#]+))?)?/);
  if (!m) return null;
  const [, repo, collection, rkey] = m;
  if (rkey) return `/exploring/${repo}/${collection}/${encodeURIComponent(rkey)}`;
  if (collection) return `/exploring/${repo}/${collection}`;
  return `/exploring/${repo}`;
}

const ATURI_BASE = 'https://aturi.to';

/**
 * Parse an `at://repo/collection/rkey` URI (or bare DID) into its parts.
 * Returns `null` for empty/unparseable input.
 */
function atUriParts(input) {
  if (!input) return null;
  const s = String(input);
  if (s.startsWith('did:')) return { repo: s, collection: null, rkey: null };
  const m = s.match(/^at:\/\/([^/]+)(?:\/([^/?#]+)(?:\/([^/?#]+))?)?/);
  if (!m) return null;
  return { repo: m[1], collection: m[2] || null, rkey: m[3] || null };
}

/**
 * Build the aturi.to universal-link page URL for a record — the friendly
 * "open this in the client of your choice" landing page. Mirrors aturi.to's
 * own canonical `/profile/…` form, including its `post` / `lists` aliases.
 *
 *   at://did/app.bsky.feed.post/xyz   → https://aturi.to/profile/did/post/xyz
 *   at://did/app.bsky.graph.list/xyz  → https://aturi.to/profile/did/lists/xyz
 *   at://did/is.dame.blog/xyz         → https://aturi.to/profile/did/is.dame.blog/xyz
 *   at://did                          → https://aturi.to/profile/did
 */
export function aturiUniversalUrl(input) {
  const parts = atUriParts(input);
  if (!parts) return null;
  const { repo, collection, rkey } = parts;
  if (collection && rkey) {
    const tail =
      collection === 'app.bsky.feed.post'
        ? `post/${encodeURIComponent(rkey)}`
        : collection === 'app.bsky.graph.list'
          ? `lists/${encodeURIComponent(rkey)}`
          : `${collection}/${encodeURIComponent(rkey)}`;
    return `${ATURI_BASE}/profile/${repo}/${tail}`;
  }
  return `${ATURI_BASE}/profile/${repo}`;
}

/**
 * Build the aturi.to Atmosphere Explorer URL for a record / collection /
 * repo — the raw-data inspector view.
 *
 *   at://did/app.bsky.feed.post/xyz  → https://aturi.to/explore/did/app.bsky.feed.post/xyz
 *   at://did/app.bsky.feed.post      → https://aturi.to/explore/did/app.bsky.feed.post
 *   at://did                         → https://aturi.to/explore/did
 */
export function aturiExplorerUrl(input) {
  const parts = atUriParts(input);
  if (!parts) return null;
  const { repo, collection, rkey } = parts;
  if (collection && rkey) return `${ATURI_BASE}/explore/${repo}/${collection}/${encodeURIComponent(rkey)}`;
  if (collection) return `${ATURI_BASE}/explore/${repo}/${collection}`;
  return `${ATURI_BASE}/explore/${repo}`;
}
