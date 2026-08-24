// Pure derivations for the admin Analytics studio — bucketing, growth series,
// period comparisons and the ranked lists. No fetch, no DOM, no state: this
// module turns the archives that analyticsSync.js gathers (posts, followers,
// inbound and outbound engagement events) into the numbers the studio draws.
//
// Everything is bucketed in LOCAL time, for the same reason groupByDay in
// time.js is: the owner reads their own dashboard in their own timezone, and a
// post made at 11pm should count toward that evening's bar, not the next day's
// because UTC rolled over.
//
// Vocabulary, used consistently across the sync, the store and the studio:
//
//   unit   'day' | 'week' | 'month'      — a bucket size. Weeks start Monday.
//   kind   'like' | 'repost' | 'reply' | 'quote' | 'mention'
//                                        — one engagement event type. Filters
//                                          use the same words; 'all' is the
//                                          absence of a filter, not a kind.
//   event  { uri, did, kind, at }        — one act of engagement, either
//                                          inbound (did = who did it) or
//                                          outbound (did = who it was aimed at).
//   post   the compact archive shape compactPostFromFeedItem produces.

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* Periods and kinds                                                    */
/* ------------------------------------------------------------------ */

/**
 * The period presets, date-range-first as every dashboard filter row is.
 * `days: null` means "all time" — the caller derives t0 from its own oldest
 * data point, because "everything" starts wherever the data does.
 */
export const ANALYTICS_PERIODS = Object.freeze([
  Object.freeze({ key: '7d', days: 7, label: '7 days' }),
  Object.freeze({ key: '30d', days: 30, label: '30 days' }),
  Object.freeze({ key: '90d', days: 90, label: '90 days' }),
  Object.freeze({ key: '1y', days: 365, label: 'Year' }),
  Object.freeze({ key: 'all', days: null, label: 'All time' }),
]);

/**
 * The engagement-type filter for anything derived from POST COUNTS — a post
 * knows how many likes/reposts/replies/quotes it carries, and nothing else.
 */
export const ENGAGEMENT_KINDS = Object.freeze([
  Object.freeze({ key: 'all', label: 'All' }),
  Object.freeze({ key: 'like', label: 'Likes' }),
  Object.freeze({ key: 'repost', label: 'Reposts' }),
  Object.freeze({ key: 'reply', label: 'Replies' }),
  Object.freeze({ key: 'quote', label: 'Quotes' }),
]);

/**
 * The filter for EVENT lists (the People tab). Mentions exist only here:
 * a mention arrives as a notification event, but no post carries a
 * "mentionCount", so the post-count filter above cannot offer it.
 */
export const EVENT_KINDS = Object.freeze([
  ...ENGAGEMENT_KINDS,
  Object.freeze({ key: 'mention', label: 'Mentions' }),
]);

/** kind → the post-count field carrying it. */
const KIND_FIELD = { like: 'likes', repost: 'reposts', reply: 'replies', quote: 'quotes' };

/**
 * How much engagement a post carries, for one kind or for all four summed.
 * Unknown kinds count 0 rather than throwing — a stale filter value in a URL
 * must not take the studio down.
 */
export function engagementOf(post, kind = 'all') {
  if (!post) return 0;
  if (kind === 'all') {
    return (post.likes || 0) + (post.reposts || 0) + (post.replies || 0) + (post.quotes || 0);
  }
  const field = KIND_FIELD[kind];
  return field ? post[field] || 0 : 0;
}

/* ------------------------------------------------------------------ */
/* Buckets                                                              */
/* ------------------------------------------------------------------ */

/**
 * Start of the bucket containing `t`, in local time. Weeks start Monday —
 * `getDay()` counts from Sunday, so Monday-offset is `(day + 6) % 7`.
 * Returns a millisecond timestamp, NaN for unparseable input.
 */
