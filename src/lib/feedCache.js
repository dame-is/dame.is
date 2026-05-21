// In-memory cache for live-feed surfaces. Survives SPA route changes
// (Home → About → Home) so revisiting a feed within the TTL renders
// instantly without a skeleton flash. Evaporates on hard reload —
// nothing is persisted to storage by design.

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
