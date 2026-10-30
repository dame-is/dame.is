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
//     count, a reaction time nothing had timed, the stretch of a piece the
//     witnessed log says nothing was watching),
//   • or replaces the window that is DEFINED as re-readable: everything after
//     the seal, which the lexicon says keeps accruing indefinitely.
//
// Nothing it writes can overwrite a figure that was measured while the piece
// was alive. That is the whole contract, and it is why this can be one button.

import { UNRESOLVED_HANDLE, measureWindows, buildEventLog } from './ratioedDiscovery.js';
import {
  witnessFromRecord,
  witnessFromEvents,
  witnessToRecord,
  mergeWitness,
  resolveBreaker,
} from './ratioedLive.js';
import { fetchPieceRecords, fmtDuration } from './ratioed.js';
import { resolveProfiles, resolveHandle, getPosts, tidToTimestamp } from './atproto.js';
import { replayWindow, withinLookback } from './jetstream.js';

/** How far past the seal a recovery replay looks. See `recoverable` below. */
const REPLAY_TAIL_MS = 60_000;

/**
 * Below this, a late start to the witnessed log isn't worth a replay: it is the
 * second it took the socket to open. The piece's page draws the same line
 * before it says "watching began N in".
 */
const UNWATCHED_MIN_MS = 1000;

/** How far before the post a replay of its unwatched start begins. Clock margin. */
const UNWATCHED_LEAD_MS = 5000;

/** Everything a piece can be pointed at from, which is what the live watch reads. */
const WITNESS_COLLECTIONS = ['app.bsky.feed.like', 'app.bsky.feed.repost', 'app.bsky.feed.post'];

/**
 * What an unfiltered replay may read: a floor, plus a megabyte for every second
 * of window. The three collections measured at about 0.25 MB/s on 2026-10-30,
 * so this is four times what a window should cost and a ceiling all the same.
 */
const UNWATCHED_BUDGET_FLOOR = 32 * 1024 * 1024;
const UNWATCHED_BYTES_PER_MS = 1024;

/**
 * Accounts the follow-up replay will filter to. Jetstream caps a filter list
 * and refuses the socket past it, and an unwatched start that drew more people
 * than this is better left as it is than half-read.
 */
const UNWATCHED_MAX_DIDS = 100;

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
      unwatched: false,
    };
  }

  // How much of the piece the witnessed log can speak for. A record with no
  // `witnessFromMs` was never watched at all — the whole lifespan is unwatched.
  const watchedFrom = typeof v.witnessFromMs === 'number' ? v.witnessFromMs : null;

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
    // The stretch nothing was watching, while Jetstream still holds it. The
    // live studio now replays its own late start, but a piece sealed before
    // that — or from a tab that never opened — has 36 hours.
    unwatched:
      (watchedFrom == null || watchedFrom > UNWATCHED_MIN_MS) &&
      withinLookback(postedMs - UNWATCHED_LEAD_MS, nowMs),
  };
}

/**
 * What is standing across a set of records, in the two kinds that matter.
 *
 * `stuck` is the important one and it is why the catalogue does not report a
 * gap count as "incomplete": an event row naming a DID that resolves to nothing
 * is an account that has been suspended or deleted, and no number of repairs
 * will name it. `(unresolvable)` is the record saying so, which is a finding
 * about the network rather than a defect in the record.
 */
export function gapSummary(values, nowMs = Date.now()) {
  let stuckRows = 0;
  let stuckPieces = 0;
  let needAName = 0;
  let fixable = 0;
  for (const v of values || []) {
    const g = pieceGaps(v, nowMs);
    if (!g.sealed) continue;
    if (g.unnamedRows) {
      stuckRows += g.unnamedRows;
      stuckPieces += 1;
    }
    if (g.needsAName) needAName += 1;
    // The same question `worthRepairing` asks, asked once. These two had
    // diverged by exactly the `unnamedRows` term, and that gap was doing real
    // damage: a row is recorded as unnamed because nothing could name it AT
    // MEASURE TIME, and accounts come back. Four rows across the series read as
    // permanently stuck while one of them resolves today — a repair would name
    // it and fill its follower count — and the button offered no "· N to fill"
    // to say so.
    if (worthRepairing(v, nowMs)) fixable += 1;
  }
  return { stuckRows, stuckPieces, needAName, fixable };
}