export function bucketStartMs(t, unit) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return NaN;
  if (unit === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (unit === 'week') {
    const monday = d.getDate() - ((d.getDay() + 6) % 7);
    return new Date(d.getFullYear(), d.getMonth(), monday).getTime();
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Start of the bucket after the one containing `t`. DST-safe: calendar math. */
export function nextBucketMs(t, unit) {
  const start = new Date(bucketStartMs(t, unit));
  if (unit === 'month') return new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();
  const days = unit === 'week' ? 7 : 1;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + days).getTime();
}

/**
 * Dense series: one entry per bucket from t0 through t1 INCLUSIVE, zero-filled.
 * Density is not a nicety — a bar chart that simply skips empty buckets draws
 * a quiet week as if it never happened, and every trend read off it is wrong.
 *
 * `pickTime` maps an item to a millisecond timestamp (or anything Date can
 * parse); `pickValue` maps it to its contribution (default 1 = a count).
 * Items outside [t0, t1] and items with no readable time are dropped.
 *
 * Capped at 1000 buckets, keeping the NEWEST — the unit choices the studio
 * offers stay far under this, so the cap is a guard against a pathological
 * t0, not a limit anyone should meet.
 *
 * @returns {Array<{t:number, v:number}>} t = bucket start (local ms).
 */
export function bucketSeries(items, { unit = 'day', t0, t1, pickTime, pickValue } = {}) {
  const time = pickTime || ((i) => i?.at);
  const value = pickValue || (() => 1);
  const from = bucketStartMs(t0, unit);
  const to = bucketStartMs(t1, unit);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];

  const series = [];
  const index = new Map();
  for (let t = from, n = 0; t <= to && n < 1000; t = nextBucketMs(t, unit), n++) {
    index.set(t, series.length);
    series.push({ t, v: 0 });
  }

  for (const item of items || []) {
    const raw = time(item);
    const at = typeof raw === 'number' ? raw : Date.parse(raw);
    if (!Number.isFinite(at) || at < t0 || at > t1) continue;
    const slot = index.get(bucketStartMs(at, unit));
    if (slot == null) continue;
    const v = Number(value(item));
    if (Number.isFinite(v)) series[slot].v += v;
  }
  return series.slice(-1000);
}

/**
 * Running total over a dense series — the "cumulative" view of follower
 * growth. `baseline` is everything that happened before the series starts,
 * so a 30-day window climbs from the real count, not from zero.
 */
export function cumulativeSeries(series, baseline = 0) {
  let sum = baseline;
  return (series || []).map((p) => ({ t: p.t, v: (sum += p.v) }));
}

/**
 * Centered moving average — the trend line over a bumpy bar series. The
 * window shrinks symmetrically at the edges rather than padding with zeros,
 * so the line begins and ends on real data instead of diving toward an
 * invented origin.
 */
export function movingAverage(series, window = 7) {
  const n = (series || []).length;
  if (n === 0) return [];
  const half = Math.floor(Math.max(1, window) / 2);
  return series.map((p, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += series[j].v;
    return { t: p.t, v: sum / (hi - lo + 1) };
  });
}

/**
 * This period against the one before it — the honest form of "comparisons of
 * periods": same length, immediately adjacent, summed with the same measure.
 *
 * `pct` is null when the previous period was zero: "+∞%" is not a number and
 * "+100%" would be a lie. The caller renders that case as "new".
 *
 * @returns {{current:number, previous:number, delta:number, pct:number|null}}
 */
export function comparePeriods(items, { days, now = Date.now(), pickTime, pickValue } = {}) {
  const time = pickTime || ((i) => i?.at);
  const value = pickValue || (() => 1);
  const span = (days || 0) * DAY_MS;
  let current = 0;
  let previous = 0;
  if (span > 0) {
    for (const item of items || []) {
      const raw = time(item);
      const at = typeof raw === 'number' ? raw : Date.parse(raw);
      if (!Number.isFinite(at) || at > now) continue;
      const v = Number(value(item));
      if (!Number.isFinite(v)) continue;
      if (at > now - span) current += v;
      else if (at > now - 2 * span) previous += v;
    }
  }
  const delta = current - previous;
  const pct = previous > 0 ? (delta / previous) * 100 : null;
  return { current, previous, delta, pct };
}

/* ------------------------------------------------------------------ */
/* Ranked lists                                                         */
/* ------------------------------------------------------------------ */

