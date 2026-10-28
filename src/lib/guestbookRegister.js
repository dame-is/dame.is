// The guestbook as a register: numbered lines, dated in Dame's clock, and a
// draft that survives the OAuth hop. Pure helpers (plus guarded
// sessionStorage calls), so the page, the sign sheet and the tests agree.

import { formatDateShort } from './time.js';

/** Where the sign sheet keeps a note while the signer is away at their PDS. */
export const DRAFT_KEY = 'dame.guestbook.draft';

/**
 * Register numbers for the entries on screen, newest first: the newest public
 * signature is number `count`, the next `count - 1`, and so on. Hidden and
 * flagged entries (shown only while moderating) get no number and don't use
 * one up. Returns a Map of uri → number.
 *
 * The numbers come from the public count, so hiding a signature renumbers
 * every line above it; they describe the book as it stands, not a fixed
 * order of arrival.
 */
export function registerNumbers(entries, count) {
  const numbers = new Map();
  if (!Array.isArray(entries) || typeof count !== 'number') return numbers;
  let n = count;
  for (const entry of entries) {
    if (!entry?.uri || entry.hidden || entry.flagged) continue;
    if (n < 1) break;
    numbers.set(entry.uri, n);
    n -= 1;
  }
  return numbers;
}

/** "Sep 1, 2026" in Dame's clock, or '' for a missing or bad date. */
export function registerDate(iso) {
  return formatDateShort(iso);
}

function storage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Keep `{ text, location }` for the return from the PDS. */
export function saveDraft({ text = '', location = '' } = {}) {
  try {
    storage()?.setItem(DRAFT_KEY, JSON.stringify({ text, location }));
  } catch {
    // Storage blocked (a private window): the note just won't survive the hop.
  }
}

/** The saved draft, or null. */
export function readDraft() {
  try {
    const raw = storage()?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== 'object') return null;
    return { text: String(draft.text || ''), location: String(draft.location || '') };
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    // Nothing was stored, then.
  }
}
