// Faces for a set of accounts that keeps growing, asked for as they turn up.
//
// The Ratioed panels used to do this in an effect keyed on the rows: mark the
// new DIDs as asked, ask, and drop the answer if the effect ran again first.
// It runs again on every arrival and on every answer, so on a busy thread, and
// all through a replay catching up, the answer was dropped by the very next
// row, and its DIDs, already marked, were never asked for again. Those rows
// stayed a bare DID with no face for the rest of the piece, the artist's own
// reply among them. The participants board found the same thing and stopped
// cancelling; this is that, shared.
//
// So an answer is applied whenever it lands, until the asker is closed. And an
// account that comes back with nothing is asked again a few times, further
// apart each time: `resolveProfiles` swallows a failed request and returns
// what it has, so nothing back is as likely a dropped connection as a deleted
// account. After the last try it is left alone, so a deactivated account can't
// keep an asker going against the AppView for the rest of the piece.

import { resolveProfiles } from './atproto.js';

// How long a missed account waits before each further ask. Three more asks
// over about two and a half minutes, then it stays unresolved.
export const PROFILE_RETRY_MS = [5_000, 30_000, 120_000];

/**
 * An asker for profiles. `ask(dids)` asks for the ones it has not asked about
 * yet; `onFound(profiles)` receives each answer, keyed by DID; `close()` stops
 * it, pending retries included, and drops whatever lands after.
 */
export function createProfileAsker({
  onFound,
  resolve = resolveProfiles,
  retryMs = PROFILE_RETRY_MS,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  // Asked about: answered, in flight, or waiting out a retry.
  const asked = new Set();
  const misses = new Map(); // did → how many asks came back without it
  const timers = new Set();
  let closed = false;

  const retry = (dids, waitMs) => {
    const id = schedule(() => {
      timers.delete(id);
      for (const did of dids) asked.delete(did);
      ask(dids);
    }, waitMs);
    timers.add(id);
  };

  function ask(dids) {
    if (closed) return;
    const fresh = Array.from(new Set((dids || []).filter((d) => d && !asked.has(d))));
    if (!fresh.length) return;
    for (const did of fresh) asked.add(did);
    let pending;
    try {
      pending = Promise.resolve(resolve(fresh));
    } catch {
      pending = Promise.resolve({});
    }
    pending
      .catch(() => ({}))
      .then((found) => {
        if (closed) return;
        const got = found || {};
        if (Object.keys(got).length) onFound?.(got);
        // Grouped by how long each has to wait, so one miss is one timer.
        const later = new Map();
        for (const did of fresh) {
          if (got[did]) continue;
          const n = misses.get(did) || 0;
          if (n >= retryMs.length) continue;
          misses.set(did, n + 1);
          const wait = retryMs[n];
          later.set(wait, [...(later.get(wait) || []), did]);
        }
        for (const [wait, list] of later) retry(list, wait);
      });
  }

  return {
    ask,
    close() {
      closed = true;
      for (const id of timers) cancel(id);
      timers.clear();
    },
  };
}
