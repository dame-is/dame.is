// One repair for a Ratioed record, in place of five.
//
// The studio and the catalogue had grown a button per defect: recover the
// reaction, put names back, backfill audiences, read the afterlife. Each was
// written the day its defect turned up, each knew a different amount about what
// it was safe to touch, and between them they left the artist choosing which
// repair a piece needed from a list of repairs — which is a thing the record
// can be asked instead.
//
// So: `pieceGaps` says what a record is missing, and `healPiece` fills those
// gaps and nothing else. Both are pure. The network calls a repair needs are
// gathered by `repairPiece` below and handed in, so what actually gets written
// is decided by a function that can be tested against a record and a fixture
// rather than against a PDS.
//
// WHAT A REPAIR MAY NOT DO. The pre-seal figures and the reaction time are the
// measurement this project exists to take, and a like cast and deleted while a
// piece was up is gone from every index — so a second reading of the alive
// window is always a smaller and later reading, never a better one. A repair
// therefore only ever:
//
//   • fills something absent (a name, a DID, a handle on a log row, a follower
//     count, a reaction time nothing had timed),
//   • or replaces the window that is DEFINED as re-readable: everything after
//     the seal, which the lexicon says keeps accruing indefinitely.
//
// Nothing it writes can overwrite a figure that was measured while the piece
// was alive. That is the whole contract, and it is why this can be one button.

import { UNRESOLVED_HANDLE, measureWindows, buildEventLog } from './ratioedDiscovery.js';
import { witnessFromRecord, resolveBreaker } from './ratioedLive.js';
import { fetchPieceRecords } from './ratioed.js';
import { resolveProfiles, resolveHandle, tidToTimestamp } from './atproto.js';
import { replayWindow, withinLookback } from './jetstream.js';

/** How far past the seal a recovery replay looks. See `recoverable` below. */
const REPLAY_TAIL_MS = 60_000;

/** `[did, handle]` pairs as a map, dropping the ones missing either half. */
export const handleMap = (pairs) =>
  Object.fromEntries((pairs || []).filter(([d, h]) => d && h && h !== UNRESOLVED_HANDLE));

/**
 * What is missing from a record, read off the record alone.
 *
 * No network, so the catalogue can count the pieces worth repairing without
 * asking an index about any of them.
 *
 * @param {object} value  A raw `is.dame.creating.ratioed.piece` record value.
 * @param {number} [nowMs]
 */
export function pieceGaps(value, nowMs = Date.now()) {
  const v = value || {};
  const b = v.breaker || {};
  const events = Array.isArray(v.events) ? v.events : [];
  const rows = witnessFromRecord(v.witnessed) || [];
  const sealed = Boolean(v.sealedAt);
  const named = Boolean(b.handle) && b.handle !== 'unknown';
  const timed = typeof b.reactionMs === 'number';

  // A witnessed like the record could be told about: standing or taken back,
  // either way it names somebody and times them.
  const postedMs = Date.parse(v.postedAt || '');
  const sealedMs = Date.parse(v.sealedAt || '');
  const witnessedLike = sealed
    ? resolveBreaker({ indexLike: null, rows, postedMs, sealedMs })
    : null;

  // Nothing is repairable on a piece that is still up: there is no seal to
  // measure an afterlife against, and every figure below arrives with it.
  if (!sealed) {
    return {
      sealed: false,
      breakerUnnamed: false,
      breakerNoDid: false,
      reactionLost: false,
      replayable: false,
      unnamedRows: 0,
      audienceMissing: false,
      afterlife: false,
      needsAName: false,
    };
  }

  return {
    sealed: true,
    // Nobody knows who ended it, and the log does.
    breakerUnnamed: !named && Boolean(witnessedLike?.handle || witnessedLike?.did),
    // Named, but by a handle alone — and the roster is keyed by DID.
    breakerNoDid: named && !b.did,
    // No reaction time, and the log has a like to take one from.
    reactionLost: !timed && Boolean(witnessedLike),
    // The same, but only a replay can answer it: 36 hours, and it has to be
    // filtered by an account, so it needs a name first.
    replayable: !timed && !witnessedLike && named && withinLookback(sealedMs, nowMs),
    // Rows that name a DID nothing could put a handle to.
    unnamedRows: events.filter((e) => e.did && (!e.h || e.h === UNRESOLVED_HANDLE)).length,
    // A log with no follower counts at all: measured before audiences were
    // recorded, or by a pass whose profile read failed.
    audienceMissing: events.length > 0 && !events.some((e) => typeof e.fr === 'number'),
    // Everything after the seal is re-readable by definition, so a sealed piece
    // always has an afterlife worth reading again.
    afterlife: true,
    // A piece nobody has named and no log can name: only a person can fix this
    // one, which is why `nameBreaker` stays a form.
    needsAName: !named && !witnessedLike,
  };
}

