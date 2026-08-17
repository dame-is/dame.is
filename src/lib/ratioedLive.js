// A Ratioed piece as it happens, and what survives of it afterwards.
//
// The studio has always watched a live piece over Jetstream, and always thrown
// what it saw away — the log was a witness, and the measurement taken from
// Constellation afterwards was the record. That works for everything except the
// one thing the project turns on. Constellation indexes LIVE state: a like cast
// and deleted while the piece was up leaves nothing behind to measure, and six
// of the first thirteen breaking likes went exactly that way. The stream saw
// every one of them.
//
// So the witnessed log is now kept: written onto the piece's own record as the
// piece runs, which does three things at once. It survives the studio tab being
// closed. It lets the piece's public page show what is happening to somebody who
// arrived thirty seconds late, without them having to open a firehose of their
// own. And once the piece is sealed it is the only account of the withdrawals —
// the measurement can say a like is missing, but only this can say it was there.
//
// Witnessed is not measured, and the two are never folded together. A witness
// row exists because something was watching at that second; a measured event
// exists because an index still holds the record. Where they disagree, they
// disagree in public.

import { tidToTimestamp } from './atproto.js';
import { identify } from './ratioedIdentity.js';

/**
 * How many rows a record carries. A piece draws tens; this is a ceiling for the
 * case where the studio is pointed at something that goes viral, and it keeps
 * the EARLIEST rows rather than the latest — the beginning of a piece is the
 * part the reaction time lives in.
 */
export const WITNESS_MAX = 1000;

/** Post text is a courtesy on these rows, not the point of them. */
export const WITNESS_TEXT_MAX = 300;

const KINDS = new Set(['like', 'repost', 'quote', 'reply']);

