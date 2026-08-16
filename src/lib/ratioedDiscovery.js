// Finding new Ratioed pieces on the PDS and measuring them.
//
// A piece is a post that (a) declares itself the project and (b) has a
// threadgate with `allow: []` — the seal. Both are required: the wording alone
// would catch the meta posts that quote a piece, and an empty threadgate alone
// would catch anything else closed to replies.
//
// What can and cannot be recovered after the fact is the whole shape of this
// module. Engagement, the seal time and the announcement all live in records
// that persist, so they can be measured whenever. The breaking like does not:
// six of the first eleven were deleted by the people who cast them, sometimes
// within seconds. Once it's gone, the reaction time is gone with it and no
// index can bring it back. Scanning promptly is what preserves that number.

import { RATIOED_PATH } from '../config.js';
import { tidToTimestamp } from './atproto.js';

/** A record key's PDS write time in epoch ms, or null if it isn't a TID.
 *  tidToTimestamp hands back an ISO string; every comparison here is numeric. */
function tidMs(rkey) {
  const iso = tidToTimestamp(rkey);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * How a piece announces itself.
 *
 * This used to be one exact phrase — "experimental social art project" — which
 * held from take #1 through #12 and then broke: take #13 opened "i would like
 * your help with a social art project", dropping the adjective, and the scan
 * stopped seeing it. That is the one miss this module cannot afford. The post
 * is still found weeks later, but the breaking like is deleted within seconds
 * of the seal, so a piece not measured promptly loses its reaction time for
 * good.
 *
 * So match the parts that have survived every rewording, and match on either
 * of them. Loosening the text test costs nothing, because it was never the
 * thing keeping meta posts out — the seal is, and a post that merely talks
 * about the project still has its replies open.
 *
 * These two are the floor, not the whole test: they cover takes #1 to #13,
 * which were written by hand before the wording lived in a record, and they go
 * on covering them no matter how the template is rewritten later. What a piece
 * written TODAY looks like is answered by the template itself — see
 * `anchorsFromTemplate` below.
 */
const PIECE_MARKERS = [/social art project/i, /this post is the project/i];

/**
 * The link every piece carries to its own page on the site.
 *
 * This and the take line are the two things a piece cannot lose, because
 * `templateProblems` refuses to save a template without them — which makes the
 * pair the one test that survives a rewording nobody told the scan about.
 */
const SELF_LINK = `/creating/${RATIOED_PATH}/`;

/** Lowercased, with runs of whitespace flattened to one space, so a template
 *  line still matches a post whose line breaks fall somewhere else. */
function flatten(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The shortest phrase the project has ever used to name itself — "this post is
 * the project" — is 24 characters. Below that a template line is a fragment
 * ("only replies", "this is take #") that could turn up in anything, so it is
 * not evidence of a piece.
 */
const MIN_ANCHOR = 24;

/**
 * The lines of a template that identify a post written from it.
 *
 * A piece is composed from the template with only `{take}` and `{link}`
 * substituted, so every other line survives into the post verbatim. That makes
 * the template the most accurate description of what a piece looks like that
 * anyone could write — and it is already on the PDS, edited whenever the copy
 * changes. Reading the markers off it is what keeps the scan current without a
 * deploy; hard-coding them is what lost take #13.
 *
 * Splitting on the placeholders first keeps the parts of a line that don't vary
 * and drops the parts that do. Any single anchor is enough to match, because
 * rewording one line at a time is exactly what the series keeps doing.
 */
export function anchorsFromTemplate(text) {
  const out = [];
  for (const segment of String(text ?? '').split(/\{[a-z]+\}/gi)) {
    for (const line of segment.split('\n')) {
      const flat = flatten(line);
      if (flat.length >= MIN_ANCHOR) out.push(flat);
    }
  }
  return out;
}

/** How dame names the breaker in the concluding reply. */
const BLAME_RE = /@([a-z0-9][a-z0-9.-]*)\s*(?:\/\s*(did:[a-z0-9:]+)\s*)?was to blame/i;

const TAKE_RE = /this is take\s*#?\s*(\d+)/i;

/**
 * Is this post record one of the pieces?
 *
 * Three ways to say yes, and any one is enough. The historical markers, for the
 * pieces that predate the template record. The take line together with the link
 * to the piece's own page, which no valid template can drop. And the anchors
 * read off whatever the template says today — pass them in and a wording nobody
 * has ever seen before is recognised on the first scan.
 *
 * Answering yes too often is close to harmless here: the scan only offers what
 * it finds, a human presses publish, and the seal is what actually keeps other
 * posts out. Answering no once is permanent — the breaking like is usually
 * deleted within seconds, and an unmeasured piece loses its reaction time for
 * good. So this errs generous on purpose.
 */
export function isPiecePost(value, anchors = []) {
  const text = value?.text;
  if (typeof text !== 'string') return false;
  if (PIECE_MARKERS.some((re) => re.test(text))) return true;
  if (TAKE_RE.test(text) && text.includes(SELF_LINK)) return true;
  const flat = flatten(text);
  return anchors.some((anchor) => flat.includes(anchor));
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
 * `posts` and `gates` are listRecords results ({ uri, value }). `anchors` comes
 * from `anchorsFromTemplate` over the template on the PDS, so the scan matches
 * the wording in force rather than a copy of it frozen into this file; without
 * it the historical markers and the take-plus-link test still apply. Returns
 * the pieces in take order, each tagged with whether a measurement record
 * exists.
 */
export function findPieces(posts, gates, existingRkeys = new Set(), anchors = []) {
  const gateByRkey = new Map();
  for (const g of gates || []) {
    const rkey = String(g?.uri || '').split('/').pop();
    if (rkey && isSealed(g.value)) gateByRkey.set(rkey, g.value);
  }
  const out = [];
  for (const post of posts || []) {
    const rkey = String(post?.uri || '').split('/').pop();
    if (!rkey || !isPiecePost(post.value, anchors)) continue;
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
 * labelled the same way the harvest labelled a deactivated account. `profiles`
 * is the richer form of the same lookup (see resolveProfiles) and supersedes
 * it: it also carries how many followers each account had, which is what the
 * reach score is computed from.
 *
 * Those two counts are recorded here for the same reason everything else is —
 * they are the most volatile figures on the whole record. Engagement at least
 * only moves when somebody acts; a follower count drifts on its own, every day,
 * for as long as the account exists. Read live at render, a piece's reach would
 * never twice be the same number. An account that resolves to no profile gets
 * no counts at all rather than zero: `ratioedReach` reports those separately as
 * audiences it could not measure, and a zero would silently deflate the total.
 */
export function buildEventLog(
  records,
  { postedAtMs, sealedAtMs, selfDid, handles = {}, profiles = {} },
) {
  const out = [];
  for (const r of records || []) {
    const at = tidMs(r.rkey);
    if (!at) continue;
    const profile = profiles[r.did] || null;
    out.push({
      k: r.kind,
      h: profile?.handle || handles[r.did] || '(unresolvable)',
      ...(r.did ? { did: r.did } : {}),
      offMs: at - postedAtMs,
      pre: at < sealedAtMs ? 1 : 0,
      ...(r.did === selfDid ? { self: 1 } : {}),
      ...(typeof profile?.followers === 'number' ? { fr: profile.followers } : {}),
      ...(typeof profile?.follows === 'number' ? { fo: profile.follows } : {}),
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
  audienceAt,
  source = 'constellation.microcosm.blue',
}) {
  // When the follower counts in the log were read. Normally the same moment as
  // everything else, and worth its own field anyway: the backfill that gave the
  // early pieces an audience took those figures more than a year after they
  // ran, and a reader has to be able to tell that apart from a piece measured
  // as it happened.
  const audienceStamp =
    audienceAt || (events?.some((e) => typeof e.fr === 'number') ? measuredAt : null);
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
    ...(audienceStamp ? { audienceAt: audienceStamp } : {}),
    source,
  };
}
