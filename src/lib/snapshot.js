// Hybrid data model: synchronous JSON snapshot for first paint,
// `useEffect` live refresh, merge by AT URI / id.

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
  return Array.from(seen.values()).sort((a, b) => {
    const ax = pickCreatedAt(a);
    const bx = pickCreatedAt(b);
    if (!ax && !bx) return 0;
    if (!ax) return 1;
    if (!bx) return -1;
    return ax < bx ? 1 : -1;
  });
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
    const res = await fetch(`/data/${name}.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
