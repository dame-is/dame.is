// In-memory cache for live-feed surfaces. Survives SPA route changes
// (Home → About → Home) so revisiting a feed within the TTL renders
// instantly without a skeleton flash. Evaporates on hard reload —
// nothing is persisted to storage by design.
//
// Also exposes a tiny pub/sub for "is any feed currently refreshing"
// so the ChromeBar mark can pulse globally whenever the site is
// fetching live data.

const cache = new Map();

export function readFeedCache(name) {
  return cache.get(name) || null;
}

export function writeFeedCache(name, payload) {
  cache.set(name, payload);
}

export function isCacheFresh(name, ttlMs) {
  const entry = cache.get(name);
  if (!entry || typeof entry.fetchedAt !== 'number') return false;
  return Date.now() - entry.fetchedAt < ttlMs;
}

// --- Live-refresh status ----------------------------------------------

let activeRefreshes = 0;
const listeners = new Set();

function notify() {
  const value = activeRefreshes > 0;
  for (const listener of listeners) listener(value);
}

export function beginRefresh() {
  activeRefreshes += 1;
  if (activeRefreshes === 1) notify();
}

export function endRefresh() {
  if (activeRefreshes === 0) return;
  activeRefreshes -= 1;
  if (activeRefreshes === 0) notify();
}

export function isRefreshing() {
  return activeRefreshes > 0;
}

export function subscribeRefresh(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
