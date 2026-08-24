// A shared "work in progress" signal between long-running jobs and the
// deploy auto-updater (useAutoUpdate.js).
//
// The auto-updater promises to "never interrupt work in progress", and until
// now its definition of work was UI-shaped: edit mode, an open sheet, a
// focused field. A multi-minute network sweep — the analytics archive build
// pages ~250 AppView requests — is none of those, so a deploy landing
// mid-build reloaded the page out from under it. This module is the third
// clause of that safety test: any job may hold a reload for as long as it
// runs, and the updater applies the pending deploy on a later poll once
// every hold is released.
//
// Deliberately dependency-free (both importers live in the entry bundle) and
// deliberately a counter of NAMED holds rather than a boolean: two
// overlapping jobs must not release each other, and a leaked hold should at
// least be identifiable in devtools.

const holds = new Set();

/**
 * Mark a long-running job as in progress. Returns the release function;
 * releasing twice is a no-op. ALWAYS release in a `finally` — a hold that
 * outlives its job pins the tab on a stale build until the next reload.
 *
 * @param {string} label  e.g. 'analytics-sync'
 * @returns {() => void}
 */
export function holdReload(label) {
  // A Symbol per call, so two concurrent holds under the same label are two
  // holds — the label is for humans, the identity is the token.
  const token = Symbol(label || 'work');
  holds.add(token);
  return () => holds.delete(token);
}

/** Is any job holding reloads right now? Read by the auto-updater's safety test. */
export function isReloadHeld() {
  return holds.size > 0;
}
