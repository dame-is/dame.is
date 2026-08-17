// Ratioed — the art project where a Bluesky post is sealed with a threadgate
// the moment somebody likes it.
//
// The numbers here are a DATED MEASUREMENT, not a live view, and that is the
// whole reason this data lives in records at all. Constellation indexes live
// state: six of the eleven breaking likes were deleted by the people who cast
// them, so recomputing on render would silently drop the evidence the
// reaction-time finding rests on, and the pre/post-seal split would drift every
// time somebody likes a piece that has been dead for a year. The seed below is
// the authoritative snapshot; `fetchLiveDeltas` only ever ADDS a "since
// measured" figure on top of it.

import SEED from '../data/ratioedPieces.json';
import PEOPLE from '../data/ratioedPeople.json';
import { getBacklinkSources, getBacklinks, backlinkRows, flattenSources } from './constellation.js';
import { ME_DID, COLLECTIONS, RATIOED_PATH } from '../config.js';
import { listRecords, rkeyFromAtUri } from './atproto.js';
import { witnessFromRecord } from './ratioedLive.js';
import { fetchSnapshot } from './snapshot.js';

/** Link sources that count as engagement, mapped to our bucket names. */
const SOURCE_BUCKETS = {
  'app.bsky.feed.like:subject.uri': 'likes',
  'app.bsky.feed.repost:subject.uri': 'reposts',
  'app.bsky.feed.post:embed.record.uri': 'quotes',
  'app.bsky.feed.post:embed.record.record.uri': 'quotes',
  'app.bsky.feed.post:reply.root.uri': 'threadPosts',
};

const EMPTY = { likes: 0, reposts: 0, quotes: 0, threadPosts: 0, participants: 0 };

/** The seed measurement, shaped exactly like the records it seeds. */
export const SEED_PIECES = SEED.map((entry) => ({
  rkey: entry.rkey,
  ...entry.record,
}));

/**
 * Everyone who touched a piece, by DID, most events first.
 *
 * Counted by DID rather than handle on purpose: two deactivated accounts both
 * resolve to the same placeholder handle, and collapsing them would undercount.
 *
 * Four of the eleven breakers are absent from this list entirely — their only
 * act was a like they later deleted, so they left no record to count.
 */
export const SEED_PEOPLE = PEOPLE;

/**
 * The roster, preferring the one the build regenerated.
 *
 * `scripts/prefetch.mjs` folds the people from newly measured pieces into the
 * bundled roster and writes the result as a snapshot, so a piece added since
 * this bundle was harvested still has its participants listed. Falls back to
 * the bundle, which is what the snapshot is built from anyway.
 */
export async function loadPeople() {
  const snap = await fetchSnapshot('ratioedPeople');
  return Array.isArray(snap) && snap.length ? snap : SEED_PEOPLE;
}

/**
 * How the roster divides between people who showed up while a piece was alive
 * and people who only ever touched a finished one. Counts, not lists — every
 * caller so far wants the numbers.
 *
 * `breakersListed` counts the breakers among the living, which is fewer than
 * the number of pieces: a breaker whose like was deleted, and who did nothing
 * else while anything was alive, leaves no surviving record to count.
 */
export function splitParticipants(people = SEED_PEOPLE) {
  const wasLive = (p) => p.pre.length > 0;
  const living = people.filter(wasLive);
  return {
    living: living.length,
    afterOnly: people.length - living.length,
    total: people.length,
    breakersListed: living.filter((p) => p.broke).length,
  };
}

/**
 * What each person did *while a piece was alive*, counted from the event log.
 *
 * The roster's own `kinds` spans both windows, so it can't tell a repost that
 * spread a living piece from one that landed on a finished one — and which of
 * those someone did is exactly what their role is meant to say. The log carries
 * the pre/post flag per record, so it can.
 *
 * Matched by handle, since that's all an event carries. One handle in the
 * roster covers two DIDs — the placeholder for deactivated accounts — and there
 * is no way to say which of them an event belongs to, so both are left out
 * rather than credited with each other's actions.
 */