/** Is there anything here a repair would actually write? */
export function worthRepairing(value, nowMs = Date.now()) {
  const g = pieceGaps(value, nowMs);
  return Boolean(
    g.breakerUnnamed || g.breakerNoDid || g.reactionLost || g.replayable || g.unnamedRows || g.audienceMissing,
  );
}

/**
 * The repaired record, and a plain-language list of what changed.
 *
 * Pure: every network answer it might need is passed in, and any of them may
 * be absent — a repair with nothing to hand is a no-op that says so.
 *
 * @param {object} value                    the record as it stands
 * @param {object} [inputs]
 * @param {string} [inputs.breakerDid]      resolved from the breaker's handle
 * @param {object} [inputs.profiles]        did → { handle, followers, follows }
 * @param {Array}  [inputs.records]         backlinks as `fetchPieceRecords` returns them
 * @param {{at:number,rkey:string}} [inputs.replayLike]  a like found by replaying
 * @param {string} [inputs.at]              the timestamp to stamp, ISO
 * @param {string} [inputs.selfDid]         the artist, whose records are excluded
 * @returns {{ value: object, changes: string[] }}
 */
export function healPiece(value, inputs = {}) {
  const v = value || {};
  const { breakerDid, profiles = {}, records = null, replayLike = null, selfDid = null } = inputs;
  const at = inputs.at || new Date().toISOString();
  const postedMs = Date.parse(v.postedAt || '');
  const sealedMs = Date.parse(v.sealedAt || '');
  const rows = witnessFromRecord(v.witnessed) || [];
  const changes = [];
  const next = { ...v };

  /* --- who ended it, and how fast it was caught -------------------- */

  const b = { ...(v.breaker || {}) };
  const named = Boolean(b.handle) && b.handle !== 'unknown';
  const witnessedLike =
    Number.isFinite(postedMs) && Number.isFinite(sealedMs)
      ? resolveBreaker({ indexLike: null, rows, postedMs, sealedMs })
      : null;

  if (!named && witnessedLike?.handle) {
    b.handle = witnessedLike.handle;
    changes.push(`named @${witnessedLike.handle} from the log`);
  }
  if (!b.did && (witnessedLike?.did || breakerDid)) {
    b.did = witnessedLike?.did || breakerDid;
    changes.push('put their DID on the record');
  }
  if (typeof b.reactionMs !== 'number') {
    // The log first: it is on the record already and it watched the like land.
    // The replay second, for a piece nothing was watching.
    if (witnessedLike) {
      b.reactionMs = Math.round(sealedMs - witnessedLike.at);
      b.likeSurvives = witnessedLike.likeSurvives;
      if (witnessedLike.recovered) b.reactionRecovered = true;
      changes.push(`recovered the reaction time from the log (${(b.reactionMs / 1000).toFixed(1)}s)`);
    } else if (replayLike && Number.isFinite(replayLike.at) && replayLike.at < sealedMs) {
      b.reactionMs = Math.round(sealedMs - replayLike.at);
      b.likeSurvives = false;
      b.reactionRecovered = true;
      changes.push(`recovered the reaction time from the replay (${(b.reactionMs / 1000).toFixed(1)}s)`);
    }
  }
  if (b.handle) next.breaker = b;

  /* --- the log: names, audiences, and the afterlife ----------------- */

  // Every name this pass can reach, weakest first. A handle is not a
  // measurement, so the log's own rows, the witnessed log and a fresh profile
  // read all count, and the freshest wins.
  const known = {
    ...handleMap((v.events || []).map((e) => [e.did, e.h])),
    ...handleMap(rows.map((r) => [r.did, r.h])),
    ...handleMap(Object.entries(profiles).map(([d, p]) => [d, p?.handle])),
  };

  let events = Array.isArray(v.events) ? v.events : [];

  // The afterlife, if a fresh read was handed in. Rows recorded as `pre` are
  // kept exactly as they are — see the contract at the top of this file.
  if (records && Number.isFinite(postedMs) && Number.isFinite(sealedMs)) {
    const windows = measureWindows(records, sealedMs, selfDid);
    const fresh = buildEventLog(records, {
      postedAtMs: postedMs,
      sealedAtMs: sealedMs,
      selfDid,
      profiles,
      handles: known,
    });
    const kept = events.filter((e) => e.pre);
    const after = fresh.filter((e) => !e.pre);
    const before = events.filter((e) => !e.pre).length;
    events = [...kept, ...after].sort((a, c) => a.offMs - c.offMs);
    // Compared before they are replaced, so a repair that found nothing new
    // writes nothing at all rather than stamping a fresh `measuredAt` onto an
    // unchanged record.
    const moved =
      after.length !== before ||
      ['likes', 'reposts', 'quotes', 'threadPosts', 'participants'].some(
        (k) => (v.postSeal?.[k] || 0) !== (windows.postSeal[k] || 0),
      );
    if (moved) {
      next.postSeal = windows.postSeal;
      next.measuredAt = at;
      const delta = after.length - before;
      changes.push(
        delta > 0
          ? `read ${delta} more record${delta === 1 ? '' : 's'} since the seal`
          : delta < 0
            ? `dropped ${-delta} record${-delta === 1 ? '' : 's'} deleted since the seal`
            : 'updated the afterlife counts',
      );
    }
  }

  // Names and audiences on the rows that have neither. Both are gap-fills: a
  // row that already carries a handle keeps it, and a follower count measured
  // at the seal is never replaced by one read today.
  let renamed = 0;
  let audienced = 0;
  events = events.map((e) => {
    if (!e.did) return e;
    const p = profiles[e.did];
    const out = { ...e };
    if ((!e.h || e.h === UNRESOLVED_HANDLE) && known[e.did]) {
      out.h = known[e.did];
      renamed += 1;
    }
    if (typeof e.fr !== 'number' && typeof p?.followers === 'number') {
      out.fr = p.followers;
      if (typeof p.follows === 'number') out.fo = p.follows;
      audienced += 1;
    }
    return out;
  });
  if (renamed) changes.push(`named ${renamed} account${renamed === 1 ? '' : 's'} in the log`);
  if (audienced) {
    changes.push(`read ${audienced} audience${audienced === 1 ? '' : 's'}`);
    if (!v.audienceAt) next.audienceAt = at;
  }
  if (events.length) next.events = events;

  return { value: next, changes };
}