/**
 * What on the PDS exists nowhere else, record by record — the question a
 * "delete all" is actually asking.
 *
 * The bundle is two files that cover different things, and treating them as
 * one is how this went wrong. The seed holds the FIGURES of every piece sealed
 * when it was written, with the logs stripped out; the event harvest holds the
 * alive-window log of the first eleven and nothing else. A witnessed log is in
 * neither, ever: it is what the studio watched happen, and the record is the
 * only place it was written down. So a piece can be in the seed and still be
 * the only copy of its own evidence — which, for takes 12 to 35, the delete
 * dialog used to say the opposite of.
 *
 * @param {object} live  rkey → record value, as listed from the PDS
 * @param {object} bundle
 * @param {Set<string>} bundle.figures  rkeys whose figures the seed holds
 * @param {Set<string>} bundle.logs     rkeys whose event log the harvest holds
 * @returns {Array<{ rkey, take, figures: boolean, events: boolean, witnessed: boolean }>}
 *   one entry per record holding anything the bundle can't put back, in take
 *   order; each flag says that part of it is on the PDS alone
 */
export function onlyOnPds(live, { figures, logs } = {}) {
  const out = [];
  for (const [rkey, v] of Object.entries(live || {})) {
    if (!v) continue;
    const entry = {
      rkey,
      take: v.take ?? 0,
      figures: !figures?.has(rkey),
      events: Array.isArray(v.events) && v.events.length > 0 && !logs?.has(rkey),
      witnessed: Array.isArray(v.witnessed) && v.witnessed.length > 0,
    };
    if (entry.figures || entry.events || entry.witnessed) out.push(entry);
  }
  return out.sort((a, b) => a.take - b.take);
}