function livingKindsByHandle(events, people) {
  const out = new Map();
  if (!events) return out;
  const seenOnce = new Set();
  const ambiguous = new Set();
  for (const p of people || []) {
    if (seenOnce.has(p.h)) ambiguous.add(p.h);
    seenOnce.add(p.h);
  }
  for (const list of Object.values(events)) {
    for (const e of Array.isArray(list) ? list : []) {
      if (!e.pre || e.self || !e.h || !e.k || ambiguous.has(e.h)) continue;
      const kinds = out.get(e.h) || {};
      kinds[e.k] = (kinds[e.k] || 0) + 1;
      out.set(e.h, kinds);
    }
  }
  return out;
}

/**
 * How someone showed up, in one word — the most consequential thing they did
 * while a piece was alive.
 *
 * Ordered by effect on the piece rather than by count. Ending it outranks
 * everything. Then a quote, which carries the piece to another timeline with
 * the quoter's own words attached; then a repost, which carries it without
 * them; then a reply, which stays in the thread. Someone who replied nine times
 * and reposted once reads as "reposted", because that repost is the act that
 * took the piece somewhere new — the Mix column beside it still shows all ten.
 */
export function roleOf(person) {
  if (person.broke) return { key: 'broke', label: `broke #${String(person.broke).padStart(2, '0')}` };
  const kinds = person.liveKinds || person.kinds || {};
  if (kinds.quote) return { key: 'quote', label: 'quoted' };
  if (kinds.repost) return { key: 'repost', label: 'reposted' };
  if (kinds.reply) return { key: 'reply', label: 'replied' };
  return { key: 'live', label: 'was there' };
}

/**
 * Everyone who was there while a piece was still alive.
 *
 * Two sources, because there are two ways to know. Most of the roster is
 * measured: an account with a surviving record from before the seal. The
 * breakers are the exception — the like that ended a piece is the one act the
 * project turns on, and most of them were deleted, leaving nothing in any index
 * to find. But the artist names the breaker in the reply that concludes each
 * piece, so that reply is the record, and it's the only reason those people can
 * be counted at all.
 *
 * A named breaker carries `named: true` and no measurable events. One who did
 * leave records is already in the measured set and isn't added twice.
 */
export function livingRoster(pieces, people = SEED_PEOPLE, events = null) {
  const liveKinds = livingKindsByHandle(events, people);
  // Pieces whose breaking like was deleted. Their breaker's most important act
  // is in none of the counts, so the row says so rather than reading as
  // somebody who turned up and did nothing.
  const likeDeleted = new Set(
    (pieces || []).filter((p) => p.breaker?.likeSurvives === false).map((p) => p.take),
  );
  const measured = people
    .filter((p) => p.pre.length > 0)
    .map((p) => ({
      ...p,
      live: p.pre.length,
      after: p.post.length,
      liveKinds: liveKinds.get(p.h) || null,
      likeGone: Boolean(p.broke) && likeDeleted.has(p.broke),
    }));

  // Match on either identifier: the roster is keyed by DID, but a breaker is
  // recorded by the handle the announcement used, and handles get renamed.
  const seen = new Set();
  for (const p of measured) {
    if (p.did) seen.add(p.did);
    if (p.h) seen.add(p.h);
  }

  const named = [];
  for (const piece of pieces || []) {
    const b = piece.breaker;
    if (!b?.handle || b.handle === 'unknown') continue;
    if (seen.has(b.did) || seen.has(b.handle) || seen.has(b.currentHandle)) continue;
    seen.add(b.did || b.handle);
    // A surviving like is a real, countable act — this breaker is missing from
    // the roster for some other reason (a piece measured after the roster was
    // built, say), so credit them with the like we know is there. A deleted one
    // gets no counts at all: that's the point of it being deleted.
    const likeGone = b.likeSurvives === false;
    named.push({
      // No DID when the announcement only gave a handle; the row still needs a
      // stable key, and prefixing keeps it from colliding with a real one.
      did: b.did || `handle:${b.handle}`,
      h: b.currentHandle || b.handle,
      dn: '',
      ev: likeGone ? 0 : 1,
      live: likeGone ? 0 : 1,
      after: 0,
      pre: [piece.take],
      post: [],
      kinds: likeGone ? {} : { like: 1 },
      broke: piece.take,
      named: true,
      likeGone,
    });
  }
  const rows = [...measured, ...named];
  return {
    rows,
    measured: measured.length,
    named: named.length,
    breakers: rows.filter((p) => p.broke).length,
    deleted: rows.filter((p) => p.likeGone).length,
  };
}

