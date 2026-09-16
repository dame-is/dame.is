// Everyone who touched a post, and how.
//
// Constellation is the source rather than the AppView's getLikes/getRepostedBy,
// for one reason that decides the whole design: the AppView answers as a VIEWER.
// It filters what it returns by the blocks and mutes already in place, so the
// moment you use it to decide who to block it is hiding the people you already
// acted on and quietly changing its answer as you work. Constellation indexes
// the firehose and answers the same way for everyone, which is the only useful
// behaviour for an audit.
//
// Sources are DISCOVERED, not declared. A counts call returns every
// (collection, path) pair pointing at the record, so a like is found the same
// way a bookmark from an app nobody here has heard of is found. Hardcoding
// `app.bsky.feed.like:subject.uri` would have meant a tool that goes subtly
// blind every time the network grows a new verb — and the whole point of
// harvesting from the Atmosphere rather than from Bluesky is that the network
// does that constantly.
//
// What this module does NOT do is judge anyone. It returns who did what. The
// trust and distance scoring, the bands, and the protected-set veto live in
// `score.js` and run over this output. Keeping them apart is what lets the
// harvest be cached and re-scored later as the circle moves.

import {
  getBacklinkSources,
  getBacklinks,
  backlinkRows,
  flattenSources,
} from '../constellation.js';

/** Constellation pages at 100; anything larger is silently clamped. */
const PAGE = 100;

/**
 * How many pages to pull from a single source before giving up on it.
 *
 * A viral post can carry tens of thousands of likes, and pulling all of them to
 * decide who to act on is both slow and pointless — the tail of a big post is
 * strangers, and the scoring will land every one of them in UNKNOWN. The cap is
 * per-source so a post with 20k likes still yields every reply and quote, which
 * are the engagements that actually carry intent. `truncated` on the result says
 * when this bit, and the caller is expected to surface it rather than swallow it.
 */
const MAX_PAGES = 60;

/**
 * Map a Constellation source onto an engagement kind.
 *
 * Bluesky's own verbs get real names; everything else keeps its NSID so an
 * unrecognised lexicon shows up as itself in the breakdown instead of being
 * bucketed into a lie. `reply.root` and `reply.parent` are deliberately
 * distinct: a direct reply is a person talking TO you and a root-only match is
 * someone further down a thread who may never have addressed you at all.
 */
export function engagementKind({ collection, path }) {
  const p = path.startsWith('.') ? path.slice(1) : path;
  if (collection === 'app.bsky.feed.like' && p === 'subject.uri') return 'like';
  if (collection === 'app.bsky.feed.repost' && p === 'subject.uri') {
    return 'repost';
  }
  if (collection === 'app.bsky.feed.post') {
    if (p === 'reply.parent.uri') return 'reply';
    if (p === 'reply.root.uri') return 'threadReply';
    if (p.startsWith('embed.record')) return 'quote';
  }
  if (collection === 'app.bsky.feed.threadgate' && p === 'post') return 'gate';
  return collection;
}

/**
 * Engagement kinds in the order a person reads them: loudest first.
 *
 * Used for display ordering and for `primaryKind` below. A quote carries more
 * intent than a reply, a reply more than a repost, a repost more than a like —
 * this is a claim about how much deliberate effort each takes, not about how
 * hostile any of them is.
 */
export const KIND_ORDER = [
  'quote',
  'reply',
  'threadReply',
  'repost',
  'like',
  'gate',
];

/** The loudest thing this account did, for one-line summaries. */
export function primaryKind(engagements) {
  for (const kind of KIND_ORDER) {
    if (engagements[kind]) return kind;
  }
  const rest = Object.keys(engagements);
  return rest.length ? rest[0] : null;
}

/**
 * Page one source completely (up to MAX_PAGES) and hand back its rows.
 *
 * Returns `{ rows, truncated }`. A source that fails outright comes back empty
 * with `failed: true` rather than throwing, because one dead lexicon should not
 * cost you the likes.
 */