/** Take numbers as runs, for a sentence: `[1, 2, 3, 7, 9, 10]` → `1–3, 7, 9–10`. */
export function takeRuns(takes) {
  const sorted = [...new Set((takes || []).filter(Number.isFinite))].sort((a, b) => a - b);
  const runs = [];
  for (const t of sorted) {
    const last = runs[runs.length - 1];
    if (last && t === last[1] + 1) last[1] = t;
    else runs.push([t, t]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
}

/** Is there anything here a repair would actually write? */
export function worthRepairing(value, nowMs = Date.now()) {
  const g = pieceGaps(value, nowMs);
  return Boolean(
    g.breakerUnnamed ||
      g.breakerNoDid ||
      g.reactionLost ||
      g.replayable ||
      g.unnamedRows ||
      g.audienceMissing ||
      g.unwatched,
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
 * @param {object} [inputs.texts]           `did/rkey` → the post's own text
 * @param {Array}  [inputs.records]         backlinks as `fetchPieceRecords` returns them
 * @param {{at:number,rkey:string}} [inputs.replayLike]  a like found by replaying
 * @param {{rows:Array,fromMs:number}} [inputs.witnessReplay]  the unwatched
 *   stretch read back from Jetstream: witness rows, and the offset after
 *   postedAt from which the replay can vouch for everything
 * @param {string} [inputs.at]              the timestamp to stamp, ISO
 * @param {string} [inputs.selfDid]         the artist, whose records are excluded
 * @returns {{ value: object, changes: string[] }}
 */
export function healPiece(value, inputs = {}) {
  const v = value || {};
  const {
    breakerDid,
    profiles = {},
    texts = {},
    records = null,
    replayLike = null,
    witnessReplay = null,
    selfDid = null,
  } = inputs;
  const at = inputs.at || new Date().toISOString();
  const postedMs = Date.parse(v.postedAt || '');
  const sealedMs = Date.parse(v.sealedAt || '');
  let rows = witnessFromRecord(v.witnessed) || [];
  const changes = [];
  const next = { ...v };

  /* --- what nothing was watching -------------------------------------- */

  // First, because everything below reads the log: a like cast and taken back
  // in the minutes before the studio opened can be the like that ended the
  // piece, and it is only in the log once this has put it there.
  //
  // A fill, not a rewrite. Rows already on the record keep everything they
  // carry; what the replay adds is rows nothing saw, and the withdrawals the
  // live watch could not have recognised — it only knows a delete for a create
  // it saw, and the creates in the unwatched stretch it never did.
  if (witnessReplay && Array.isArray(witnessReplay.rows)) {
    const lifespan = sealedMs - postedMs;
    const found = witnessReplay.rows.filter((r) => !(r.offMs >= lifespan));
    const merged = mergeWitness(rows, found);
    const had = new Map(rows.map((r) => [r.rkey, r]));
    const added = merged.filter((r) => !had.has(r.rkey)).length;
    const takenBack = merged.filter(
      (r) => r.goneMs != null && (!had.has(r.rkey) || had.get(r.rkey).goneMs == null),
    ).length;
    const from = Number.isFinite(witnessReplay.fromMs) ? Math.max(0, Math.round(witnessReplay.fromMs)) : null;
    const was = typeof v.witnessFromMs === 'number' ? v.witnessFromMs : null;
    const earlier = from != null && (was == null || from < was);
    if (added || takenBack || earlier) {
      rows = merged;
      next.witnessed = witnessToRecord(merged, { profiles });
      if (earlier) next.witnessFromMs = from;
      const span = was == null ? 'the whole piece' : `the first ${fmtDuration(was)}`;
      const what = [
        `${added} record${added === 1 ? '' : 's'}`,
        ...(takenBack ? [`${takenBack} taken back`] : []),
      ].join(', ');
      changes.push(`read ${span} back from Jetstream (${what})`);
    }
  }

  /* --- who ended it, and how fast it was caught -------------------- */

  // Read once, up here, because the breaker resolution wants it too. It used to
  // be computed below, for the afterlife alone, and the like it found was
  // thrown away — so a piece sealed while the index lagged (measured with
  // `likeSurvives: false` and no reaction time) got repaired by the REPLAY
  // branch, which hard-codes "deleted", while the surviving like sat in the
  // array this call had just fetched. Past the replay's 36h window nothing was
  // fixable at all and the record said "like deleted" forever, with the exact
  // reaction time still in the index.
  const windows =
    records && Number.isFinite(postedMs) && Number.isFinite(sealedMs)
      ? measureWindows(records, sealedMs, selfDid)
      : null;

  const b = { ...(v.breaker || {}) };
  const named = Boolean(b.handle) && b.handle !== 'unknown';
  const witnessedLike =
    Number.isFinite(postedMs) && Number.isFinite(sealedMs)
      ? resolveBreaker({ indexLike: windows?.breakingLike || null, rows, postedMs, sealedMs })
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
  if (windows) {
    const fresh = buildEventLog(records, {
      postedAtMs: postedMs,
      sealedAtMs: sealedMs,
      selfDid,
      profiles,
      handles: known,
    });

    // What they said, where the AppView will still show it. A backlink index
    // carries none of this, and it is the whole of the essay's "reactions no
    // one can see" — the replies written into a thread that was already closed.
    //
    // Matched on the account and the offset rather than on position: the log is
    // sorted and drops any record whose key will not decode, so the two arrays
    // do not line up.
    const textAt = {};
    for (const r of records) {
      const t = texts[`${r.did}/${r.rkey}`];
      if (!t) continue;
      const at = Date.parse(tidToTimestamp(r.rkey) || '');
      if (Number.isFinite(at)) textAt[`${r.did}:${at - postedMs}`] = t;
    }
    for (let i = 0; i < fresh.length; i += 1) {
      const t = textAt[`${fresh[i].did}:${fresh[i].offMs}`];
      if (t) fresh[i] = { ...fresh[i], t };
    }
    const kept = events.filter((e) => e.pre);
    const wasAfter = events.filter((e) => !e.pre);
    const before = wasAfter.length;
    // Carried forward from the row this one replaces, where there is one.
    //
    // The afterlife is rebuilt from the index on every repair, which is right —
    // it is the one window that stays readable. But a rebuilt row is only ever
    // as good as what the network will answer TODAY, and two things on the old
    // row are better than that. Its `t` was read when the AppView would still
    // serve the post, so a reply whose author has since deactivated keeps what
    // it said instead of reverting to "(image, no text)". Its `fr`/`fo` were
    // read at the seal, and the project's rule everywhere else is that a
    // recorded follower count is never replaced by a later reading of the same
    // account — `backfill-ratioed-audience.mjs` skips exactly these accounts for
    // that reason. The matching predicate below is the same one `gainedText`
    // was already using a few lines down to count what it found.
    const after = fresh
      .filter((e) => !e.pre)
      .map((e) => {
        const old = wasAfter.find((o) => o.did === e.did && o.offMs === e.offMs);
        if (!old) return e;
        return {
          ...e,
          ...(old.t && !e.t ? { t: old.t } : {}),
          ...(typeof old.fr === 'number' ? { fr: old.fr } : {}),
          ...(typeof old.fo === 'number' ? { fo: old.fo } : {}),
        };
      });
    // Text is its own reason to write. A piece whose afterlife has not moved
    // since the last repair keeps the same rows, and the first repair that can
    // read what those posts SAY would otherwise have nothing to report and
    // write nothing — which is how a log of replies nobody can see ends up
    // saying "(image, no text)" for all of them.
    const gainedText = after.filter(
      (e) => e.t && !wasAfter.some((o) => o.did === e.did && o.offMs === e.offMs && o.t),
    ).length;
    events = [...kept, ...after].sort((a, c) => a.offMs - c.offMs);
    // Compared before they are replaced, so a repair that found nothing new
    // writes nothing at all rather than stamping a fresh `measuredAt` onto an
    // unchanged record.
    const moved =
      gainedText > 0 ||
      after.length !== before ||
      ['likes', 'reposts', 'quotes', 'threadPosts', 'participants'].some(
        (k) => (v.postSeal?.[k] || 0) !== (windows.postSeal[k] || 0),
      );
    if (moved) {
      next.postSeal = windows.postSeal;
      next.measuredAt = at;
      const delta = after.length - before;
      if (delta > 0) {
        changes.push(`read ${delta} more record${delta === 1 ? '' : 's'} since the seal`);
      } else if (delta < 0) {
        changes.push(`dropped ${-delta} record${-delta === 1 ? '' : 's'} deleted since the seal`);
      }
      if (gainedText) {
        changes.push(`read what ${gainedText} of them said`);
      }
      if (!delta && !gainedText) changes.push('updated the afterlife counts');
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
  if (audienced) changes.push(`read ${audienced} audience${audienced === 1 ? '' : 's'}`);
  // Stamped for any follower count this pass put on the record, not only the
  // ones the gap-fill above added. The afterlife rebuild produces rows that
  // already carry `fr`, so it never incremented `audienced` — which is how
  // takes 1–11 ended up with a full set of readings and no `audienceAt`,
  // against a lexicon that says the field is absent only when no event carries
  // an audience at all. The piece page then fell through to the dated table and
  // printed its date under counts read two days later.
  if (!v.audienceAt && events.some((e) => typeof e.fr === 'number')) next.audienceAt = at;
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

  // The stretch nothing was watching, read back while Jetstream still has it.
  // Before the profiles, so whoever it turns up gets a name with everyone else.
  let witnessReplay = null;
  if (gaps.unwatched) {
    witnessReplay = await replayUnwatched(v, say).catch(() => null);
  }

  // Profiles for everyone the log names and everyone the index just turned up.
  const dids = Array.from(
    new Set([
      ...(v.events || []).map((e) => e.did),
      ...(records || []).map((r) => r.did),
      ...(witnessReplay?.rows || []).map((r) => r.did),
      b.did || breakerDid || null,
    ].filter(Boolean)),
  );
  let profiles = {};
  if (dids.length) {
    say('reading profiles');
    profiles = await resolveProfiles(dids).catch(() => ({}));
  }

  // The text of everything after the seal that is a post. Twenty-five at a
  // time, which is the AppView's own bound, and only for the rows that could
  // carry text: a like has none and a repost is a pointer.
  const texts = {};
  const sealedAtMs = Date.parse(v.sealedAt || '');
  const posts = (records || []).filter((r) => {
    if (r.kind !== 'reply' && r.kind !== 'quote') return false;
    const at = Date.parse(tidToTimestamp(r.rkey) || '');
    return Number.isFinite(at) && at >= sealedAtMs;
  });
  if (posts.length) {
    say(`reading ${posts.length} post${posts.length === 1 ? '' : 's'}`);
    for (let i = 0; i < posts.length; i += 25) {
      const chunk = posts.slice(i, i + 25);
      const found = await getPosts(
        chunk.map((r) => `at://${r.did}/app.bsky.feed.post/${r.rkey}`),
      ).catch(() => ({}));
      for (const r of chunk) {
        const post = found[`at://${r.did}/app.bsky.feed.post/${r.rkey}`];
        if (post?.text) texts[`${r.did}/${r.rkey}`] = post.text.slice(0, 300);
      }
    }
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
    texts,
    records,
    replayLike,
    witnessReplay,
    selfDid: did,
  });
  if (!changes.length) return { changes, written: false };

  say('writing');
  await agent.com.atproto.repo.putRecord({ repo: did, collection, rkey, record: healed });
  return { changes, written: true };
}

/**
 * Read a sealed piece's unwatched stretch back off Jetstream, as witness rows.
 *
 * Two replays, because one cannot do both jobs cheaply. The first is
 * unfiltered over the stretch itself — from the post to wherever the log
 * starts — and costs what watching it would have, about a quarter of a
 * megabyte a second: it is the only way to find out who turned up, since
 * nothing on the network filters by what a record points at. The second
 * follows just those accounts to the seal, which costs next to nothing and is
 * what makes the rows true: a like cast in the unwatched stretch and taken
 * back after the studio opened was deleted in front of a watch that had never
 * seen it created, and so let it go by. Without the follow, that like would
 * be written down as standing.
 *
 * All or nothing. A replay that ran out of budget or time, or a follow it
 * could not run, returns null and the record is left as it was: a partial
 * read here would put rows on the record that look complete and are not.
 *
 * @returns {Promise<{ rows: Array, fromMs: number } | null>}
 */
export async function replayUnwatched(value, say = () => {}, replay = replayWindow) {
  const v = value || {};
  const postedMs = Date.parse(v.postedAt || '');
  const sealedMs = Date.parse(v.sealedAt || '');
  if (!v.subject || !Number.isFinite(postedMs) || !Number.isFinite(sealedMs)) return null;
  const fromMs = postedMs - UNWATCHED_LEAD_MS;
  const watchedFrom = typeof v.witnessFromMs === 'number' ? v.witnessFromMs : sealedMs - postedMs;
  const toMs = Math.min(sealedMs, postedMs + watchedFrom);
  if (!(toMs > fromMs)) return null;
  const windowMs = toMs - fromMs;

  say(`replaying the unwatched ${fmtDuration(windowMs)}`);
  const scan = await replay(v.subject, {
    fromMs,
    toMs,
    collections: WITNESS_COLLECTIONS,
    budgetBytes: UNWATCHED_BUDGET_FLOOR + windowMs * UNWATCHED_BYTES_PER_MS,
    // The server sends history at about a hundred times real time; a twentieth
    // leaves room for a slow phone parsing it.
    maxMs: Math.max(2 * 60_000, windowMs / 20),
  });
  // Where it really began. Without a first event there is no telling whether
  // the stream started where it was asked to, and so no claim to make.
  if (!scan?.reachedEnd || !scan.firstMs) return null;

  let events = scan.events;
  const dids = Array.from(new Set(events.map((e) => e.did).filter(Boolean)));
  if (dids.length && toMs < sealedMs) {
    if (dids.length > UNWATCHED_MAX_DIDS) return null;
    say(`following ${dids.length} account${dids.length === 1 ? '' : 's'} to the seal`);
    const follow = await replay(v.subject, {
      fromMs,
      toMs: sealedMs,
      dids,
      collections: WITNESS_COLLECTIONS,
    });
    if (!follow?.reachedEnd) return null;
    events = follow.events;
  }

  return {
    rows: witnessFromEvents(events, postedMs),
    fromMs: Math.max(0, Math.max(fromMs, scan.firstMs) - postedMs),
  };
}
