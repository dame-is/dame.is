// Hybrid data model: synchronous JSON snapshot for first paint,
// `useEffect` live refresh, merge by AT URI / id.

import { compareIsoDesc } from './time.js';

/**
 * Merge `live` items into `seed`, preferring fresh records and keeping
 * the time order (newest first by `createdAt`). De-dupes by `keyFn`.
 */
export function mergeByKey(seed, live, keyFn) {
  const seen = new Map();
  for (const item of live || []) {
    const key = keyFn(item);
    if (key) seen.set(key, item);
  }
  for (const item of seed || []) {
    const key = keyFn(item);
    if (key && !seen.has(key)) seen.set(key, item);
  }
  return Array.from(seen.values()).sort((a, b) =>
    compareIsoDesc(pickCreatedAt(a), pickCreatedAt(b)),
  );
}

function pickCreatedAt(item) {
  return (
    item?.createdAt ||
    item?.value?.createdAt ||
    item?.indexedAt ||
    item?.post?.indexedAt ||
    item?.payload?.createdAt ||
    null
  );
}

/**
 * Try to fetch a JSON snapshot from `/data/<name>.json`.
 * Returns `null` on miss so callers can fall back to their seed import.
 */
export async function fetchSnapshot(name) {
  try {
    // No `cache: 'no-store'` — the snapshots are static per deploy and carry
    // an ETag, so letting the browser HTTP cache handle them means repeat
    // loads (and route revisits) 304-revalidate instead of re-downloading
    // the full JSON.
    const res = await fetch(`/data/${name}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
