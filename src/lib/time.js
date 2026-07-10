// Relative-time + day-grouping helpers, plain JS, no deps.

const MS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_629_800_000,
  y: 31_557_600_000,
};

/**
 * Produce "2w ago", "3d ago", "just now". Mirrors the old site's terse style.
 */
export function relativeTime(date, now = new Date()) {
  if (!date) return '';
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return '';
  const delta = now.getTime() - t;
  if (delta < MS.m) return 'just now';
  if (delta < MS.h) return `${Math.floor(delta / MS.m)}m ago`;
  if (delta < MS.d) return `${Math.floor(delta / MS.h)}h ago`;
  if (delta < MS.w) return `${Math.floor(delta / MS.d)}d ago`;
  if (delta < MS.mo) return `${Math.floor(delta / MS.w)}w ago`;
  if (delta < MS.y) return `${Math.floor(delta / MS.mo)}mo ago`;
  return `${Math.floor(delta / MS.y)}y ago`;
}

/**
 * Group items by their *local* calendar date (yyyy-mm-dd) using `pickDate`.
 * Local instead of UTC because the user reads the feed in their own
 * time zone — a post made at 11pm EST should sit in that evening's
 * group, not get bumped into the next day because UTC already rolled
 * over.
 *
 * Returns an array of `{ dateKey, date, items }` ordered by `dateKey desc`.
 */
export function groupByDay(items, pickDate = (i) => i.createdAt) {
  const buckets = new Map();
  for (const item of items) {
    const raw = pickDate(item);
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const key = localDateKey(d);
    if (!buckets.has(key)) buckets.set(key, { dateKey: key, date: d, items: [] });
    buckets.get(key).items.push(item);
  }
  return Array.from(buckets.values()).sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
}

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Long-form relative phrasing tuned for day-grouped headers, e.g.
 * "today", "yesterday", "3 days ago", "2 weeks ago", "5 months ago".
 *
 * Anchored to the start of `now`'s *local* day — a post made at 11pm
 * EST should read as "today" until midnight EST, not until UTC's idea
 * of midnight (which is 7-8pm EST).
 */
export function relativeDay(date, now = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const startOfDay = (x) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / MS.d);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.round(days / 7);
    return w === 1 ? '1 week ago' : `${w} weeks ago`;
  }
  if (days < 365) {
    const mo = Math.round(days / 30);
    return mo === 1 ? '1 month ago' : `${mo} months ago`;
  }
  const y = Math.round(days / 365);
  return y === 1 ? '1 year ago' : `${y} years ago`;
}

/**
 * Header label for a day group, e.g. "Yesterday, May 12, 2025" or
 * "Today, July 6, 2026". Combines the capitalized relative phrasing with
 * the full calendar date. Uses *local* date parts so the label matches
 * the local calendar bucketing done by `groupByDay` — a late-night post
 * that reads as "yesterday" locally must also show its local date, not
 * the UTC one it may have rolled into.
 */
export function formatDayLabel(date, now = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const full = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const rel = relativeDay(d, now);
  if (!rel) return full;
  const cap = rel.charAt(0).toUpperCase() + rel.slice(1);
  return `${cap}, ${full}`;
}

/**
 * Short header label for the ledger feed layout: "Today" / "Yesterday"
 * for the two most recent days, then just the local calendar date
 * ("July 3, 2026") — the condensed rows don't leave room for the long
 * combined form that `formatDayLabel` produces.
 */
export function formatDayShortLabel(date, now = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const rel = relativeDay(d, now);
  if (rel === 'today') return 'Today';
  if (rel === 'yesterday') return 'Yesterday';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatDateLong(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * US-style long date, e.g. "March 7, 2025". Pairs with `relativeTime` in
 * the blog index meta line.
 */
export function formatDateFull(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatTime(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

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
