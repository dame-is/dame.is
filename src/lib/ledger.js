// Pure helpers behind the ledger's typesetting: the dates and clocks it prints
// beside a row's own time, and the reference lines and citations it sets other
// people's posts and links in. Nothing here renders; FeedLedgerRow,
// LedgerCite and DayOfLifeHeader do. Kept apart so the rules can be tested
// without a browser.
//
// Every day here is read through time.js (`calendarDay`, `dateKey`,
// `formatDateShort`) rather than a Date's own getters, so the ledger names the
// same day, on Dame's calendar, that its day headers and groups do.

import {
  calendarDay as timeCalendarDay,
  dateKey,
  formatDateShort,
  formatTime,
} from './time.js';
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

/** Two instants on the same calendar day, by the day key time.js groups on. */
export function sameDay(a, b) {
  if (!a || !b) return false;
  const da = dateKey(a);
  return Boolean(da) && da === dateKey(b);
}

/**
 * "Oct 26": the day `at` falls on, with the year only when it isn't `ref`'s
 * ("Oct 26, 2025"). The ledger's one absolute short date: a citation's own
 * date, a thread member from another day. '' for a bad date.
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

// The meridiem formatTime ends on, whatever spacing the locale puts before it
// ("1:27 AM", "1:27 a.m.", or with a narrow no-break space before it,
// which \s matches too). A 24-hour locale has none.
const MERIDIEM = /\s*[ap]\.?\s?m\.?$/i;
const meridiem = (s) => {
  const m = MERIDIEM.exec(s);
  return m ? { index: m.index, key: m[0].replace(/[\s.]/g, '').toLowerCase() } : null;
};

/**
 * `at`'s clock time, dropping the am/pm when it's the same as `ref`'s — a
 * time printed beside another reads "from 1:27" under "1:46 am", the way a
 * range is written. Keeps it when they differ, or when there's nothing to
 * compare against.
 */
export function clockBeside(at, ref = null) {
  const t = formatTime(at);
  if (!t || !ref) return t;
  const mine = meridiem(t);
  const theirs = meridiem(formatTime(ref));
  if (mine && theirs && mine.key === theirs.key) return t.slice(0, mine.index);
  return t;
}

/** A link's host without its "www.", or '' when it won't parse. */
export function hostOf(uri) {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A reference line's title without the "— dame.is" a page puts after its own
 * name: the host already leads the line, so the site would be named twice.
 * Only a suffix that IS the host goes; "Poe's Dispatch" stays.
 */
export function refTitle(title, host) {
  const t = (title || '').trim();
  if (!t || !host) return t;
  const suffix = new RegExp(`\\s*[\\u2014\\u2013|\\u00b7:-]\\s*(?:www\\.)?${escapeRe(host)}\\s*$`, 'i');
  return t.replace(suffix, '').trim() || t;
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