/**
 * Rank posts within [t0, t1] by one engagement kind (or all four). Ties break
 * newest-first so the order is stable across renders.
 */
export function topPosts(posts, { kind = 'all', t0 = -Infinity, t1 = Infinity, limit = 10 } = {}) {
  return (posts || [])
    .filter((p) => {
      const at = Date.parse(p?.at);
      return Number.isFinite(at) && at >= t0 && at <= t1;
    })
    .sort((a, b) => engagementOf(b, kind) - engagementOf(a, kind) || Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(0, limit));
}

/**
 * Rank the accounts behind a pile of engagement events — who engages with the
 * owner (inbound events) or whom the owner engages with (outbound events),
 * the same shape either way.
 *
 * `kind` filters to one event type; `excludeDid` drops the owner's own DID,
 * because replying to yourself is threading, not engagement.
 *
 * @returns {Array<{did:string, total:number, byKind:Object<string,number>}>}
 */
export function topActors(events, { kind = 'all', t0 = -Infinity, t1 = Infinity, limit = 12, excludeDid = null } = {}) {
  const byDid = new Map();
  for (const ev of events || []) {
    if (!ev?.did || ev.did === excludeDid) continue;
    if (kind !== 'all' && ev.kind !== kind) continue;
    const at = typeof ev.at === 'number' ? ev.at : Date.parse(ev.at);
    if (!Number.isFinite(at) || at < t0 || at > t1) continue;
    let row = byDid.get(ev.did);
    if (!row) byDid.set(ev.did, (row = { did: ev.did, total: 0, byKind: {} }));
    row.total += 1;
    row.byKind[ev.kind] = (row.byKind[ev.kind] || 0) + 1;
  }
  return Array.from(byDid.values())
    .sort((a, b) => b.total - a.total || (a.did < b.did ? -1 : 1))
    .slice(0, Math.max(0, limit));
}

/* ------------------------------------------------------------------ */
/* Compact shapes — what the archives store                             */
/* ------------------------------------------------------------------ */

/** The DID a fully-formed at:// URI belongs to, or null. */
export function didFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/(did:[^/]+)/);
  return m ? m[1] : null;
}

/**
 * One getAuthorFeed item → one archive row, or null for the items that are
 * not the owner's own posts. A repost arrives as somebody else's post wearing
 * a `reason` — real activity, but its text, counts and author are not the
 * owner's, so it must never enter the post archive.
 *
 * The row keeps only what the studio reads: when it was made, a snippet to
 * recognize it by, the four engagement counts, and — for the outbound
 * People list — WHO a reply or quote was aimed at. A post can be both (a
 * reply that quotes someone); both targets are kept.
 */
export function compactPostFromFeedItem(item) {
  const post = item?.post;
  if (!post?.uri || item?.reason) return null;
  const record = post.record || {};

  const at = record.createdAt || null;
  if (!at || !Number.isFinite(Date.parse(at))) return null;

  // Quotes live in the embed, in one of two shapes: a bare record embed, or
  // record-with-media where the record is nested one level deeper.
  const embed = record.embed || {};
  const quotedUri =
    embed.$type === 'app.bsky.embed.record'
      ? embed.record?.uri
      : embed.$type === 'app.bsky.embed.recordWithMedia'
        ? embed.record?.record?.uri
        : null;
  const media =
    embed.$type === 'app.bsky.embed.images' ||
    embed.$type === 'app.bsky.embed.video' ||
    (embed.$type === 'app.bsky.embed.recordWithMedia' &&
      (embed.media?.$type === 'app.bsky.embed.images' || embed.media?.$type === 'app.bsky.embed.video'));

  return {
    uri: post.uri,
    rkey: post.uri.split('/').pop(),
    at,
    text: typeof record.text === 'string' ? record.text.slice(0, 200) : '',
    likes: post.likeCount || 0,
    reposts: post.repostCount || 0,
    replies: post.replyCount || 0,
    quotes: post.quoteCount || 0,
    replyTo: didFromAtUri(record.reply?.parent?.uri),
    quoteOf: didFromAtUri(quotedUri),
    hasMedia: Boolean(media),
  };
}

