// The site's one clock: every time, date and day it prints, read in one zone
// and written in one house style. Plain JS, no deps, no browser APIs — the
// edge middleware and the card renderer import it through og/time.js.
//
// The zone is Dame's, America/New_York, whatever the reader's. The sky, the
// hour chip, the avatar, the mothing nights and Ratioed were already on it,
// while the ledger's times, its Today/Yesterday buckets and the chrome's day
// count followed the reader's zone and long dates followed UTC — so one
// record page could date a status three ways, and a reader in Los Angeles saw
// a different day number from the share card. The records are kept by one
// person in one place, so they're dated on her calendar. <Time> offers the
// reader's own clock as a tooltip.
//
// House style:
//   long date   January 29, 2025       formatDateFull
//   short date  Jan 29, 2025           formatDateShort
//   clock       3:17 pm                formatTime; formatWallClockTime
//   relative    19h ago, 3d ago        relativeTime, under 30 days; then the short date
//   machine     2025-01-29             x-ray and raw data only (toIso, easternDate)

const MS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_629_800_000,
  y: 31_557_600_000,
};

/** Dame's clock. Named, not a fixed offset, so it follows EST/EDT. */
export const DAME_ZONE = 'America/New_York';

/**
 * Past this many calendar days a relative time ("3d ago") gives way to the
 * date. Beyond a month, "1y ago" erases the thing a reader wants (which
 * year?), and it was the bucket two rounding rules disagreed over: a blog
 * post read "1y ago" in its footer and "2 years ago" in its header.
 */
export const RELATIVE_DAYS = 30;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad2 = (n) => String(n).padStart(2, '0');

/* ---------- reading Dame's clock ---------- */

// Built on first use, not at import: the site's entry chunk imports this file
// (through og/time.js), and an Intl.DateTimeFormat costs far more to make than
// to use. One formatter, never one per call — `toLocaleTimeString` with
// options builds a fresh one each time, and when formatTime did that it was
// the heaviest app function in a scroll profile.
let zoneFormat = null;
const offsets = new Map();

/**
 * Dame's offset from UTC in ms at an instant (negative: New York is behind).
 *
 * Read from Intl once per UTC hour and remembered. An offset only ever
 * changes on the hour — New York's changes fall at 2am local, 06:00 or 07:00
 * UTC — so every instant in an hour shares one, and a feed of a few hundred
 * rows asks Intl a handful of times instead of a thousand.
 */
