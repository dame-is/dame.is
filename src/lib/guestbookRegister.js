// The guestbook as a register: numbered lines, dated in Dame's clock, and a
// draft that survives the OAuth hop. Pure helpers (plus a guarded
// sessionStorage pair), so the page, the sign sheet and the tests agree.

import { DAME_ZONE } from './recordPlate.js';

/** Where the sign sheet keeps a note while the signer is away at their PDS. */
export const DRAFT_KEY = 'dame.guestbook.draft';

/**
 * The public number of signatures on a page of the book (live or snapshot):
 * the backlink total less the ones the host hid and the ones the language
 * filter benched. Null when the page carries no total.
 */
export function publicCount(page) {
  if (!page || typeof page.total !== 'number') return null;
  return Math.max(0, page.total - (page.hiddenCount || 0) - (page.flaggedCount || 0));
}

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
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DAME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/**
 * Whether a sign-in input is worth a public profile lookup for the preview:
 * a bare handle ("alice.bsky.social", "@alice.bsky.social") or a DID, not a
 * PDS URL or a half-typed word.
 */
export function profileLookupKey(input) {
  const s = String(input || '').trim().replace(/^@/, '');
  if (/^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(s)) return s;
  if (/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(s) && !/^https?:/i.test(s)) {
    const tld = s.split('.').pop();
    return tld.length >= 2 ? s.toLowerCase() : null;
  }
  return null;
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
