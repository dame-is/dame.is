// One person's participation in Ratioed, gathered across every piece.
//
// The participants table on the essay is a ranking: one row per person, one
// number per column, sorted. That is the right shape for "who turned up most"
// and the wrong one for "what did THIS person actually do" — which takes are
// theirs, in what order, how fast they got there, and which of their acts
// landed on a post that was already over.
//
// Nothing here re-measures anything. It reads the same two sources the rest of
// the project reads — the roster (src/data/ratioedPeople.json, extended by the
// build) and the event logs (each piece's own, or the bundled harvest for the
// eleven that predate the field) — and re-cuts them by person instead of by
// piece.
//
// The roster is authoritative about WHICH takes somebody was in: it counts by
// DID, and it holds people whose records have since been deleted. The logs are
// authoritative about WHEN and WHAT. So takes come from both and are unioned,
// and a take the roster names with no log behind it renders as a take with
// nothing to say rather than disappearing.

import { RATIOED_PATH } from '../config.js';
import { identifyAcross, UNRESOLVED } from './ratioedIdentity.js';
import { brokenTakes } from './ratioed.js';

/** A person's own URL segment. The handle, which is what a reader has. */
export function participantSlug(person) {
  return person?.h && person.h !== UNRESOLVED ? person.h : '';
}

/** Where a participant's page lives, under whichever segment the essay is at. */
export function participantPath(person, parent = RATIOED_PATH) {
  const slug = participantSlug(person);
  return slug ? `/creating/${parent}/participant/${encodeURIComponent(slug)}` : null;
}

/**
 * The roster row a URL segment names, or null.
 *
 * Matched on handle first — that is what the URL carries and what a reader
 * would type — and on DID as well, so a link written from a record key still
 * resolves. Handles are compared case-insensitively because they are, and with
 * a leading `@` tolerated because people paste them that way.
 *
 * A handle two roster entries share (the placeholder for deactivated accounts)
 * is deliberately not resolvable: there is no way to say which of them was
 * meant, and picking one would credit somebody with another person's acts.
 */
export function findParticipant(rows, ref) {
  const raw = String(ref ?? '').trim().replace(/^@/, '');
  if (!raw) return null;
  const list = Array.isArray(rows) ? rows : [];
  const byDid = list.find((p) => p.did === raw);
  if (byDid) return byDid;
  const wanted = raw.toLowerCase();
  const hits = list.filter((p) => String(p.h || '').toLowerCase() === wanted);
  return hits.length === 1 ? hits[0] : null;
}

/** Does this piece's announcement name this person as its breaker? */
function brokeIt(person, piece) {
  const b = piece?.breaker;
  if (!b?.handle || b.handle === 'unknown') return false;
  if (brokenTakes(person).includes(piece.take)) return true;
  if (person.did && b.did) return person.did === b.did;
  return person.h === b.handle || person.h === b.currentHandle;
}

/**
 * A `row => boolean` test for "is this log row this person's".
 *
 * Three ways to be sure, in order of how much the row knows about itself:
 * a DID on both sides settles it outright; a handle on both sides settles it
 * where the row has no DID to contradict with; and a did-less row whose handle
 * some other log has tied to this person's DID is theirs too, which is the case
 * that lets the harvest behind takes 1–11 be read at all.
 *
 * The artist's own records are skipped, as they are everywhere else here.
 */
function belongsTo(person, who) {
  const did = person?.did && !String(person.did).startsWith('handle:') ? person.did : null;
  const handle = person?.h && person.h !== UNRESOLVED ? person.h : null;
  return (row) => {
    if (!row || row.self) return false;
    if (did && row.did) return row.did === did;
    if (handle && row.h && row.h === handle) return true;
    return did ? who(row) === did : false;
  };
}

function tally(acts) {
  const kinds = {};
  for (const a of acts) kinds[a.k] = (kinds[a.k] || 0) + 1;
  return kinds;
}

/**
 * Everything one person did, per piece and in total.
 *
 * `resolveEvents` hands back a piece's log — its own recorded one, the bundled
 * harvest, or the two composed. Pieces are read in take order, so `takes` reads
 * as a history rather than as whatever order the records arrived in.
 *
 * Every count here is split by window and the two are never added together.
 * That is the same rule the pieces themselves are measured under, and it is the
 * whole point of this page: being there while a post was alive and touching it
 * a year after it was sealed are different things, and only the first makes
 * somebody a participant.
 */