async function drainSource(uri, source, { signal, maxPages = MAX_PAGES } = {}) {
  const rows = [];
  let cursor;
  let pages = 0;
  while (pages < maxPages) {
    const page = await getBacklinks(uri, source, {
      limit: PAGE,
      cursor,
      signal,
    });
    if (!page) return { rows, truncated: false, failed: pages === 0 };
    rows.push(...backlinkRows(page));
    pages += 1;
    cursor = page.cursor;
    if (!cursor) return { rows, truncated: false, failed: false };
  }
  return { rows, truncated: true, failed: false };
}

/**
 * Harvest every account that interacted with `uri`.
 *
 * @param {string} uri at:// URI of the post (from `resolveTarget`)
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.maxPages] per-source page cap
 * @param {(s: {done: number, total: number, source: string}) => void} [opts.onProgress]
 * @returns {Promise<{
 *   uri: string,
 *   harvestedAt: string,
 *   sources: Array<{collection: string, path: string, source: string, count: number,
 *                   distinctDids: number|null, kind: string, truncated: boolean,
 *                   failed: boolean}>,
 *   participants: Array<{did: string, engagements: Record<string, number>,
 *                        primary: string|null, records: Array<{kind: string, rkey: string,
 *                        collection: string}>, total: number}>,
 *   totals: { participants: number, engagements: Record<string, number>, records: number },
 *   truncated: boolean,
 * }>}
 */
export async function harvestPost(uri, opts = {}) {
  const { signal, maxPages, onProgress } = opts;
  const raw = await getBacklinkSources(uri);
  const flat = flattenSources(raw);
  if (!flat) {
    throw new Error(
      'Constellation did not answer — the backlink index is the only complete source for this, so there is no degraded mode worth running',
    );
  }

  // Sources with nothing in them still get reported (a zero is informative:
  // "nobody quoted this" is an answer) but are not paged.
  const live = flat.filter((s) => s.count > 0);
  const sources = [];
  const byDid = new Map();
  let records = 0;

  let done = 0;
  for (const src of live) {
    const kind = engagementKind(src);
    onProgress?.({ done, total: live.length, source: src.source });
    const { rows, truncated, failed } = await drainSource(uri, src.source, {
      signal,
      maxPages,
    });
    for (const row of rows) {
      if (!row?.did) continue;
      records += 1;
      let entry = byDid.get(row.did);
      if (!entry) {
        entry = { did: row.did, engagements: {}, records: [], total: 0 };
        byDid.set(row.did, entry);
      }
      entry.engagements[kind] = (entry.engagements[kind] || 0) + 1;
      entry.total += 1;
      entry.records.push({
        kind,
        rkey: row.rkey,
        collection: row.collection ?? src.collection,
      });
    }
    sources.push({ ...src, kind, truncated, failed });
    done += 1;
  }
  onProgress?.({ done, total: live.length, source: null });

  const participants = [...byDid.values()].map((p) => ({
    ...p,
    primary: primaryKind(p.engagements),
  }));
  // Loudest engagement first, then most engagements — so a quote-poster is at
  // the top of the list and a single silent liker is at the bottom.
  participants.sort((a, b) => {
    const ai = KIND_ORDER.indexOf(a.primary);
    const bi = KIND_ORDER.indexOf(b.primary);
    const an = ai === -1 ? KIND_ORDER.length : ai;
    const bn = bi === -1 ? KIND_ORDER.length : bi;
    return an - bn || b.total - a.total;
  });

  const engagements = {};
  for (const p of participants) {
    for (const [kind, n] of Object.entries(p.engagements)) {
      engagements[kind] = (engagements[kind] || 0) + n;
    }
  }

  return {
    uri,
    harvestedAt: new Date().toISOString(),
    sources,
    participants,
    totals: { participants: participants.length, engagements, records },
    truncated: sources.some((s) => s.truncated),
  };
}

/**
 * Collapse a harvest to the DIDs alone, for feeding the scorer.
 *
 * `excludeSelf` drops the post's own author, who otherwise shows up on every
 * harvest of their own thread as a pile of self-replies.
 */
export function participantDids(harvest, { excludeSelf = null } = {}) {
  return harvest.participants
    .map((p) => p.did)
    .filter((did) => did !== excludeSelf);
}