/** The notification reasons that are engagement aimed at the owner. */
const INBOUND_REASONS = new Set(['like', 'repost', 'reply', 'quote', 'mention']);

/**
 * One listNotifications entry → one inbound event, or null for the reasons
 * that are not engagement (follows are the follower sweep's job; the rest —
 * verified, starterpack-joined, likes via repost — are noise here).
 *
 * `uri` is the record that CAUSED the notification (their like record, their
 * reply post…), which is unique per event and therefore the archive key.
 */
export function inboundFromNotification(n) {
  if (!n?.uri || !n?.author?.did || !INBOUND_REASONS.has(n.reason)) return null;
  const at = n.record?.createdAt || n.indexedAt || null;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return { uri: n.uri, did: n.author.did, kind: n.reason, at };
}

/**
 * One of the owner's own like/repost records → one outbound event aimed at
 * the account whose post was liked/reposted. Null when the subject is
 * unreadable — an event with nobody on the other end ranks no one.
 */
export function outboundFromRecord(kind, record) {
  const targetUri = record?.value?.subject?.uri;
  const did = didFromAtUri(targetUri);
  if (!record?.uri || !did) return null;
  const at = record.value?.createdAt || null;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return { uri: record.uri, kind, did, at };
}

/**
 * The outbound reply/quote events already sitting in the post archive. No
 * extra fetch: a reply knows whom it answered and a quote knows whom it
 * quoted, because compactPostFromFeedItem kept the target DIDs. A post that
 * is both emits both — they are two different acts toward possibly two
 * different people.
 */
export function outboundFromPosts(posts) {
  const events = [];
  for (const p of posts || []) {
    if (p?.replyTo) events.push({ uri: `${p.uri}#reply`, kind: 'reply', did: p.replyTo, at: p.at });
    if (p?.quoteOf) events.push({ uri: `${p.uri}#quote`, kind: 'quote', did: p.quoteOf, at: p.at });
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* Small formatting / choice helpers                                    */
/* ------------------------------------------------------------------ */

/**
 * Which bucket sizes read well over a span, smallest first. A year of daily
 * bars is 365 four-pixel slivers, so 'day' is only offered while the bars
 * would still be bars.
 */
export function unitChoicesFor(spanDays) {
  if (spanDays == null || spanDays > 366) return ['week', 'month'];
  if (spanDays > 120) return ['week', 'month'];
  if (spanDays > 31) return ['day', 'week', 'month'];
  return ['day', 'week'];
}

/** The unit a span opens on: days for a month, weeks for a year, months beyond. */
export function defaultUnitFor(spanDays) {
  if (spanDays == null || spanDays > 366) return 'month';
  if (spanDays > 31) return 'week';
  return 'day';
}

/**
 * Tile-value formatting: exact and comma'd while short, compact (12.9K) once
 * the exact number stops being readable at a glance. One decimal, trimmed.
 */
export function fmtCompact(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (abs >= 10_000) return `${trimZero((n / 1000).toFixed(1))}K`;
  return Math.round(n).toLocaleString('en-US');
}

function trimZero(s) {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * A signed percent delta for a tile, or the two words that are truer than a
 * percentage: "new" when there was nothing before, "±0%" when nothing moved.
 */
export function fmtDelta(pct) {
  if (pct == null) return 'new';
  if (pct === 0) return '±0%';
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${pct > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
}

/** Bucket label for an axis endpoint or tooltip: "Jun 3", "Jun 2025". */
export function bucketLabel(t, unit) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  if (unit === 'month') {
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return unit === 'week' ? `wk of ${day}` : day;
}

/** The oldest event time in a pile, for honest "coverage since" captions. */
export function oldestEventMs(events) {
  let oldest = Infinity;
  for (const ev of events || []) {
    const at = typeof ev?.at === 'number' ? ev.at : Date.parse(ev?.at);
    if (Number.isFinite(at) && at < oldest) oldest = at;
  }
  return Number.isFinite(oldest) ? oldest : null;
}