/**
 * Replies that landed after the seal — written to the network, indexed by
 * Constellation, and invisible in the app, because a threadgate hides replies
 * at the appview without stopping the records being made. Earliest first.
 *
 * Needs the event log, so callers hand in whatever they've loaded; returns []
 * until it arrives.
 */
export function hiddenReplies(events, pieces) {
  if (!events) return [];
  const out = [];
  for (const piece of pieces || []) {
    const life = piece.lifespanMs / 1000;
    for (const e of events[piece.rkey] || []) {
      if (e.k !== 'reply' || e.pre || e.self) continue;
      out.push({ ...e, take: piece.take, rkey: piece.rkey, afterSec: e.off - life });
    }
  }
  return out.sort((a, b) => a.afterSec - b.afterSec);
}

/* ------------------------------------------------------------------ */
/* Addressing a single piece                                            */
/* ------------------------------------------------------------------ */

// A piece has two names and both are worth honouring. The take number is how
// the project talks about itself — every chart, every announcement reply and
// the artist all say "take #13" — so it's the canonical URL. The record key is
// how the ATmosphere names the same thing: it keys the post, the threadgate and
// the measurement record alike, so anyone arriving from a Bluesky link or an
// at:// URI has it in hand and nothing else. Both resolve; the take is what the
// site links to.

/** The canonical URL segment for a piece: its take, zero-padded like the UI. */
export function pieceSlug(piece) {
  return String(piece?.take ?? '').padStart(2, '0');
}

/** A piece's on-site path, under whichever segment the essay lives at. */
export function piecePath(piece, parent = RATIOED_PATH) {
  const slug = pieceSlug(piece);
  return slug ? `/creating/${parent}/${slug}` : null;
}

/**
 * The piece a URL segment names, or null.
 *
 * Accepts the take number in any form the site or a human might write it —
 * `13`, `013`, `#13` — and the record key. Take numbers are matched
 * numerically so a padded segment and a bare one land on the same piece rather
 * than on two different URLs for it.
 */
export function findPieceByRef(pieces, ref) {
  const raw = String(ref ?? '').trim();
  if (!raw) return null;
  const list = Array.isArray(pieces) ? pieces : [];
  const byKey = list.find((p) => p.rkey === raw);
  if (byKey) return byKey;
  const digits = raw.replace(/^#/, '');
  if (!/^\d+$/.test(digits)) return null;
  const take = Number(digits);
  return list.find((p) => p.take === take) || null;
}

/**
 * Does this `/creating/:slug` segment address the Ratioed essay?
 *
 * Both forms a standard document answers to: the human path it's configured
 * under, and its record key — the same pair `CreatingWork` resolves, so a
 * piece page is reachable wherever its parent is.
 */
export function isRatioedParent(slug, { path = RATIOED_PATH, rkey } = {}) {
  const seg = String(slug ?? '');
  return Boolean(seg) && (seg === path || seg === rkey);
}

/* ------------------------------------------------------------------ */
/* When the pieces happened                                             */
/* ------------------------------------------------------------------ */

// Records store UTC, but "time of day" is only meaningful in the artist's own
// clock — in UTC the pieces scatter across all 24 hours and the pattern
// vanishes. America/New_York is what the rest of the site already treats as
// local: the sky theme, the hourly avatars and the OG cards all resolve through
// og/time.js's easternHour(). Named zone rather than a fixed offset, so it
// follows EST/EDT. Four of the eleven land on the previous day once converted.
export const RATIOED_ZONE = 'America/New_York';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * Where an instant falls on a week grid, in the given zone.
 * Returns `{ day, hour, minute, atHour }` — day 0 = Monday, `atHour` a
 * fractional hour for positioning. Null if the timestamp won't parse.
 */
export function localSlot(iso, zone = RATIOED_ZONE) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = DAY_INDEX[get('weekday')];
  // Intl can emit "24" for midnight under hour12:false.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  if (day == null || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { day, hour, minute, atHour: hour + minute / 60 };
}

