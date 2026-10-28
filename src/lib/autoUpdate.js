// The decisions behind the deploy auto-updater (src/hooks/useAutoUpdate.js):
// is now a safe moment to reload, and may we reload to this build at all.
// Kept apart from the hook so they can be tested without a browser — every
// browser object comes in as an argument.

// Remembers which build we last reloaded *to*. If a deploy's baked id and
// its version.json ever disagree we'd otherwise reload forever; keying on
// the target id means we reload at most once per distinct id.
export const RELOAD_TARGET_KEY = 'dame.update.reloadedTo';

export function readReloadTarget(storage) {
  try {
    return storage.getItem(RELOAD_TARGET_KEY);
  } catch {
    return null;
  }
}

export function writeReloadTarget(storage, id) {
  try {
    storage.setItem(RELOAD_TARGET_KEY, id);
  } catch {
    /* sessionStorage may be unavailable (private mode, etc.) */
  }
}

/**
 * Is the reader in the middle of something a reload would throw away?
 * Reads only the document, so it covers surfaces that keep their state to
 * themselves.
 */
export function documentIsBusy(doc) {
  const el = doc.activeElement;
  if (el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    // A focused embed is a video being watched — the lightbox's players and
    // the inline are.na ones are iframes.
    if (tag === 'IFRAME' || tag === 'VIDEO' || tag === 'AUDIO') return true;
  }
  // Media playing, focused or not.
  for (const media of doc.querySelectorAll('video, audio')) {
    if (!media.paused && !media.ended) return true;
  }
  // An open sheet, modal, lightbox or the dock. Every one of them declares
  // role="dialog" while it is open, and only then.
  if (doc.querySelector('[role="dialog"]')) return true;
  // Words typed and not yet sent, whether or not their field still has
  // focus: tapping a button elsewhere in the form moves it (and on iOS a
  // tapped button doesn't take focus at all, so it lands on <body>).
  // A read-only or disabled field shows text; nobody is writing in it.
  for (const field of doc.querySelectorAll('textarea')) {
    if (field.readOnly || field.disabled) continue;
    if (field.value.trim()) return true;
  }
  return false;
}

// How long a page that was told to reload can still be here before we take
// it that the reader answered a "Leave site?" prompt with Cancel. A slow
// reload can outlast it too; that only means a redundant `onStillHere`.
export const STILL_HERE_MS = 1500;

/**
 * Reload to apply `served` if it's safe and we haven't already tried it.
 * Returns true if a reload was triggered.
 *
 * `volatile` says the loop guard can't survive the reload (storage is
 * blocked and an in-memory stand-in is answering — see storageGuard.js).
 * Without the guard, a build whose baked id disagrees with its version.json
 * would reload on every poll, so we don't reload at all.
 *
 * The guard is written as the page actually unloads, not before asking it
 * to. A page with unsaved work can answer the reload with the browser's
 * "Leave site?" prompt; writing first meant a Cancel there had already
 * spent this build's one attempt, and the tab stayed stale for the rest of
 * the session. If the page is still here a moment later, `onStillHere`
 * lets the caller stop asking until the reader has moved on.
 */
export function attemptReload(
  served,
  { isSafe, win, storage, volatile, onStillHere },
) {
  if (!served) return false;
  if (volatile) return false;
  if (!isSafe()) return false; // defer: the reader is mid-something
  if (readReloadTarget(storage) === served) return false; // loop guard
  win.addEventListener('pagehide', () => writeReloadTarget(storage, served), {
    once: true,
  });
  win.location.reload();
  if (onStillHere) win.setTimeout(onStillHere, STILL_HERE_MS);
  return true;
}
