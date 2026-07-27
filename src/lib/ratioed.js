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
import { ME_DID, COLLECTIONS } from '../config.js';
import { listRecords, rkeyFromAtUri } from './atproto.js';
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
 * How the roster divides between people who showed up while a piece was alive
 * and people who only ever touched a finished one. Counts, not lists — every
 * caller so far wants the numbers.
 */
export function splitParticipants(people = SEED_PEOPLE) {
  const living = people.reduce((n, p) => n + (p.pre.length > 0 ? 1 : 0), 0);
  return { living, afterOnly: people.length - living, total: people.length };
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
    statedTally: value.statedTally || '',
    measuredAt: value.measuredAt || '',
    source: value.source || '',
    events: eventsFromRecord(value.events),
  };
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
      off: e.offMs / 1000,
      pre: e.pre ? 1 : 0,
      ...(e.self ? { self: 1 } : {}),
      ...(e.t ? { t: e.t } : {}),
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

/** Afterlife offsets span seconds to years, so the unit has to float. */
export function fmtElapsed(sec) {
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)}h`;
  return `${Math.round(sec / 86400)}d`;
}
