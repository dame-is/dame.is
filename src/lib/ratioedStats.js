// The numbers a Ratioed piece can be asked for, and the same questions put to
// the whole series.
//
// Two sources, and the split between them is the project's oldest rule. The
// counts — replies, reposts, quotes, likes, participants — are MEASURED, once,
// at the seal, and written onto the record. They are never re-derived here,
// because a like that was cast and deleted is in no index afterwards and any
// recount would quietly report a piece as cleaner than it was. So anything
// that can be answered from `preSeal` is answered from `preSeal`.
//
// Everything else — when the first thing arrived, the longest stretch of
// nothing, who carried it furthest — is a fact about the ORDER of the log
// rather than a count of it, and the log is the only place order exists. Those
// read the events, and each returns null rather than a zero when there is no
// log to read: a piece measured before logs were kept has no first touch, and
// "0s" would be a lie about a piece that was busy.

import { REACH_WEIGHTS } from './ratioedReach.js';

const MIN = 60_000;

/** The middle value, or null for an empty list. Even lengths take the lower of
 *  the two middles — no piece ever stood for the average of two others. */
export function medianOf(nums) {
  const list = (nums || []).filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (!list.length) return null;
  return list[Math.floor((list.length - 1) / 2)];
}

/**
 * The ratio the project is named for: everything that isn't a like, against
 * the likes. Kept as two numbers rather than a quotient — the denominator is
 * almost always 1, and "80 : 1" says what happened where "80" does not.
 */
export function ratioOf(figures = {}) {
  const likes = figures.likes || 0;
  const nonLike = (figures.reposts || 0) + (figures.quotes || 0) + (figures.threadPosts || 0);
  return { nonLike, likes };
}

/** What people did, in the order the project weighs them. */
export function mixOf(figures = {}) {
  return {
    replies: figures.threadPosts || 0,
    reposts: figures.reposts || 0,
    quotes: figures.quotes || 0,
  };
}

/** Records per minute across a window. Null when the window has no length. */
export function paceOf(records, ms) {
  if (!ms || ms <= 0 || typeof records !== 'number') return null;
  return records / (ms / MIN);
}

/** The first thing that happened, and what it was. */
export function firstTouch(events) {
  const alive = (events || []).filter((e) => e.pre && !e.self);
  if (!alive.length) return null;
  return alive.reduce((first, e) => (e.off < first.off ? e : first));
}

/**
 * The longest stretch while it was alive when nothing arrived.
 *
 * Counted from the post going up and to the seal, so the wait before the first
 * thing and the hush before the like are both eligible — they are silences,
 * and on a quiet piece one of them is the longest one there was.
 */
export function longestSilence(events, lifespanMs) {
  const lifeSec = (lifespanMs || 0) / 1000;
  if (!lifeSec) return null;
  const at = (events || [])
    .filter((e) => e.pre && !e.self)
    .map((e) => e.off)
    .sort((a, b) => a - b);
  if (!at.length) return null;
  let best = { ms: 0, fromMs: 0 };
  let last = 0;
  for (const off of [...at, lifeSec]) {
    if ((off - last) * 1000 > best.ms) best = { ms: (off - last) * 1000, fromMs: last * 1000 };
    last = off;
  }
  return best.ms > 0 ? best : null;
}

/**
 * What the audience of a window looked like, by person rather than by record:
 * somebody who replied nine times is one follower count, not nine.
 *
 * The median says what a typical participant's reach was — the mean is carried
 * away by one account with ninety thousand followers, which is exactly the
 * account `top` is for.
 */
export function followerStats(events, { pre = true } = {}) {
  const byWho = new Map();
  for (const e of events || []) {
    if (e.self || Boolean(e.pre) !== pre || typeof e.fo !== 'number') continue;
    const key = e.did || `h:${e.h}`;
    const found = byWho.get(key);
    // Kept at their furthest-carrying act, weighted the way reach is weighted:
    // somebody who replied and then reposted is an amplifier by the repost,
    // and naming the reply would credit them for the wrong thing.
    if (!found || (REACH_WEIGHTS[e.k] || 0) > (REACH_WEIGHTS[found.k] || 0)) byWho.set(key, e);
  }
  const people = Array.from(byWho.values());
  if (!people.length) return null;
  const top = people.reduce((m, e) => (e.fo > m.fo ? e : m));
  return {
    median: medianOf(people.map((e) => e.fo)),
    known: people.length,
    top: { h: top.h, did: top.did || null, followers: top.fo, kind: top.k },
  };
}