function zoneOffset(ms) {
  const hour = Math.floor(ms / MS.h) * MS.h;
  let off = offsets.get(hour);
  if (off !== undefined) return off;
  if (!zoneFormat) {
    zoneFormat = new Intl.DateTimeFormat('en-US', {
      timeZone: DAME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  }
  const p = {};
  for (const { type, value } of zoneFormat.formatToParts(new Date(hour))) p[type] = value;
  // Some engines still say "24" for midnight even under h23.
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  off = wall - hour;
  if (offsets.size > 4096) offsets.clear();
  offsets.set(hour, off);
  return off;
}

function toMs(date) {
  if (date == null || date === '') return NaN;
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
}

/**
 * An instant on Dame's clock: `{ y, m, d, hour, minute, weekday }` (m 0-based,
 * weekday 0 = Sunday), or null for a missing or unparseable date.
 */
export function easternParts(date) {
  const ms = toMs(date);
  if (!Number.isFinite(ms)) return null;
  const t = new Date(ms + zoneOffset(ms));
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth(),
    d: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    weekday: t.getUTCDay(),
  };
}

/** Current hour (0–23) on Dame's clock. `now` overridable for tests. */
export function easternHour(now = new Date()) {
  const p = easternParts(now);
  return p ? p.hour : NaN;
}

/** Today's date on Dame's clock as 'YYYY-MM-DD' ('' for a bad date). */
export function easternDate(now = new Date()) {
  const p = easternParts(now);
  return p ? dayKey(p) : '';
}

/**
 * The instant a wall-clock time on Dame's calendar names: `easternInstant(2026,
 * 9, 16, 22, 39)` is 10:39 pm on Oct 16 in New York, whoever asks. In the hour
 * a spring-forward skips, the time is read on the far side of it (2:30 am is
 * 3:30 am EDT); in the hour a fall-back repeats, the first of the two.
 */
export function easternInstant(y, m, d, hour = 0, minute = 0) {
  const wall = Date.UTC(y, m, d, hour, minute);
  // The offset at the wall clock read as if it were UTC is a few hours from
  // the real instant, and can be the wrong side of a change; a second read at
  // the first answer settles it, unless the time doesn't exist that day.
  const first = wall - zoneOffset(wall);
  const second = wall - zoneOffset(first);
  return new Date(second + zoneOffset(second) === wall ? second : first);
}

/* ---------- calendar days ---------- */

const BARE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
// An ISO string at exactly UTC midnight, written in Z: how a day gets stored
// when the field wants a timestamp. An offset string ("…T20:00:00-04:00") is a
// real time even when it lands on UTC midnight, and is read as one.
const UTC_MIDNIGHT = /^\d{4}-\d{2}-\d{2}T00:00(?::00(?:\.0+)?)?Z$/;

/**
 * The calendar day a date names, as `{ y, m, d }` (m 0-based), or null.
 *
 * An instant is read on Dame's clock, the one formatTime reads, so a date
 * printed beside a time names the day that time is on.
 *
 * A bare 'YYYY-MM-DD' is a day, not an instant, and is read as written (JS
 * parses it as UTC midnight, which is the evening before in New York). So is a
 * day stored as a UTC-midnight timestamp: the back-filled portfolio works
 * carry '2019-01-01T00:00:00.000Z' for a piece from 2019, and read as an
 * instant that's 7 pm on December 31, 2018. Both come as strings, the way a
 * record holds them; a Date is always a moment.
 */
export function calendarDay(date) {
  if (typeof date === 'string') {
    const bare = BARE_DAY.exec(date);
    if (bare) {
      const [y, m, d] = bare.slice(1).map(Number);
      // Refuse a day the calendar doesn't have, rather than rolling
      // '2026-02-30' over into March.
      if (new Date(Date.UTC(y, m - 1, d)).getUTCMonth() !== m - 1) return null;
      return { y, m: m - 1, d };
    }
    if (UTC_MIDNIGHT.test(date)) {
      const t = new Date(date);
      return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
    }
  }
  const p = easternParts(date);
  return p ? { y: p.y, m: p.m, d: p.d } : null;
}

/** 'YYYY-MM-DD' for a `{ y, m, d }`. */
function dayKey(p) {
  return `${String(p.y).padStart(4, '0')}-${pad2(p.m + 1)}-${pad2(p.d)}`;
}

/** The calendar day a date names, as 'YYYY-MM-DD' on Dame's calendar, or ''. */
export function dateKey(date) {
  const p = calendarDay(date);
  return p ? dayKey(p) : '';
}

/**
 * Whole calendar days from one `{ y, m, d }` to another. Counted with
 * Date.UTC, which has no DST and no zone history, so a 23- or 25-hour day is
 * still one day.
 */
export function calendarDaysBetween(a, b) {
  return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / MS.d);
}

/** Calendar days from `date`'s day to `now`'s, on Dame's calendar; null if unreadable. */
function daysAgo(date, now) {
  const a = calendarDay(date);
  const b = easternParts(now);
  return a && b ? calendarDaysBetween(a, b) : null;
}

/* ---------- relative time ---------- */

/**
 * "just now", "5m ago", "19h ago", "3d ago", "2w ago" — and past
 * RELATIVE_DAYS, the short date ("Jan 29, 2025").
 *
 * Minutes and hours are elapsed time. From a day on, the count is calendar
 * days on Dame's clock, the count `relativeDay` makes, so the two can sit on
 * one page and agree: a status from 11 pm two nights ago is "2d ago" here and
 * "2 days ago" there, not "1d ago" against "2 days ago".
 */
