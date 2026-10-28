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

// Reads in flight or recently settled, by name. A page asks for the same file
// from several places at once — a record route's head tags, its timestamp
// footer, its x-ray layer and the page itself each read their record out of
// pages.json or blogs.json in their own right — and every ask was a request
// and a full parse of its own: blogs.json eight times over on one blog post.
// Sharing the read means the callers share one parsed object, so it is never
// theirs to mutate.
//
// A settled read is kept for a few minutes, not for the session: the files are
// static per deploy (a new deploy reloads the page; see useAutoUpdate), but
// some are megabytes, and a long visit through the curating galleries would
// otherwise hold every one it opened. A miss isn't kept at all, so the next
// caller tries again.
const SNAPSHOT_KEEP_MS = 5 * 60_000;
const reads = new Map(); // name -> { promise, settledAt }

function sweep(now) {
  for (const [name, read] of reads) {
    if (read.settledAt && now - read.settledAt > SNAPSHOT_KEEP_MS) {
      reads.delete(name);
    }
  }
}

/**
 * Try to fetch a JSON snapshot from `/data/<name>.json`.
 * Returns `null` on miss so callers can fall back to their seed import.
 * Concurrent and repeat calls for one name share a single read (see above).
 */
export function fetchSnapshot(name) {
  sweep(Date.now());
  const held = reads.get(name);
  if (held) return held.promise;
  const read = { promise: readSnapshot(name), settledAt: 0 };
  reads.set(name, read);
  read.promise.then((value) => {
    if (reads.get(name) !== read) return;
    if (value == null) reads.delete(name);
    else read.settledAt = Date.now();
  });
  return read.promise;
}

// How long a read waits for its response to begin before it's given up as a
// miss. Only the wait for the headers is bounded, never the body: a snapshot
// several megabytes long on a slow link gets all the time it needs to arrive.
// What this catches is a request that never answers at all, which, now that
// every caller of a name shares one read, would otherwise leave all of them
// waiting on it for the rest of the visit. A miss isn't kept, so the next
// caller asks again.
const SNAPSHOT_RESPONSE_MS = 20_000;

async function readSnapshot(name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SNAPSHOT_RESPONSE_MS);
  try {
    // No `cache: 'no-store'` — the snapshots are static per deploy and carry
    // an ETag, so letting the browser HTTP cache handle them means repeat
    // loads (and route revisits) 304-revalidate instead of re-downloading
    // the full JSON. (And nothing that would stop the request matching the
    // home snapshot's <link rel=preload>, which middleware.js adds on /.)
    const res = await fetch(`/data/${name}.json`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The newest record the atmosphere bar paints from: `name` is 'now',
 * 'listening' or 'state'. Read from chrome.json, which the build writes with
 * just those three records, so a page load doesn't download and parse three
 * snapshots of several hundred KB for one record apiece. Falls back to the
 * full file when there's no chrome.json (a deploy, or a local prefetch, from
 * before it existed). Null when neither has a record.
 */
export async function fetchChromeSeed(name) {
  const chrome = await fetchSnapshot('chrome');
  if (chrome && typeof chrome === 'object' && name in chrome) {
    return chrome[name] || null;
  }
  const full = await fetchSnapshot(name);
  return Array.isArray(full) ? full[0] || null : null;
}
