// Tiny client for the Slingshot record edge-cache
// (https://slingshot.microcosm.blue). Slingshot serves
// `com.atproto.repo.getRecord` for ANY repo on the network, resolving the
// DID → PDS hop itself and caching hot records — which makes it the cheap
// way to hydrate a pile of backlinks that point at many different PDSes.
// Mirrors constellation.js: every call swallows errors and returns `null`
// so callers can fall back (e.g. to a direct PDS fetch) without try/catch.

const SLINGSHOT_BASE = 'https://slingshot.microcosm.blue';

/**
 * Fetch one record through the cache. Returns the usual getRecord shape
 * (`{ uri, cid, value }`) or `null` on any failure — including
 * RecordNotFound, so a `null` may mean "deleted since it was indexed".
 */
export async function getRecordCached({ repo, collection, rkey }) {
  if (!repo || !collection || !rkey) return null;
  const params = new URLSearchParams({ repo, collection, rkey });
  try {
    const res = await fetch(`${SLINGSHOT_BASE}/xrpc/com.atproto.repo.getRecord?${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