export function relativeTime(date, now = new Date()) {
  const t = toMs(date);
  if (!Number.isFinite(t)) return '';
  const delta = toMs(now) - t;
  if (delta < MS.m) return 'just now';
  if (delta < MS.h) return `${Math.floor(delta / MS.m)}m ago`;
  const days = daysAgo(date, now) ?? 0;
  // Hours while it's still the same day, too: a fall-back day has 25 of them,
  // and "1d ago" beside a header saying "Today" would be one fact told twice.
  if (delta < MS.d || days < 1) return `${Math.floor(delta / MS.h)}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < RELATIVE_DAYS) return `${Math.floor(days / 7)}w ago`;
  return formatDateShort(date);
}

/**
 * Is `date` inside the relative window — fewer than RELATIVE_DAYS calendar
 * days back? For a layout that sets a relative time beside the date, where
 * past the window the two would print the same date twice.
 */
export function isRecent(date, now = new Date()) {
  const days = daysAgo(date, now);
  return days !== null && days < RELATIVE_DAYS;
}

/**
 * Long-form relative phrasing counted in calendar days on Dame's clock:
 * "today", "yesterday", "3 days ago", "2 weeks ago" — same count and same
 * floor as `relativeTime` under RELATIVE_DAYS.
 *
 * Past that it keeps going in completed months and years ("5 months ago", "1
 * year ago"), for the one place that asks for it: a column labelled as elapsed
 * time, beside a column that already gives the date. Anywhere else, past a
 * month, print the date. Completed units, never rounded up: rounding put
 * "Elapsed 2 years ago" over a footer reading "written 1y ago".
 */
export function relativeDay(date, now = new Date()) {
  const days = daysAgo(date, now);
  if (days === null) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const span = days * MS.d;
  if (span < MS.mo) {
    const w = Math.floor(span / MS.w);
    return w === 1 ? '1 week ago' : `${w} weeks ago`;
  }
  if (span < MS.y) {
    const mo = Math.floor(span / MS.mo);
    return mo === 1 ? '1 month ago' : `${mo} months ago`;
  }
  const y = Math.floor(span / MS.y);
  return y === 1 ? '1 year ago' : `${y} years ago`;
}

/**
 * How recent a date is, for as long as that's news: "today", "yesterday",
 * then "2d ago" to "6d ago", and '' from a week on, when the date beside it
 * says it better. The same calendar-day count as `relativeDay` and
 * `relativeTime`, so a post that one calls "2d ago" this does too.
 */
export function recentDay(date, now = new Date()) {
  const days = daysAgo(date, now);
  if (days === null || days >= 7) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

/**
 * Compact elapsed phrasing for narrow columns: "today", "yesterday",
 * "3 days", "2 wks", "5 mo", "1 yr".
 *
 * Same buckets and rounding as `relativeDay` — it's the same fact set in a
 * shorter voice, so the two never disagree about which bucket a date is in.
 * "ago" is dropped: this form only appears under a label that already says
 * the column is elapsed time.
 */
export function relativeDayShort(date, now = new Date()) {
  const rel = relativeDay(date, now);
  if (!rel) return '';
  if (rel === 'today' || rel === 'yesterday') return rel;
  const [count, unit] = rel.split(' ');
  const short = { days: 'days', week: 'wk', weeks: 'wks', month: 'mo', months: 'mo', year: 'yr', years: 'yrs' };
  return `${count} ${short[unit] || unit}`;
}

/* ---------- day groups ---------- */

/**
 * Group items by the calendar day they fall on, on Dame's clock, using
 * `pickDate`. Her day, not the reader's or UTC's: a status she posts at 11 pm
 * belongs to that evening for everyone, and the day number in the group's
 * header (dayOfLife) is counted on the same calendar.
 *
 * Returns an array of `{ dateKey, date, items }` ordered by `dateKey desc`,
 * where `date` is the first item's date as `pickDate` gave it.
 */
export function groupByDay(items, pickDate = (i) => i.createdAt) {
  const buckets = new Map();
  for (const item of items) {
    const raw = pickDate(item);
    if (!raw) continue;
    const key = dateKey(raw);
    if (!key) continue;
    // `date` stays as picked, not a Date: a day stored as a UTC-midnight
    // string is only recognisable as one while it's a string.
    if (!buckets.has(key)) buckets.set(key, { dateKey: key, date: raw, items: [] });
    buckets.get(key).items.push(item);
  }
  return Array.from(buckets.values()).sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
}

/**
 * Header label for a day group: "Today, July 6, 2026", "3 days ago, July 3,
 * 2026" — and past RELATIVE_DAYS just the date, "May 12, 2025". Read on the
 * same calendar `groupByDay` buckets by, so the label names the bucket's day.
 */
export function formatDayLabel(date, now = new Date()) {
  const full = formatDateFull(date);
  if (!full) return '';
  const days = daysAgo(date, now);
  if (days === null || days >= RELATIVE_DAYS) return full;
  const rel = relativeDay(date, now);
  return `${rel.charAt(0).toUpperCase()}${rel.slice(1)}, ${full}`;
}

/**
 * Short header label for the ledger feed layout: "Today" / "Yesterday"
 * for the two most recent days, then just the date ("July 3, 2026") — the
 * condensed rows don't leave room for the long combined form that
 * `formatDayLabel` produces.
 */
export function formatDayShortLabel(date, now = new Date()) {
  const full = formatDateFull(date);
  if (!full) return '';
  const rel = relativeDay(date, now);
  if (rel === 'today') return 'Today';
  if (rel === 'yesterday') return 'Yesterday';
  return full;
}

/* ---------- dates ---------- */

/** "January 29, 2025": the long date. */
export function formatDateFull(date) {
  const p = calendarDay(date);
  if (!p) return '';
  return `${MONTHS[p.m]} ${p.d}, ${p.y}`;
}

/** "Jan 29, 2025": the short date, for a column or a band with no room to spell the month. */
export function formatDateShort(date) {
  const p = calendarDay(date);
  if (!p) return '';
  return `${MONTHS[p.m].slice(0, 3)} ${p.d}, ${p.y}`;
}

/** "Oct 26": the short date without its year, for a crumb or a label that sits beside one. */
export function formatMonthDay(date) {
  const p = calendarDay(date);
  if (!p) return '';
  return `${MONTHS[p.m].slice(0, 3)} ${p.d}`;
}

/** "Monday": the weekday of the day a date names. */
export function formatWeekday(date) {
  const p = calendarDay(date);
  if (!p) return '';
  return WEEKDAYS[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()];
}

/** "Monday, October 26, 2026": the long date with its weekday, for a colophon. */
export function formatDateWeekday(date) {
  const full = formatDateFull(date);
  return full && `${formatWeekday(date)}, ${full}`;
}

/** "2019": the year a date falls in, for an index of works. */
export function formatYear(date) {
  const p = calendarDay(date);
  return p ? String(p.y) : '';
}

/**
 * Was this date stored as a day rather than a moment? A bare 'YYYY-MM-DD' or a
 * UTC-midnight stamp (see `calendarDay`): there's no clock in it worth
 * printing.
 */
export function isDayOnly(date) {
  return typeof date === 'string' && (BARE_DAY.test(date) || UTC_MIDNIGHT.test(date));
}

/**
 * "Monday, October 26, 2026 · 5:36 pm": a moment in full, for a tooltip or a
 * colophon. A day stored as a day gets no clock.
 */
export function formatStamp(date) {
  const day = formatDateWeekday(date);
  if (!day || isDayOnly(date)) return day;
  return `${day} · ${formatTime(date)}`;
}

/**
 * Old names, kept so nothing breaks while callers move. formatDateLong was a
 * day-first "29 January 2025", and formatDateAbbrev a "Sept 15, 2026" with its
 * own rule for which months to cut; both now give the house style.
 */
export const formatDateLong = (date) => formatDateFull(date);
export const formatDateAbbrev = (date) => formatDateShort(date);

/* ---------- clocks ---------- */

function clock(hour, minute) {
  return `${hour % 12 || 12}:${pad2(minute)} ${hour >= 12 ? 'pm' : 'am'}`;
}

/** "3:17 pm": an instant on Dame's clock, lowercase, with a space. */
export function formatTime(date) {
  const p = easternParts(date);
  return p ? clock(p.hour, p.minute) : '';
}

/**
 * Format a bare local wall-clock "HH:MM" (24-hour) as a lowercase 12-hour
 * time like "2:59 pm" — no Date, no timezone conversion. Use this for values
 * that are ALREADY local time-of-day (e.g. an iNaturalist observation's stored
 * wall-clock): the clock it was read off, wherever that was. Returns '' for
 * non-"HH:MM" input.
 */
export function formatWallClockTime(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '';
  return clock(Number(m[1]), Number(m[2]));
}

/**
 * The reader's own clock for an instant, in the house style — "2:36 pm", or
 * "11:36 pm Sunday" when it's a different day where they are — or '' when
 * their clock reads the same as Dame's. For a tooltip beside her time, never
 * in its place.
 */
export function readerTime(date) {
  const ms = toMs(date);
  if (!Number.isFinite(ms)) return '';
  const t = new Date(ms);
  // getTimezoneOffset is minutes the reader is behind UTC; zoneOffset is ms
  // New York is ahead of it (negative), so the two cancel when they match.
  if (t.getTimezoneOffset() * MS.m + zoneOffset(ms) === 0) return '';
  const time = clock(t.getHours(), t.getMinutes());
  const theirs = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
  return calendarDaysBetween(easternParts(t), theirs) !== 0 ? `${time} ${WEEKDAYS[t.getDay()]}` : time;
}

/* ---------- machine ---------- */

/**
 * Turn ISO into something that round-trips through JSON without locale drift.
 */
export function toIso(date) {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Compare two ISO-ish timestamps chronologically, newest first. Returns a
 * value suitable for `Array.prototype.sort`. Records without a timestamp
 * (or with an unparseable one) sink to the bottom in stable input order.
 *
 * String comparison is unsafe when timestamps mix timezone offsets — e.g.
 * `is.dame.now` records use `-04:00` while Bluesky posts use `Z`, so a
 * later wall-clock time can sort before an earlier one. Parse before
 * comparing.
 */
export function compareIsoDesc(a, b) {
  const at = a ? Date.parse(a) : NaN;
  const bt = b ? Date.parse(b) : NaN;
  const aBad = !Number.isFinite(at);
  const bBad = !Number.isFinite(bt);
  if (aBad && bBad) return 0;
  if (aBad) return 1;
  if (bBad) return -1;
  return bt - at;
}
