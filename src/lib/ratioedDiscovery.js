// Finding new Ratioed pieces on the PDS and measuring them.
//
// A piece is a post that (a) carries the project's standing phrase and (b) has
// a threadgate with `allow: []` — the seal. Both are required: the phrase alone
// would catch the meta posts that quote a piece, and an empty threadgate alone
// would catch anything else closed to replies.
//
// What can and cannot be recovered after the fact is the whole shape of this
// module. Engagement, the seal time and the announcement all live in records
// that persist, so they can be measured whenever. The breaking like does not:
// six of the first eleven were deleted by the people who cast them, sometimes
// within seconds. Once it's gone, the reaction time is gone with it and no
// index can bring it back. Scanning promptly is what preserves that number.

import { tidToTimestamp } from './atproto.js';

/** A record key's PDS write time in epoch ms, or null if it isn't a TID.
 *  tidToTimestamp hands back an ISO string; every comparison here is numeric. */
function tidMs(rkey) {
  const iso = tidToTimestamp(rkey);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** The phrase every piece has carried since take #1. */
const PIECE_PHRASE = 'experimental social art project';

/** How dame names the breaker in the concluding reply. */
const BLAME_RE = /@([a-z0-9][a-z0-9.-]*)\s*(?:\/\s*(did:[a-z0-9:]+)\s*)?was to blame/i;

const TAKE_RE = /this is take\s*#?\s*(\d+)/i;

/** Is this post record one of the pieces? */
export function isPiecePost(value) {
  return typeof value?.text === 'string' && value.text.toLowerCase().includes(PIECE_PHRASE);
}

/** A threadgate that closes replies to everyone — the seal. */
export function isSealed(threadgateValue) {
  return Array.isArray(threadgateValue?.allow) && threadgateValue.allow.length === 0;
}

/** `this is take #12` → 12. Null when the post doesn't say. */
export function takeFromText(text) {
  const m = TAKE_RE.exec(text || '');
  return m ? Number(m[1]) : null;
}

/**
 * Pull the breaker out of the concluding reply. Returns `{ handle, did }` with
 * `did` only when dame recorded one (she did for take #8, whose handle changed
 * twice the same day).
 */
export function breakerFromAnnouncement(text) {
  const m = BLAME_RE.exec(text || '');
  if (!m) return null;
  return { handle: m[1], ...(m[2] ? { did: m[2] } : {}) };
}

/** Does this reply look like the concluding announcement? */
export function isAnnouncement(value) {
  return typeof value?.text === 'string' && BLAME_RE.test(value.text);
}

/**
 * Match sealed pieces against the records already published.
 *
 * `posts` and `gates` are listRecords results ({ uri, value }). Returns the
 * pieces in take order, each tagged with whether a measurement record exists.
 */
export function findPieces(posts, gates, existingRkeys = new Set()) {
  const gateByRkey = new Map();
  for (const g of gates || []) {
    const rkey = String(g?.uri || '').split('/').pop();
    if (rkey && isSealed(g.value)) gateByRkey.set(rkey, g.value);
  }
  const out = [];
  for (const post of posts || []) {
    const rkey = String(post?.uri || '').split('/').pop();
    if (!rkey || !isPiecePost(post.value)) continue;
    const gate = gateByRkey.get(rkey);
    if (!gate) continue; // still open, or never sealed — not a finished piece
    const postedAt = tidMs(rkey);
    if (!postedAt) continue;
    out.push({
      rkey,
      take: takeFromText(post.value.text),
      postedAt: new Date(postedAt).toISOString(),
      sealedAt: gate.createdAt,
      lifespanMs: Date.parse(gate.createdAt) - postedAt,
      known: existingRkeys.has(rkey),
    });
  }
  return out.sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
}

/**
 * Split a piece's backlinking records into the two windows and count them.
 *
 * `records` is a flat list of `{ kind, rkey, did }`, `sealedAtMs` the gate time.
 * Records authored by `selfDid` are excluded — the recorded figures have always
 * counted participants, not the artist.
 *
 * Also returns `breakingLike`: the latest surviving like from before the seal.
 * Its absence is what `likeSurvives: false` means — the like was deleted, and
 * the reaction time died with it.
 */
export function measureWindows(records, sealedAtMs, selfDid) {
  const pre = { likes: 0, reposts: 0, quotes: 0, threadPosts: 0 };
  const post = { likes: 0, reposts: 0, quotes: 0, threadPosts: 0 };
  const preDids = new Set();
  const postDids = new Set();
  let breakingLike = null;
  const bucket = { like: 'likes', repost: 'reposts', quote: 'quotes', reply: 'threadPosts' };

  for (const r of records || []) {
    const at = tidMs(r.rkey);
    if (!at) continue;
    const key = bucket[r.kind];
    if (!key) continue;
    if (at < sealedAtMs) {
      if (r.kind === 'like' && (!breakingLike || at > breakingLike.at)) {
        breakingLike = { at, did: r.did };
      }
      if (r.did === selfDid) continue;
      pre[key] += 1;
      preDids.add(r.did);
    } else {
      if (r.did === selfDid) continue;
      post[key] += 1;
      postDids.add(r.did);
    }
  }
  return {
    preSeal: { ...pre, participants: preDids.size },
    postSeal: { ...post, participants: postDids.size },
    breakingLike,
  };
}

/**
 * The same records measureWindows counts, kept individually: one entry per
 * backlink, timed against the moment the piece went up.
 *
 * The counts alone can't draw a lifeline — the chart needs to know *when* each
 * record landed — and the first eleven pieces got that from a log harvested
 * offline. A piece measured here has to carry its own, or it plots as an empty
 * row. Recorded rather than recomputed at render time for the reason the whole
 * project is recorded: Constellation indexes live state, so a like deleted
 * tomorrow leaves no trace of ever having existed.
 *
 * `handles` maps DID → handle (see resolveHandles); an unresolved DID is
 * labelled the same way the harvest labelled a deactivated account.
 */
export function buildEventLog(records, { postedAtMs, sealedAtMs, selfDid, handles = {} }) {
  const out = [];
  for (const r of records || []) {
    const at = tidMs(r.rkey);
    if (!at) continue;
    out.push({
      k: r.kind,
      h: handles[r.did] || '(unresolvable)',
      ...(r.did ? { did: r.did } : {}),
      offMs: at - postedAtMs,
      pre: at < sealedAtMs ? 1 : 0,
      ...(r.did === selfDid ? { self: 1 } : {}),
    });
  }
  return out.sort((a, b) => a.offMs - b.offMs);
}

/**
 * Assemble a publishable record from a discovered piece and its measurement.
 * `announcement` is dame's concluding reply, when one was found.
 */
export function buildPieceRecord({
  piece,
  windows,
  announcement,
  subject,
  measuredAt,
  events,
  source = 'constellation.microcosm.blue',
}) {
  const breaker = breakerFromAnnouncement(announcement?.text) || { handle: 'unknown' };
  const likeSurvives = Boolean(windows.breakingLike);
  const announceAt = announcement?.rkey ? tidMs(announcement.rkey) : null;
  const sealedMs = Date.parse(piece.sealedAt);
  return {
    take: piece.take,
    subject,
    postedAt: piece.postedAt,
    sealedAt: piece.sealedAt,
    lifespanMs: piece.lifespanMs,
    ...(announceAt ? { announceLagMs: announceAt - sealedMs } : {}),
    breaker: {
      ...breaker,
      likeSurvives,
      ...(likeSurvives ? { reactionMs: sealedMs - windows.breakingLike.at } : {}),
    },
    preSeal: windows.preSeal,
    postSeal: windows.postSeal,
    ...(events?.length ? { events } : {}),
    measuredAt,
    source,
  };
}
