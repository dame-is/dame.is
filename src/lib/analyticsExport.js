// The Analytics studio's export: the archive this browser holds, as files the
// owner can keep. Pure builders only. They take the rows the studio already
// has in memory and return text; handing that text to the person as a file
// (Blob, anchor, click) is the studio's job, because only a page can do it.
//
// Two shapes, for two uses:
//
//   archiveJson   every store verbatim, the sync meta, and notes on what the
//                 rows can and cannot vouch for. The whole archive, for
//                 reading back with code.
//   postsCsv      one row per post with its engagement counts, newest first,
//                 for a spreadsheet: sort by likes and the top posts are the
//                 top rows.

import { POST_TEXT_LIMIT, engagementOf } from './analytics.js';

export const EXPORT_FORMAT = 'dame-analytics-export';
export const EXPORT_VERSION = 1;

/** The archive stores, in the order the JSON lists them. */
const STORE_KEYS = ['posts', 'followers', 'blocks', 'inbound', 'outbound', 'atmosphere'];

/**
 * What each store is, and where it stops being the whole truth. Written into
 * the file because the file outlives the studio's own caveats on screen.
 */
const NOTES = Object.freeze({
  posts:
    `Your own posts and replies; reposts are not included. text keeps the first ${POST_TEXT_LIMIT} characters of each post. ` +
    'Engagement counts are as of the sync that last fetched each post: ordinary syncs refresh recent posts only, a Rebuild refreshes all of them. ' +
    'Posts deleted since the last Rebuild may still be listed.',
  followers:
    'Current followers, each dated by their follow record. Anyone who has since unfollowed, or whose account is gone, is not listed.',
  blocks: 'Block records in other repos that currently point at you, directly or through a moderation list, each dated by its record key.',
  inbound:
    'Likes, reposts, replies, quotes and mentions from your notifications. Coverage reaches back only as far as the notification history did when the studio first synced (meta.inbound.coverageMs).',
  outbound:
    'Your own likes and reposts. Your replies and quotes are in posts, under replyTo and quoteOf.',
  atmosphere: 'Every record in every collection of your repo: its URI, collection and date. Record contents are not included.',
  actors: 'Profile cards for accounts the People lists have shown.',
});

/**
 * The whole archive as one JSON document.
 *
 * `archive` is the studio's archive state ({ posts, followers, …, meta });
 * `actors` may be the studio's Map or a plain array of profile cards.
 * Counts sit above the rows so a reader sees the size before the bulk.
 */
export function archiveJson(archive, { did = null, handle = null, actors = [], now = Date.now() } = {}) {
  const stores = {};
  const counts = {};
  for (const key of STORE_KEYS) {
    const rows = Array.isArray(archive?.[key]) ? archive[key] : [];
    stores[key] = rows;
    counts[key] = rows.length;
  }
  const actorRows = actors instanceof Map ? Array.from(actors.values()) : Array.isArray(actors) ? actors : [];
  counts.actors = actorRows.length;

  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    did,
    handle,
    notes: NOTES,
    counts,
    meta: archive?.meta || {},
    ...stores,
    actors: actorRows,
  });
}

/**
 * The columns of the posts CSV, in order. `kind` separates replies to other
 * people from continuations of the owner's own threads, since the two behave
 * nothing alike in engagement and a top-posts sort wants to tell them apart.
 */
const CSV_COLUMNS = [
  ['created_at', (p) => p.at],
  ['kind', (p, ctx) => (!p.replyTo ? 'post' : p.replyTo === ctx.did ? 'thread' : 'reply')],
  ['text', (p) => p.text],
  ['likes', (p) => p.likes || 0],
  ['reposts', (p) => p.reposts || 0],
  ['replies', (p) => p.replies || 0],
  ['quotes', (p) => p.quotes || 0],
  ['engagement', (p) => engagementOf(p, 'all')],
  ['has_media', (p) => Boolean(p.hasMedia)],
  ['reply_to', (p) => p.replyTo || ''],
  ['quote_of', (p) => p.quoteOf || ''],
  ['url', (p, ctx) => postUrl(ctx.did || ctx.handle, p.rkey)],
  ['uri', (p) => p.uri],
];

/**
 * The post archive as CSV (RFC 4180: quoted where needed, CRLF rows), newest
 * first. Starts with a byte-order mark, which is what makes Excel read the
 * file as UTF-8 rather than mangling every emoji and curly quote; spreadsheet
 * apps that need no hint ignore it.
 *
 * Text goes in as written. The usual guard against spreadsheet formulas
 * (prefixing a quote to cells that start with = + - @) is for files built from
 * strangers' input; here every cell is the owner's own words, and the guard
 * would alter every reply that opens with a mention.
 */
export function postsCsv(posts, { did = null, handle = null } = {}) {
  const ctx = { did, handle };
  const rows = [...(posts || [])].filter(Boolean).sort(newestFirst);
  const lines = [CSV_COLUMNS.map(([name]) => name).join(',')];
  for (const p of rows) lines.push(CSV_COLUMNS.map(([, pick]) => csvCell(pick(p, ctx))).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** `dame.is-analytics-2026-10-29.json`: the handle, what it is, the LOCAL day. */
export function exportFilename(handle, what, ext, now = Date.now()) {
  const d = new Date(now);
  const day = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
  return `${handle || 'archive'}-${what}-${day}.${ext}`;
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Undated rows sink to the bottom rather than throwing the order off. */
function newestFirst(a, b) {
  const ta = Date.parse(a.at);
  const tb = Date.parse(b.at);
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? 1 : 0;
  if (!Number.isFinite(tb)) return -1;
  return tb - ta;
}

/**
 * The bsky.app link for one post. The DID is preferred over the handle: a
 * handle can change, and a link in a file kept for years should still open.
 * DIDs and record keys are URL-safe by spec, so neither is encoded.
 */
function postUrl(who, rkey) {
  return who && rkey ? `https://bsky.app/profile/${who}/post/${rkey}` : '';
}
