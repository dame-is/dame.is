// Pure helpers behind the ledger's typesetting: the days it names in its
// margins and headers, where its labels link, the link a post's text needn't
// repeat, and the year a year-only work is dated by. Nothing here renders;
// FeedLedgerRow and DayOfLifeHeader do. Kept apart so the rules can be tested
// without a browser.
//
// Every day here is read through time.js (`calendarDay`, `formatDateShort`) rather than a Date's own getters, so the ledger names the
// same day, on Dame's calendar, that its day headers and groups do.

import { calendarDay as timeCalendarDay, formatDateShort } from './time.js';
import { indexPathForVerb } from './recordPlate.js';

/**
 * Where a ledger label goes: the verb's own section (/posting, /mothing, the
 * generated /reposting, …). Replies have no page of their own, so they open
 * the home ledger filtered to them; a verb with no page here (flushing, which
 * lives on flushes.app) is null, and isn't a link.
 */
export function sectionHref(label) {
  if (label === 'replying') return '/?verbs=replying';
  return indexPathForVerb(label);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The calendar day an instant falls on, as `{ y, m, d, weekday }` (m 0-based),
 * or null: time.js's day on Dame's calendar, plus the weekday of that date
 * (a property of the date, not of the instant).
 */
export function calendarDay(at) {
  const p = timeCalendarDay(at);
  if (!p) return null;
  return { ...p, weekday: WEEKDAYS[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()] };
}

/**
 * "Oct 26": the day `at` falls on, with the year only when it isn't `ref`'s
 * ("Oct 26, 2025"). The ledger's one absolute short date: a day header's
 * short form. '' for a bad date.
 */
export function shortDay(at, ref = new Date()) {
  const s = formatDateShort(at);
  if (!s) return '';
  return formatDateShort(ref).slice(-4) === s.slice(-4) ? s.slice(0, -6) : s;
}

/**
 * "Sunday, October 25", the year added when it isn't `ref`'s. For the day
 * after `at` with `{ next: true }`: the first whole day past an instant.
 */
export function longDay(at, ref = new Date(), { next = false } = {}) {
  const p = calendarDay(at);
  if (!p) return '';
  const day = new Date(Date.UTC(p.y, p.m, p.d + (next ? 1 : 0)));
  const y = day.getUTCFullYear();
  const refDay = calendarDay(ref);
  const base = `${WEEKDAYS[day.getUTCDay()]}, ${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`;
  return refDay && refDay.y === y ? base : `${base}, ${y}`;
}

const urlish = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');

/**
 * A post's text without the link its card already shows. Bluesky stores a
 * pasted link as its shortened display ("dame.is/curating/ran..."), so a
 * link-only post's text is that stub, printed above a card for the same page.
 * The text's last word goes when, with the scheme, "www." and the "..." taken
 * off, it's the start of the card's address (and is a path, or the whole
 * address, so a bare "dame.is" said in passing survives a link to a page on
 * it). Returns '' for a post that was only the link; the text unchanged
 * otherwise. Facets past the cut stop resolving on their own (renderPostText
 * skips one that runs off the end).
 */
export function trimLinkEcho(text, uri) {
  if (typeof text !== 'string' || !text.trim() || !uri) return text;
  const target = urlish(uri);
  if (!target) return text;
  const m = /(\S+)\s*$/.exec(text);
  if (!m) return text;
  const token = urlish(m[1].replace(/(?:\.\.\.|…)$/, ''));
  if (token.length < 4 || !token.includes('.')) return text;
  if (!(token === target || (token.includes('/') && target.startsWith(token)))) return text;
  return text.slice(0, m.index).trimEnd();
}

/**
 * Whether a record's date is a year standing in for a date: works known only
 * by their year are stored at midnight UTC on January 1, and printing that as
 * "12:00 am" claims a precision nobody had.
 */
export function isYearOnlyDate(at) {
  const t = Date.parse(at);
  if (!Number.isFinite(t) || t % 86_400_000 !== 0) return false;
  const d = new Date(t);
  return d.getUTCMonth() === 0 && d.getUTCDate() === 1;
}

/** The year a year-only date stands for ("2011"), else ''. */
export function yearOf(at) {
  return isYearOnlyDate(at) ? String(new Date(Date.parse(at)).getUTCFullYear()) : '';
}