/** A record key's PDS write time in epoch ms, or null when it isn't a TID. */
function tidMs(rkey) {
  const iso = tidToTimestamp(rkey);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A Jetstream event, timed against the moment the piece went up.
 *
 * The offset comes from the record key rather than from the message's own
 * `time`: the key is the PDS write clock, which is the same clock `postedAt`,
 * `reactionMs` and every measured event were read from. The envelope time is
 * the relay's, and mixing the two would put fractions of a second of somebody
 * else's clock skew into the one number this project exists to measure.
 *
 * Returns null for anything that isn't one of the four kinds, or that carries
 * no key to time itself by.
 */
export function witnessRow(ev, postedAtMs) {
  if (!ev || !KINDS.has(ev.kind) || !ev.rkey) return null;
  const at = tidMs(ev.rkey) ?? (ev.time ? Date.parse(ev.time) : NaN);
  if (!Number.isFinite(at) || !Number.isFinite(postedAtMs)) return null;
  const text = typeof ev.text === 'string' ? ev.text.slice(0, WITNESS_TEXT_MAX) : '';
  return {
    k: ev.kind,
    rkey: ev.rkey,
    ...(ev.did ? { did: ev.did } : {}),
    offMs: at - postedAtMs,
    ...(text ? { t: text } : {}),
  };
}

/**
 * Fold one row into a log, keyed by record key. Earliest first.
 *
 * A merge rather than an append because the same row arrives from three places
 * — the socket, the record the studio wrote a moment ago, and a reconnect
 * replaying its cursor — and the withdrawal already recorded against a row must
 * survive all three.
 */
export function mergeWitnessRow(rows, row) {
  if (!row?.rkey) return rows || [];
  const list = rows || [];
  const i = list.findIndex((r) => r.rkey === row.rkey);
  if (i < 0) return sortWitness([...list, row]);
  const merged = { ...list[i], ...row };
  // A row known to be gone stays gone: the socket that reports the create can
  // reconnect and report it again, and the delete is not repeated.
  if (list[i].goneMs != null && row.goneMs == null) merged.goneMs = list[i].goneMs;
  const next = [...list];
  next[i] = merged;
  return sortWitness(next);
}

/** Fold a whole log in, one row at a time. */
export function mergeWitness(rows, incoming) {
  let out = rows || [];
  for (const row of incoming || []) out = mergeWitnessRow(out, row);
  return out;
}

/**
 * Mark a row withdrawn.
 *
 * The delete's own time is all there is to go on here — a deletion writes no
 * record and so has no TID of its own — which is why `goneMs` is the one field
 * on these rows read off the relay's clock rather than the PDS's. It is used to
 * place a strike-through on a timeline, not to measure anything.
 */
export function withdrawWitness(rows, rkey, atMs, postedAtMs) {
  if (!rkey) return rows || [];
  return (rows || []).map((r) =>
    r.rkey === rkey && r.goneMs == null
      ? { ...r, goneMs: Math.max(0, (atMs ?? postedAtMs) - postedAtMs) }
      : r,
  );
}

function sortWitness(rows) {
  return [...rows].sort((a, b) => a.offMs - b.offMs || String(a.rkey).localeCompare(String(b.rkey)));
}

/**
 * The log as the record carries it: earliest first, capped, handles filled in
 * from whatever the panel has resolved, and nothing undefined.
 *
 * Handles are stamped in at write time on purpose, the same way the measured
 * log stamps them. A DID is forever and a handle is a lease; a reader a year
 * from now wants to know who this was called at the time.
 */
export function witnessToRecord(rows, { profiles = {} } = {}) {
  return sortWitness(rows || [])
    .slice(0, WITNESS_MAX)
    .map((r) => {
      const handle = r.h || profiles[r.did]?.handle || '';
      return {
        k: r.k,
        offMs: Math.round(r.offMs),
        ...(r.rkey ? { rkey: r.rkey } : {}),
        ...(r.did ? { did: r.did } : {}),
        ...(handle ? { h: handle } : {}),
        ...(r.goneMs != null ? { goneMs: Math.round(r.goneMs) } : {}),
        ...(r.t ? { t: String(r.t).slice(0, WITNESS_TEXT_MAX) } : {}),
      };
    });
}

/** The log off a record, in the shape the panels hold it in. */
export function witnessFromRecord(witnessed) {
  if (!Array.isArray(witnessed)) return null;
  const rows = witnessed
    .filter((w) => w && KINDS.has(w.k) && typeof w.offMs === 'number')
    .map((w) => ({
      k: w.k,
      offMs: w.offMs,
      rkey: w.rkey || `${w.k}:${w.offMs}`,
      ...(w.did ? { did: w.did } : {}),
      ...(w.h ? { h: w.h } : {}),
      ...(typeof w.goneMs === 'number' ? { goneMs: w.goneMs } : {}),
      ...(w.t ? { t: w.t } : {}),
    }));
  return rows.length ? sortWitness(rows) : null;
}

/**
 * What the log adds up to, for the counters over the ticker.
 *
 * Withdrawals are counted out of the totals and counted separately, because a
 * like that was taken back is both — it isn't there any more, and it happened.
 *
 * `selfDid` drops the artist's own records, which is what every measured figure
 * on this project already does. It is not bookkeeping: the studio can reply to
 * the thread from the dashboard, and a piece that looks like it drew four
 * people when three of them were the artist is a false reading of the artwork.
 */
export function tallyWitness(rows, { selfDid = null } = {}) {
  const out = { likes: 0, reposts: 0, quotes: 0, replies: 0, people: 0, total: 0, withdrawn: 0 };
  const bucket = { like: 'likes', repost: 'reposts', quote: 'quotes', reply: 'replies' };
  // Counted through the identity join rather than off `did` alone. The alive
  // window of the first eleven pieces comes entirely from the harvest, whose
  // 255 rows carry a handle and no DID — so `if (r.did)` counted none of them,
  // and the replay's counters read "people 0" underneath a header saying 32.
  const who = identify(rows);
  const people = new Set();
  for (const r of rows || []) {
    if (selfDid && r.did === selfDid) continue;
    if (r.goneMs != null) {
      out.withdrawn += 1;
      continue;
    }
    const key = bucket[r.k];
    if (!key) continue;
    out[key] += 1;
    out.total += 1;
    const id = who(r);
    if (id) people.add(id);
  }
  out.people = people.size;
  return out;
}

/**
 * The like that ends the piece: the earliest one still standing.
 *
 * Earliest rather than latest, unlike the measurement, and for a reason worth
 * stating. The measurement runs after the seal over an index that holds only
 * survivors, so the last like before the gate is the one the artist reacted to.
 * Here the piece is still up and nothing has been closed yet — the first like
 * to land is the one that ended it, and any later one arrived during the
 * seconds it took to notice.
 */
export function breakingWitness(rows) {
  let best = null;
  for (const r of rows || []) {
    if (r.k !== 'like' || r.goneMs != null) continue;
    if (!best || r.offMs < best.offMs) best = r;
  }
  return best;
}

/** Somebody liked it and took it back, and nothing is standing against it now. */
export function withdrawnOnly(rows) {
  const list = rows || [];
  return !breakingWitness(list) && list.some((r) => r.k === 'like' && r.goneMs != null);
}

/**
 * The earliest like in the log that was cast and taken back.
 *
 * `breakingWitness` skips these, correctly: while a piece is running, a like
 * that has been deleted is not standing against it and the panel says so. Once
 * the piece is over the same row means the opposite — it is the account of a
 * like that ended a piece and then erased itself, which is the one event in this
 * project no index can be asked about afterwards.
 */
export function withdrawnWitness(rows) {
  let best = null;
  for (const r of rows || []) {
    if (r.k !== 'like' || r.goneMs == null) continue;
    if (!best || r.offMs < best.offMs) best = r;
  }
  return best;
}

/**
 * Who ended the piece, reconciling the index against the log.
 *
 * Three sources, in descending order of authority, and the third is the whole
 * reason the log is written:
 *
 *  1. **The backlink index.** A like that still exists, timed by its own record
 *     key. This is the measurement, and it wins whenever it is there.
 *  2. **A standing witnessed like.** The index lags by up to a minute and the
 *     seal happens in seconds, so a piece measured the instant it is sealed
 *     routinely has a like the index has not caught up with. Same record key,
 *     same TID clock: what is missing is the index, not the like.
 *  3. **A withdrawn witnessed like.** Somebody liked it, the artist sealed, and
 *     the like was deleted — often within the same second. Nothing survives for
 *     any index to report, and until now the studio watched that happen, wrote
 *     it to the log, and then recorded the piece as ended by "unknown" with no
 *     reaction time. Six of the first thirteen pieces lost their reaction time
 *     exactly this way, before anything was watching. This one was watched.
 *
 * `likeSurvives` says whether the like still exists, which is what the record's
 * field means and what the page's "since deleted" line is drawn from — it is
 * false in case 3 even though the timing is known. `recovered` marks a timing
 * that came from the log rather than from a like an index can still be shown,
 * and maps onto the record's `reactionRecovered`.
 *
 * @param {object} opts
 * @param {{at:number,did?:string}|null} opts.indexLike `measureWindows().breakingLike`.
 * @param {Array} opts.rows      The witnessed log.
 * @param {number} opts.postedMs When the piece went up.
 * @param {number} opts.sealedMs When it was sealed.
 * @returns {{at:number,did:string|null,handle:string,likeSurvives:boolean,recovered:boolean}|null}
 */
export function resolveBreaker({ indexLike, rows, postedMs, sealedMs }) {
  if (indexLike) {
    return {
      at: indexLike.at,
      did: indexLike.did || null,
      handle: '',
      likeSurvives: true,
      recovered: false,
    };
  }
  // A like that landed after the gate closed did not end the piece — somebody
  // liked a sealed post, which every piece keeps collecting afterwards.
  const before = (row) => {
    if (!row || !Number.isFinite(postedMs) || !Number.isFinite(sealedMs)) return false;
    return postedMs + row.offMs < sealedMs;
  };
  const standing = breakingWitness(rows);
  if (before(standing)) {
    return {
      at: postedMs + standing.offMs,
      did: standing.did || null,
      handle: standing.h || '',
      likeSurvives: true,
      recovered: false,
    };
  }
  const gone = withdrawnWitness(rows);
  if (before(gone)) {
    return {
      at: postedMs + gone.offMs,
      did: gone.did || null,
      handle: gone.h || '',
      likeSurvives: false,
      recovered: true,
    };
  }
  return null;
}

/**
 * Is this log worth writing again?
 *
 * The studio writes it to the PDS while the piece is running, so this is what
 * keeps a ticking clock from turning into a write every second. Compared on
 * what a reader would actually see change, not on object identity.
 */
export function witnessChanged(a, b) {
  const x = a || [];
  const y = b || [];
  if (x.length !== y.length) return true;
  for (let i = 0; i < x.length; i += 1) {
    if (x[i].rkey !== y[i].rkey || x[i].goneMs !== y[i].goneMs || x[i].h !== y[i].h) return true;
  }
  return false;
}