/**
 * One mark per piece for the week grid, carrying both magnitudes the marks
 * encode: how long it lived, and how much it drew while living.
 */
export function whenMarks(pieces, zone = RATIOED_ZONE) {
  return (pieces || [])
    .map((p) => {
      const slot = localSlot(p.postedAt, zone);
      if (!slot) return null;
      const e = p.preSeal || {};
      return {
        ...slot,
        take: p.take,
        rkey: p.rkey,
        lifespanMs: p.lifespanMs || 0,
        engagement:
          (e.threadPosts || 0) + (e.reposts || 0) + (e.quotes || 0) + (e.likes || 0),
        participants: e.participants || 0,
      };
    })
    .filter(Boolean);
}

/**
 * Radius for a value whose AREA should be proportional to it — the only honest
 * way to size a disc, since sizing the radius directly exaggerates by squaring.
 * Zero maps to `min` so a piece that drew nothing still shows a mark.
 */
export function areaRadius(value, max, min, maxRadius) {
  if (!max || value <= 0) return min;
  return min + (maxRadius - min) * Math.sqrt(value / max);
}

/**
 * Is this piece still up?
 *
 * A record is written the moment the post goes up, so a piece exists before
 * anyone has liked it and before there is anything to measure. `sealedAt` is
 * the field that decides: no gate, no seal, no measurement. Everything that
 * reasons about the project as a finished series has to leave these out, or a
 * piece that has been alive for ninety seconds plots as a zero-length lifeline
 * and drags every mean down with it.
 */
export function isLive(piece) {
  return Boolean(piece) && !piece.sealedAt;
}

/** Only the pieces that have ended. What every chart and total wants. */
export function finished(pieces) {
  return (pieces || []).filter((p) => !isLive(p));
}

/**
 * The piece that stood the longest — the record a live one is running at.
 *
 * Finished pieces only, which is not a technicality: a piece that is up right
 * now has no lifespan, and the record it is chasing has to be a number that
 * already happened. A tie keeps the first one in the list, which every caller
 * hands in take order — so the piece that got there first keeps the record,
 * which is what a record means. Null before anything has ended, which was true
 * exactly once.
 */
export function longestPiece(pieces) {
  let best = null;
  for (const p of finished(pieces)) {
    if (!(p.lifespanMs > 0)) continue;
    if (!best || p.lifespanMs > best.lifespanMs) best = p;
  }
  return best;
}

/**
 * Normalize a PDS record into the shape the charts consume. Tolerates missing
 * sub-objects so a hand-edited record can't crash the renderer.
 */
export function normalizePiece(rkey, value) {
  if (!value) return null;
  return {
    rkey,
    take: value.take ?? 0,
    subject: value.subject || '',
    postedAt: value.postedAt || '',
    sealedAt: value.sealedAt || '',
    lifespanMs: value.lifespanMs ?? 0,
    announceLagMs: value.announceLagMs ?? null,
    breaker: value.breaker || { handle: 'unknown', likeSurvives: false },
    preSeal: { ...EMPTY, ...(value.preSeal || {}) },
    postSeal: { ...EMPTY, ...(value.postSeal || {}) },
    // Authored opening paragraph, when dame has written one. Empty means the
    // page generates its own from the figures, which is always true but never
    // says anything the numbers don't.
    lede: value.lede || '',
    statedTally: value.statedTally || '',
    measuredAt: value.measuredAt || '',
    // Absent on any piece measured before audiences were recorded, and later
    // than measuredAt on the ones that were backfilled. Either way the reach
    // section reads it before claiming a figure is current.
    audienceAt: value.audienceAt || '',
    source: value.source || '',
    events: eventsFromRecord(value.events),
    // What was watched happening, as opposed to what was measured afterwards.
    // Kept in milliseconds, unlike `events`, because the live panels it feeds
    // are working in the same units the stream reports.
    witnessed: witnessFromRecord(value.witnessed),
    witnessFromMs: typeof value.witnessFromMs === 'number' ? value.witnessFromMs : null,
  };
}

