// Where each history entry was scrolled to, so Back lands where the reader
// left. The browser's own restoration can't do this for us (see
// RouteTransition.jsx for why it is switched off), so the app keeps the
// offsets itself: in memory for in-app traversals, mirrored to sessionStorage
// so a reload or a Back from another site can find them too.

const STORAGE_KEY = 'dame.scroll';

// Only recent entries are worth remembering; nobody presses Back sixty
// times. The cap keeps the sessionStorage blob a few kilobytes at most.
const LIMIT = 60;

/**
 * The identity of one history entry. React Router's `key` alone isn't
 * enough: the first entry of every document, and any entry a native
 * fragment link created, all share the key 'default', so the URL is folded
 * in to keep them apart.
 */
export function entryKey(location) {
  return `${location.key}|${location.pathname}${location.search}${location.hash}`;
}

/**
 * A bounded map of entry → scrollY, seeded from (and persisted to) the given
 * Storage. Every storage access fails soft: without storage the memory still
 * works for the life of the page.
 */
export function createScrollMemory(storage, { limit = LIMIT } = {}) {
  const positions = new Map();
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(parsed)) {
      for (const pair of parsed) {
        if (
          Array.isArray(pair) &&
          typeof pair[0] === 'string' &&
          Number.isFinite(pair[1])
        ) {
          positions.set(pair[0], pair[1]);
        }
      }
    }
  } catch {
    /* unreadable or corrupt — start empty */
  }
  return {
    get(key) {
      return positions.get(key);
    },
    set(key, y) {
      if (!key || !Number.isFinite(y)) return;
      // Re-insert so the Map's order is recency, and the oldest entry is the
      // one the cap drops.
      positions.delete(key);
      positions.set(key, Math.max(0, Math.round(y)));
      while (positions.size > limit) {
        positions.delete(positions.keys().next().value);
      }
    },
    persist() {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify([...positions]));
      } catch {
        /* quota or blocked — the in-memory copy still serves this page */
      }
    },
  };
}

/**
 * One attempt at restoring `target`: how far the document can scroll right
 * now, and whether that is far enough. Pages that render their content
 * asynchronously (or reveal it as the reader nears the bottom) are too short
 * at first, so the caller scrolls as far as it can and tries again as they
 * grow — which is also what nudges an infinite list into revealing more.
 */
export function restoreStep(target, scrollHeight, viewportHeight) {
  const max = Math.max(0, scrollHeight - viewportHeight);
  return { y: Math.min(target, max), done: max >= target };
}
