// A lazy page whose code can't be fetched (App.jsx `page()`).
//
// Almost always this is a tab that has outlived a deploy: each deploy
// content-hashes its chunks and deletes the last one's, so a page this tab
// hasn't loaded yet now names a file that is gone. The request either fails
// outright or comes back as api/asset-recovery's stub, a valid module with no
// default export that reloads the page itself. Either way the only cure is
// the current build, so the page asks for one reload onto it.
//
// React.lazy keeps a failed load for the rest of the document's life, so
// without the reload the page stays broken until the reader reloads by hand.
// A reload that lands back on the same build can't help (a deploy that is
// itself missing the chunk), so the guard is the build the tab reloaded FROM:
// once per build, and a reload that arrives on that same build gives up and
// lets the error show. Like the auto-updater's guard (autoUpdate.js), it has
// to survive the reload it limits, so storage that forgets on reload means no
// reload at all.

import { BUILD_ID } from './appVersion.js';
import { isStorageVolatile } from './storageGuard.js';

export const CHUNK_RELOAD_KEY = 'dame.chunkReloadFrom';

// Windows already on their way out, so a second failure in the same moment
// (two chunks, or a retry) waits for that reload instead of giving up.
const reloading = new WeakSet();

function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reload onto the current build after a page chunk failed to load, at most
 * once per build. Returns true when a reload is on its way (the caller can
 * wait for it), false when it gave up and the failure should surface.
 *
 * The URL carries the "_r" cache-bust param that index.html's boot recovery
 * and api/asset-recovery.js share: it fetches a fresh shell past any cache,
 * stops those two from reloading again if that shell is still broken, and
 * main.jsx strips it once the new build boots.
 */
export function recoverFromChunkError({
  win = typeof window === 'undefined' ? null : window,
  storage = sessionStore(),
  volatile = isStorageVolatile('sessionStorage'),
  buildId = BUILD_ID,
} = {}) {
  if (!win) return false;
  if (reloading.has(win)) return true;
  if (!storage || volatile) return false;
  try {
    if (storage.getItem(CHUNK_RELOAD_KEY) === buildId) return false;
    storage.setItem(CHUNK_RELOAD_KEY, buildId);
    const url = new URL(win.location.href);
    url.searchParams.set('_r', Date.now().toString(36));
    reloading.add(win);
    win.location.replace(url.toString());
    return true;
  } catch {
    return false;
  }
}
