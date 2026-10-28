import { useEffect, useSyncExternalStore } from 'react';
import { fetchSnapshot } from '../lib/snapshot.js';
import { publicCount } from '../lib/guestbookRegister.js';

// The book's public signature count, shared between /welcoming (which knows
// it best, from the live read) and the sign sheet (which numbers the line
// you're about to leave, and can be opened from any page).
let known = null;
const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The page publishes its count here whenever it changes. */
export function setGuestbookCount(n) {
  if (typeof n !== 'number' || n === known) return;
  known = n;
  for (const listener of listeners) listener();
}

/**
 * The public count, or null while unknown. Opened away from /welcoming, it
 * seeds itself from the build-time snapshot (one cached request), which can
 * trail the live book by whatever was signed since the last build.
 */
export function useGuestbookCount() {
  const count = useSyncExternalStore(subscribe, () => known, () => known);
  useEffect(() => {
    if (known != null) return undefined;
    let cancelled = false;
    fetchSnapshot('guestbook').then((snap) => {
      if (cancelled || known != null) return;
      const n = publicCount(snap);
      if (n != null) setGuestbookCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
}
