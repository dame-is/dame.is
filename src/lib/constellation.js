// Tiny client for the Constellation backlinks service
// (https://constellation.microcosm.blue). All calls swallow network / 4xx /
// 5xx errors and return `null` so the UI can render "Unavailable" without
// wrapping every call site in try/catch.

const CONSTELLATION_BASE = 'https://constellation.microcosm.blue';

async function fetchJsonOrNull(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * All sources (collection + record path) that point at `target`, with
 * per-source counts and distinct linking DIDs. `target` can be an AT URI
 * (record) OR a bare DID (identity backlinks like follows / blocks).
 *
 * Shape (from the deprecated-but-still-supported `/links/all`):
 *   { links: { "app.bsky.feed.like": { "subject.uri": { count, distinct_dids } } } }
 */
export async function getBacklinkSources(target) {
  if (!target) return null;
  const url = `${CONSTELLATION_BASE}/links/all?target=${encodeURIComponent(target)}`;
  return fetchJsonOrNull(url);
}

/**
 * Inbound link count for a single (target, source-collection, source-path)
 * tuple. `source` is in `<collection>:<path>` form, e.g.
 * `app.bsky.feed.like:subject.uri`.
 */
export async function getBacklinkCount(target, source) {
  if (!target || !source) return null;
  const params = new URLSearchParams({ subject: target, source });
  const url = `${CONSTELLATION_BASE}/xrpc/blue.microcosm.links.getBacklinksCount?${params}`;
  return fetchJsonOrNull(url);
}

/**
 * Paginated backlinks for a (target, source) tuple. Returns the raw
 * response (`{ linking_records, cursor, ... }`) or `null`.
 */
export async function getBacklinks(target, source, { limit = 25, cursor } = {}) {
  if (!target || !source) return null;
  const params = new URLSearchParams({
    subject: target,
    source,
    limit: String(limit),
  });
  if (cursor) params.set('cursor', cursor);
  const url = `${CONSTELLATION_BASE}/xrpc/blue.microcosm.links.getBacklinks?${params}`;
  return fetchJsonOrNull(url);
}

/**
 * Flatten `getBacklinkSources` into a sorted array
 *   [{ collection, path, source, count, distinctDids }, ...]
 * sorted by count desc. Returns `null` if the underlying call failed.
 */
export function flattenSources(raw) {
  if (!raw) return null;
  const links = raw.links || raw; // tolerate both shapes
  const out = [];
  for (const [collection, paths] of Object.entries(links || {})) {
    if (!paths || typeof paths !== 'object') continue;
    for (const [path, info] of Object.entries(paths)) {
      const count = info?.records ?? info?.count ?? 0;
      const distinctDids = info?.distinct_dids ?? info?.distinctDids ?? null;
      out.push({
        collection,
        path,
        source: `${collection}:${path}`,
        count,
        distinctDids,
      });
    }
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}