/**
 * Where every other take sits on a live piece's run at the record.
 *
 * The bar under a running piece measures it against the longest one that has
 * ever happened, which is the only unit this project has — but it is also the
 * least representative piece in the series. Take 14 stood for 42 minutes; nine
 * of the sixteen were over inside two. So the bar was one long empty run with a
 * single mark at the end, and the thing actually happening while a piece is up
 * — that it has now outlived take 3, and take 7, and take 12 — had no shape at
 * all.
 *
 * These are that shape: one tick per finished piece at its own lifespan, and
 * whether the live one has passed it yet. They cluster at the left, which is
 * not a defect: the cluster IS the finding, and a piece crossing the last of
 * them has visibly left the whole series behind.
 *
 * @param {Array} pieces      finished pieces
 * @param {object} record     the longest of them, which the bar runs to
 * @param {number} elapsedMs  how long the live piece has stood
 */
export function chaseTicks(pieces, record, elapsedMs = 0) {
  const target = record?.lifespanMs || 0;
  if (!target) return [];
  return (pieces || [])
    .filter((p) => p.lifespanMs > 0 && p.rkey !== record.rkey && p.lifespanMs < target)
    .sort((a, b) => a.lifespanMs - b.lifespanMs)
    .map((p) => ({
      rkey: p.rkey,
      take: p.take,
      lifespanMs: p.lifespanMs,
      at: p.lifespanMs / target,
      passed: elapsedMs >= p.lifespanMs,
    }));
}

/**
 * One log for a piece, from the two places its rows can live.
 *
 * The first eleven pieces were measured offline before records carried a log,
 * and the bundle is the only copy of their alive window — and of the TEXT of
 * every reply, which the harvest kept and a backlink index cannot give back.
 * A recorded log covers whatever windows it was measured over, which since the
 * repair pass can be the afterlife alone.
 *
 * So neither source simply wins. The record owns the windows it has rows in,
 * the bundle fills the windows it doesn't, and a recorded row that has no text
 * takes it from the harvested row it plainly is — same kind, same account,
 * within a second of the same offset. Without that last part, repairing a
 * bundled piece replaced nine rows carrying four replies' worth of text with
 * eight rows carrying none, and the essay's "reactions no one can see" read
 * "(image, no text)" all the way down.
 */
export function composeEventLog(recordLog, bundleLog) {
  const rec = Array.isArray(recordLog) ? recordLog : null;
  const bun = Array.isArray(bundleLog) ? bundleLog : null;
  if (!rec?.length) return bun?.length ? bun : null;
  if (!bun?.length) return rec;

  // The same record, measured twice: same kind, same account, within a second
  // of the same offset. Measured against the real pair the harvest and the
  // repair produced for the first eleven pieces, the offsets agree to about ten
  // milliseconds, so a second and a half is slack rather than a guess.
  const sameRow = (a, b) =>
    a.k === b.k && a.h && a.h === b.h && Math.abs((a.off || 0) - (b.off || 0)) <= 1.5;

  const withText = rec.map((e) => {
    if (e.t) return e;
    const harvested = bun.find((x) => x.t && sameRow(e, x));
    return harvested ? { ...e, t: harvested.t } : e;
  });
  // Everything the harvest holds and the record does not: the alive window of a
  // piece repaired long after it ran, and any row an index has since forgotten.
  // Both are evidence, and the index cannot be asked about either.
  const unrecorded = bun.filter((x) => !rec.some((e) => sameRow(e, x)));
  return [...withText, ...unrecorded].sort((a, b) => a.off - b.off);
}