/**
 * Run a repair against the network and write it, if it comes to anything.
 *
 * Shared by the studio (one piece) and the catalogue (all of them), so the two
 * cannot drift into repairing different amounts. Every read is guarded: a
 * failed profile call or a backlink index that is down costs that part of the
 * repair, not the repair.
 *
 * @returns {Promise<{ changes: string[], written: boolean }>}
 */
export async function repairPiece({ agent, did, collection, rkey, value, onProgress }) {
  const say = (m) => onProgress?.(m);
  const v = value || {};
  const gaps = pieceGaps(v);
  const b = v.breaker || {};

  // A DID for a breaker who has only a name. Cheap, and it is what the roster
  // is keyed by.
  let breakerDid = null;
  if (gaps.breakerNoDid) {
    say('resolving the breaker');
    breakerDid = await resolveHandle(b.currentHandle || b.handle).catch(() => null);
  }

  // The backlinks, for the afterlife and for the DIDs to resolve.
  let records = null;
  if (gaps.afterlife) {
    say('reading the backlinks');
    records = await fetchPieceRecords(v.subject).catch(() => null);
  }

  // Profiles for everyone the log names and everyone the index just turned up.
  const dids = Array.from(
    new Set([
      ...(v.events || []).map((e) => e.did),
      ...(records || []).map((r) => r.did),
      b.did || breakerDid || null,
    ].filter(Boolean)),
  );
  let profiles = {};
  if (dids.length) {
    say('reading profiles');
    profiles = await resolveProfiles(dids).catch(() => ({}));
  }

  // The replay, only when it is the one thing that can answer for a reaction
  // time: filtered to a single account, so it reads about 0.1 MB rather than
  // the 300 MB an unfiltered window would.
  let replayLike = null;
  if (gaps.replayable) {
    const filterDid = b.did || breakerDid || (await resolveHandle(b.handle).catch(() => null));
    if (filterDid) {
      say(`replaying @${b.handle}’s likes`);
      const sealedMs = Date.parse(v.sealedAt);
      const res = await replayWindow(v.subject, {
        fromMs: Date.parse(v.postedAt),
        toMs: sealedMs + REPLAY_TAIL_MS,
        dids: [filterDid],
      }).catch(() => null);
      const like = (res?.events || [])
        .filter((e) => e.op === 'create' && e.kind === 'like')
        .map((e) => ({ ...e, at: Date.parse(tidToTimestamp(e.rkey) || e.time) }))
        .filter((e) => Number.isFinite(e.at) && e.at < sealedMs)
        .sort((a, c) => a.at - c.at)[0];
      if (like) replayLike = like;
    }
  }

  const { value: healed, changes } = healPiece(v, {
    breakerDid,
    profiles,
    records,
    replayLike,
    selfDid: did,
  });
  if (!changes.length) return { changes, written: false };

  say('writing');
  await agent.com.atproto.repo.putRecord({ repo: did, collection, rkey, record: healed });
  return { changes, written: true };
}