/** How the log names somebody, for counting the same person across takes. A
 *  log written before DIDs were recorded has only the handle. */
const whoKey = (e) => e.did || `h:${e.h}`;

/**
 * Who had never turned up before.
 *
 * `blind` is how many earlier takes had no log to read. It is not a detail:
 * with a gap in the history everybody from that take reads as new, so the
 * caller shows this only when nothing is missing.
 */
export function newcomers(events, pieces, piece, resolveEvents) {
  const mine = new Set((events || []).filter((e) => e.pre && !e.self).map(whoKey));
  if (!mine.size) return null;
  const before = new Set();
  let blind = 0;
  for (const p of pieces || []) {
    if (!p || p.take >= piece.take) continue;
    const log = resolveEvents(p);
    if (!log?.length) {
      blind += 1;
      continue;
    }
    for (const e of log) if (e.pre && !e.self) before.add(whoKey(e));
  }
  let n = 0;
  for (const key of mine) if (!before.has(key)) n += 1;
  return { n, of: mine.size, blind };
}

/**
 * Everything one piece can say about itself.
 *
 * `resolveEvents` answers with another take's log, which only the caller can
 * do — the first eleven pieces keep theirs in a bundled harvest rather than on
 * the record. Without it the newcomer count is simply absent.
 */
export function pieceStats(piece, events, { pieces = null, resolveEvents = null } = {}) {
  if (!piece) return null;
  const life = piece.lifespanMs || 0;
  const figures = piece.preSeal || {};
  const records = ratioOf(figures).nonLike + (figures.likes || 0);
  const lifespans = (pieces || []).map((p) => p.lifespanMs).filter((ms) => ms > 0);
  const medianMs = lifespans.length > 1 ? medianOf(lifespans) : null;

  return {
    ratio: ratioOf(figures),
    mix: mixOf(figures),
    people: figures.participants || 0,
    records,
    medianMs,
    // How many times the middle of the series this one lasted. Null when it IS
    // the middle of a series of one.
    vsMedian: medianMs ? life / medianMs : null,
    first: firstTouch(events),
    silence: longestSilence(events, life),
    pace: paceOf(records, life),
    audience: followerStats(events),
    newcomers: pieces && resolveEvents ? newcomers(events, pieces, piece, resolveEvents) : null,
  };
}

/**
 * The same questions asked of the series.
 *
 * Where a piece has a first touch, the project has a typical one — the median
 * across takes, not the earliest, which would just name the busiest piece. The
 * longest silence is the opposite: one stretch, on one take, and which take is
 * half of what makes it worth printing.
 *
 * There is deliberately no "who came back" here. Counting people across takes
 * needs the roster, which merges a handle in an old log with the DID the same
 * person carries in a new one; keying the logs directly counted them twice and
 * printed 204 returning participants under a headline reading 135 involved.
 * `livingRoster` already does that join, and the caller reads it from there.
 */
export function projectStats(pieces, resolveEvents = null) {
  const list = (pieces || []).filter((p) => p.lifespanMs > 0);
  if (!list.length) return null;
  const totals = list.reduce(
    (a, p) => {
      const m = mixOf(p.preSeal);
      return {
        replies: a.replies + m.replies,
        reposts: a.reposts + m.reposts,
        quotes: a.quotes + m.quotes,
        likes: a.likes + (p.preSeal?.likes || 0),
        aliveMs: a.aliveMs + p.lifespanMs,
      };
    },
    { replies: 0, reposts: 0, quotes: 0, likes: 0, aliveMs: 0 },
  );
  const records = totals.replies + totals.reposts + totals.quotes + totals.likes;

  const logs = resolveEvents ? list.map((p) => [p, resolveEvents(p)]).filter(([, l]) => l?.length) : [];
  const firsts = logs.map(([, log]) => firstTouch(log)).filter(Boolean);
  let worst = null;
  for (const [p, log] of logs) {
    const s = longestSilence(log, p.lifespanMs);
    if (s && (!worst || s.ms > worst.ms)) worst = { ...s, take: p.take, rkey: p.rkey };
  }
  const everyone = followerStats(logs.flatMap(([, log]) => log));

  return {
    ratio: { nonLike: totals.replies + totals.reposts + totals.quotes, likes: totals.likes },
    mix: { replies: totals.replies, reposts: totals.reposts, quotes: totals.quotes },
    medianMs: medianOf(list.map((p) => p.lifespanMs)),
    pace: paceOf(records, totals.aliveMs),
    first: firsts.length ? { off: medianOf(firsts.map((e) => e.off)) } : null,
    silence: worst,
    audience: everyone,
  };
}