export function participantDossier(person, { pieces, resolveEvents } = {}) {
  const list = [...(pieces || [])].sort((a, b) => (a.take || 0) - (b.take || 0));
  const logs = list.map((p) => resolveEvents?.(p) || p.events || []);
  const who = identifyAcross(logs);
  const isTheirs = belongsTo(person, who);

  const byTake = new Map();
  const enter = (take, piece) => {
    const found = byTake.get(take);
    if (found) return found;
    const fresh = {
      take,
      piece: piece || null,
      alive: [],
      after: [],
      broke: piece ? brokeIt(person, piece) : false,
      // The one act that is in no index: a breaking like its caster deleted.
      likeGone: false,
    };
    byTake.set(take, fresh);
    return fresh;
  };

  list.forEach((piece, i) => {
    const rows = logs[i] || [];
    const mine = rows.filter(isTheirs);
    const broke = brokeIt(person, piece);
    if (!mine.length && !broke) return;
    const slot = enter(piece.take, piece);
    slot.likeGone = broke && piece.breaker?.likeSurvives === false;
    for (const row of mine) {
      const act = {
        take: piece.take,
        rkey: piece.rkey,
        k: row.k,
        off: row.off,
        pre: Boolean(row.pre),
        ...(row.t ? { t: row.t } : {}),
      };
      (act.pre ? slot.alive : slot.after).push(act);
    }
    slot.alive.sort((a, b) => a.off - b.off);
    slot.after.sort((a, b) => a.off - b.off);
  });

  // The roster's own take lists, for anything the logs can't answer for: a
  // piece measured before event logs were recorded and never repaired, or a
  // person whose records were deleted after the harvest counted them.
  for (const take of person?.pre || []) {
    const slot = enter(take, list.find((p) => p.take === take));
    slot.wasAlive = true;
  }
  for (const take of person?.post || []) enter(take, list.find((p) => p.take === take));

  const takes = [...byTake.values()].sort((a, b) => a.take - b.take);
  for (const t of takes) {
    // `wasAlive` is the roster's word for it and outranks an empty log.
    t.wasAlive = Boolean(t.wasAlive || t.alive.length || t.broke);
  }

  const alive = takes.flatMap((t) => t.alive);
  const after = takes.flatMap((t) => t.after);
  const liveTakes = takes.filter((t) => t.wasAlive);

  return {
    takes,
    // What the participants table ranks by: pieces they were in while the post
    // was still standing. An afterlife visit is recorded below and counts
    // towards nothing.
    live: liveTakes.length,
    afterOnly: takes.filter((t) => !t.wasAlive).length,
    acts: alive.length,
    afterActs: after.length,
    kinds: tally(alive),
    afterKinds: tally(after),
    broke: takes.filter((t) => t.broke).map((t) => t.take),
    likeGone: takes.some((t) => t.likeGone),
    // The first piece they ever turned up for, and the fastest they ever got
    // to one. Different questions: the first is a date, the second is a
    // reflex, and on a project measured in seconds the reflex is the finding.
    debut: liveTakes[0] || null,
    quickest: alive.length ? alive.reduce((a, b) => (b.off < a.off ? b : a)) : null,
  };
}

/**
 * How many records somebody made while a piece was still standing.
 *
 * Read off the living window of the event logs, which `livingRoster` has
 * already resolved onto the row. Null rather than zero when no log covers
 * them: a person the logs can't answer for has an unknown count, and printing
 * a zero would report them as somebody who turned up and did nothing.
 */
export function liveRecords(person) {
  const kinds = person?.liveKinds;
  if (kinds) return Object.values(kinds).reduce((sum, n) => sum + n, 0);
  // A breaker named by an announcement rather than measured. Their like is the
  // only record there is, and `ev` already counts it — as 0 when it was
  // deleted, which is the point of it having been deleted.
  if (person?.named) return person.ev || 0;
  return null;
}

/** The middle value of a sorted list of numbers, or null for an empty one. */
function median(values) {
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
}

/**
 * The living roster as a ranking, with the figures a leaderboard needs.
 *
 * `audiences` is the DID/handle → follower map the reach layer builds; a person
 * it can't price carries `fr: -1` rather than 0, so the unknown sort to the
 * bottom instead of tying with the accounts nobody follows.
 *
 * Ranked by pieces, then by records, then by handle. Three keys rather than
 * one because the first two tie constantly — a hundred and thirty of the people
 * here were in exactly one piece — and a ranking that leaves ties to the array
 * order reshuffles itself every time anything re-renders it.
 */
export function participantBoard(rows, { audiences, sort = 'live', dir = -1 } = {}) {
  const priced = (rows || []).map((p) => {
    const found = audiences ? audiences[p.did] || audiences[p.h] : null;
    return {
      ...p,
      fr: typeof found?.fr === 'number' ? found.fr : -1,
      records: liveRecords(p),
    };
  });
  const rank = (a, b) => b.live - a.live || (b.records || 0) - (a.records || 0) || a.h.localeCompare(b.h);
  const ranked = [...priced].sort(rank).map((p, i) => ({ ...p, rank: i + 1 }));

  const key = sort;
  const ordered =
    key === 'live'
      ? dir === -1
        ? ranked
        : [...ranked].reverse()
      : [...ranked].sort((a, b) => {
          const A = a[key];
          const B = b[key];
          const cmp = typeof A === 'string' ? A.localeCompare(B) : (A ?? -1) - (B ?? -1);
          return cmp * dir || rank(a, b);
        });

  const audienceValues = ranked.filter((p) => p.fr >= 0).map((p) => p.fr).sort((a, b) => a - b);
  const counted = ranked.filter((p) => p.records != null);

  return {
    rows: ordered,
    ranked,
    totals: {
      people: ranked.length,
      // Coming back is the finding the ranking exists to show: most people turn
      // up once, and the ones who return are a different population.
      returned: ranked.filter((p) => p.live > 1).length,
      once: ranked.filter((p) => p.live === 1).length,
      breakers: ranked.filter((p) => brokenTakes(p).length).length,
      records: counted.reduce((sum, p) => sum + p.records, 0),
      // Held back when any row's count is unknown, so a total is never quietly
      // short by however many people no log covers.
      recordsBlind: ranked.length - counted.length,
      audience: audienceValues.reduce((sum, n) => sum + n, 0),
      medianAudience: median(audienceValues),
      unpriced: ranked.length - audienceValues.length,
      mostPieces: ranked[0] || null,
      biggestAudience: audienceValues.length
        ? ranked.reduce((top, p) => (p.fr > (top?.fr ?? -1) ? p : top), null)
        : null,
    },
  };
}