/**
 * A recorded event log, in the shape the charts read.
 *
 * The record stores milliseconds (lexicon v1 has no float type); the charts
 * plot seconds, as the harvested log does. Null when the piece carries no log —
 * the first eleven predate the field and are drawn from the bundled one.
 */
function eventsFromRecord(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  return events
    .filter((e) => e && typeof e.offMs === 'number')
    .map((e) => ({
      k: e.k,
      h: e.h || '(unresolvable)',
      ...(e.did ? { did: e.did } : {}),
      off: e.offMs / 1000,
      pre: e.pre ? 1 : 0,
      ...(e.self ? { self: 1 } : {}),
      ...(e.t ? { t: e.t } : {}),
      // The audience this account carried the piece to, as of audienceAt.
      // Passed through untouched — `ratioedReach` distinguishes an absent
      // figure from a zero one, so neither can be defaulted here.
      ...(typeof e.fr === 'number' ? { fr: e.fr } : {}),
      ...(typeof e.fo === 'number' ? { fo: e.fo } : {}),
    }))
    .sort((a, b) => a.off - b.off);
}

function fromRecords(records) {
  const pieces = (records || [])
    .map((r) => normalizePiece(rkeyFromAtUri(r?.uri), r?.value))
    .filter((p) => p && p.take);
  return pieces.length ? pieces.sort((a, b) => a.take - b.take) : null;
}

/**
 * Merge two sets of pieces by rkey, `live` winning. Take 1 first.
 *
 * The snapshot is a build artefact, so it can only ever be as current as the
 * last deploy; the PDS is the record. Publishing a new piece has to show up on
 * a page that was built before it existed.
 */
function mergePieces(snap, live) {
  const byKey = new Map();
  for (const p of snap || []) byKey.set(p.rkey, p);
  for (const p of live || []) byKey.set(p.rkey, p);
  return Array.from(byKey.values()).sort((a, b) => a.take - b.take);
}

/**
 * Every piece, take 1 first. The build-time snapshot paints first, the PDS
 * corrects it, and the bundled seed catches the case where neither answers —
 * the charts render identically from any of the three, so a cold snapshot or a
 * PDS blip degrades to "slightly stale", never to an empty chart.
 *
 * The snapshot used to short-circuit the PDS entirely, which meant a piece
 * published after the last build stayed invisible until the site was rebuilt.
 */
export async function loadPieces(pds) {
  const fromSnap = fromRecords(await fetchSnapshot('ratioed'));
  if (!pds) return fromSnap || SEED_PIECES;
  try {
    const records = await listRecords(pds, {
      repo: ME_DID,
      collection: COLLECTIONS.ratioedPiece,
      max: 200,
    });
    const live = fromRecords(records);
    if (!live) return fromSnap || SEED_PIECES;
    return fromSnap ? mergePieces(fromSnap, live) : live;
  } catch {
    return fromSnap || SEED_PIECES;
  }
}

/** Project-wide totals. Pure — derived from whatever pieces you hand it. */
export function aggregate(pieces) {
  const list = Array.isArray(pieces) ? pieces : [];
  let aliveMs = 0;
  let nonLike = 0;
  let likes = 0;
  let deleted = 0;
  const reactions = [];
  for (const p of list) {
    aliveMs += p.lifespanMs || 0;
    nonLike += (p.preSeal.reposts || 0) + (p.preSeal.quotes || 0) + (p.preSeal.threadPosts || 0);
    likes += p.preSeal.likes || 0;
    if (p.breaker?.likeSurvives === false) deleted += 1;
    if (typeof p.breaker?.reactionMs === 'number') reactions.push(p.breaker.reactionMs);
  }
  const meanReactionMs = reactions.length
    ? reactions.reduce((a, b) => a + b, 0) / reactions.length
    : null;
  return {
    count: list.length,
    aliveMs,
    nonLike,
    likes,
    deleted,
    measured: reactions.length,
    meanReactionMs,
    minReactionMs: reactions.length ? Math.min(...reactions) : null,
    maxReactionMs: reactions.length ? Math.max(...reactions) : null,
    // The longest-lived piece sets the shared axis on the lifelines chart.
    maxLifespanMs: list.reduce((m, p) => Math.max(m, p.lifespanMs || 0), 0),
  };
}

