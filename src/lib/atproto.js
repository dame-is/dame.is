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
  const doc = await fetchJson(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
  const services = doc?.service || [];
  // Atproto PDS service id can be `#atproto_pds`.
  const pds =
    services.find((s) => s.id === '#atproto_pds')?.serviceEndpoint ||
    services[0]?.serviceEndpoint;
  if (!pds) throw new Error(`No PDS endpoint for ${did}`);
  return pds.replace(/\/$/, '');
}

/**
 * AppView — `app.bsky.actor.getProfile`.
 */
export async function getProfile(actor, { appview = APPVIEW } = {}) {
  const url = `${appview}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
  return fetchJson(url);
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
