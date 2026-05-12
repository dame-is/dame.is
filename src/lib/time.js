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
 * Group items by their UTC date (yyyy-mm-dd) using `pickDate`.
 * Returns an array of `{ dateKey, date, items }` ordered by `dateKey desc`.
 */
export function groupByDay(items, pickDate = (i) => i.createdAt) {
  const buckets = new Map();
  for (const item of items) {
    const raw = pickDate(item);
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    if (!buckets.has(key)) buckets.set(key, { dateKey: key, date: d, items: [] });
    buckets.get(key).items.push(item);
  }
  return Array.from(buckets.values()).sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Long-form relative phrasing tuned for day-grouped headers, e.g.
 * "today", "yesterday", "3 days ago", "2 weeks ago", "5 months ago".
 *
 * Anchored to the start of `now`'s UTC day so two timestamps on the same
 * calendar day always read as "today" regardless of clock time.
 */
export function relativeDay(date, now = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const startOfDay = (x) =>
    Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
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

export function formatDateLong(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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