/**
 * How much engagement each piece has picked up since it was measured.
 *
 * One `/links/all` call per piece (counts only, no pagination), so eleven
 * requests total. Returns a map keyed by rkey; pieces whose call failed are
 * simply absent rather than reported as zero — "we don't know" and "nothing
 * new" must not look the same.
 */
export async function fetchLiveDeltas(pieces) {
  const list = Array.isArray(pieces) ? pieces : [];
  const results = await Promise.all(
    list.map(async (p) => {
      if (!p.subject) return null;
      const raw = await getBacklinkSources(p.subject);
      const flat = flattenSources(raw);
      if (!flat) return null;
      const now = { ...EMPTY };
      for (const row of flat) {
        const bucket = SOURCE_BUCKETS[row.source];
        if (bucket) now[bucket] += row.count || 0;
      }
      // The artist's own replies are in these totals but not in the recorded
      // figures, so a delta of "0" is the honest floor, never a negative.
      const recorded = p.preSeal;
      const post = p.postSeal;
      const delta = {};
      let total = 0;
      for (const key of ['likes', 'reposts', 'quotes', 'threadPosts']) {
        const since = now[key] - (recorded[key] || 0) - (post[key] || 0);
        delta[key] = Math.max(0, since);
        total += delta[key];
      }
      return [p.rkey, { ...delta, total, checkedAt: new Date().toISOString() }];
    }),
  );
  return Object.fromEntries(results.filter(Boolean));
}

/** Every link source that counts as engagement, as `collection:path` pairs. */
const BACKLINK_SOURCES = [
  ['app.bsky.feed.like:subject.uri', 'like'],
  ['app.bsky.feed.repost:subject.uri', 'repost'],
  ['app.bsky.feed.post:embed.record.uri', 'quote'],
  ['app.bsky.feed.post:embed.record.record.uri', 'quote'],
  ['app.bsky.feed.post:reply.root.uri', 'reply'],
];

/**
 * Every record pointing at a piece, flattened to `{ kind, rkey, did }` — the
 * shape measureWindows() consumes. Pages through each source to the end, so a
 * busy piece is counted in full rather than to the first 100.
 */
export async function fetchPieceRecords(subject) {
  const out = [];
  for (const [source, kind] of BACKLINK_SOURCES) {
    let cursor;
    do {
      const page = await getBacklinks(subject, source, { limit: 100, cursor });
      if (!page) break;
      for (const r of backlinkRows(page)) {
        out.push({ kind, rkey: r.rkey, did: r.did });
      }
      cursor = page.cursor || null;
    } while (cursor);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                           */
/* ------------------------------------------------------------------ */

/** `1763900` → `29m24s`, `48800` → `49s`. */
export function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** Seconds with one decimal — reaction times live in the 10–17s band. */
export function fmtSeconds(ms) {
  if (typeof ms !== 'number') return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * A running stopwatch: `4.28s`, `1m07.42s`.
 *
 * Two decimals rather than one, unlike every other duration here, because this
 * is the only one being read while it moves. The project's whole finding lives
 * between 10 and 17 seconds; a number that ticks in whole seconds while you
 * decide whether to press a button is not showing you the thing you are
 * deciding about. Minutes appear only when they exist — a reaction time that
 * needs them is a story about something else.
 */
export function fmtStopwatch(ms, decimals = 2) {
  const sec = Math.max(0, (ms || 0) / 1000);
  if (sec < 60) return `${sec.toFixed(decimals)}s`;
  const m = Math.floor(sec / 60);
  const rest = (sec - m * 60).toFixed(decimals).padStart(decimals + 3, '0');
  return `${m}m${rest}s`;
}

/** Afterlife offsets span seconds to years, so the unit has to float. */
export function fmtElapsed(sec) {
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)}h`;
  return `${Math.round(sec / 86400)}d`;
}
