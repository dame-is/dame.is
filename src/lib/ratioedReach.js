// How far a piece could have travelled, from the audiences of the people who
// carried it.
//
// Every other figure in this project is a measurement. This one is not: it is
// an INTERPRETATION of measurements, and the difference is the reason it lives
// in code rather than in a record. The inputs — how many followers each
// participant had when the piece was measured — are stamped onto the event log
// and frozen there forever, exactly like the offsets and the pre/post flag.
// The weights below are a judgement about what a repost does that a like
// doesn't, and judgements get revised. Keeping them here means revising one
// costs a deploy instead of invalidating thirteen measurements.
//
// Three things this number is not, all of which the page has to say out loud:
//
//   1. It is not impressions. Nobody outside Bluesky's own infrastructure can
//      count those. This is the size of the audience a piece was PUT IN FRONT
//      OF, which is an upper bound and generally a generous one.
//   2. It does not dedupe audiences. If two people who share most of their
//      followers both repost a piece, those followers are counted twice, and
//      there is no public data that would let anyone do better.
//   3. It is dated, and for the first thirteen pieces it is dated LATE — the
//      audience figures were taken more than a year after the pieces ran, so
//      they describe the accounts as they are now, not as they were. See
//      `audienceAt` on the record.

/**
 * What each kind of act does to a piece's audience.
 *
 * A repost puts the piece in the following feed of everyone who follows the
 * reposter: the whole audience, unqualified. A quote does the same thing and
 * arrives with the quoter's own words attached, so it is the same exposure and
 * gets the same weight — the argument for rating it higher is about attention,
 * not reach, and this number is about reach.
 *
 * A reply does not broadcast. It reaches whatever fraction of an audience finds
 * it through a thread view or through following both parties, which is small
 * and unmeasurable; 0.1 is a deliberately modest stand-in for it.
 *
 * A like propagates to nobody at all. It is not zero only because it feeds the
 * algorithmic feeds, where a piece can surface to people who follow none of the
 * accounts involved. 0.02 is that thin, indirect path and nothing more — which
 * leaves the breaking like contributing almost nothing to the reach of the
 * piece it ended.
 */
export const REACH_WEIGHTS = { repost: 1, quote: 1, reply: 0.1, like: 0.02 };

/** Every kind that carries a weight, strongest first — the order `foldAudience`
 *  resolves a person's most consequential act in. */
const BY_WEIGHT = Object.keys(REACH_WEIGHTS).sort((a, b) => REACH_WEIGHTS[b] - REACH_WEIGHTS[a]);

/**
 * Followers over follows.
 *
 * The number separates an account people chose to hear from — a ratio well
 * above 1 — from one whose followers are mostly reciprocal, where the audience
 * is a side effect of following back and correspondingly less attentive.
 *
 * Null when there is nothing to divide: an account with no follows recorded
 * hasn't been measured rather than having an infinite ratio.
 */
export function audienceRatio(followers, follows) {
  if (typeof followers !== 'number' || typeof follows !== 'number') return null;
  if (follows <= 0) return followers > 0 ? followers : null;
  return followers / follows;
}

/**
 * How much of a stated audience to believe, from its ratio.
 *
 * `sqrt`, clamped at 1, so the adjustment can only ever TAKE AWAY. An account
 * with a healthy ratio is left exactly as measured and no account is ever
 * inflated for being popular — which keeps this from becoming a thumb on the
 * scale. A 200-follower account that follows 5,000 keeps a fifth of its stated
 * audience; one that follows 200 keeps all of it.
 *
 * An unknown ratio is not a penalty: 1, meaning "no adjustment made".
 */
export function qualityFactor(ratio) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(1, Math.sqrt(ratio));
}

/** Does this event carry an audience measurement at all? */
function hasAudience(e) {
  return typeof e?.fr === 'number';
}

/**
 * Stamp audiences onto a log that predates the field.
 *
 * A piece measured today records each participant's audience as it reads it.
 * The first pieces could not: their log was harvested before this existed, and
 * it lives in `src/data/ratioedEvents.json` as a historical artefact that
 * nothing re-derives — it holds records that have since been deleted, and
 * rewriting it to add a column would put a 2026 figure inside a 2025
 * measurement with nothing to say so.
 *
 * So the audiences for those pieces sit in their own dated table
 * (`ratioedAudience.json`, written by scripts/backfill-ratioed-audience.mjs)
 * and are joined on at render. The table says when it was taken, which is the
 * only honest way to present it: those numbers describe the accounts as they
 * are now, long after the pieces they carried.
 *
 * A recorded audience always wins. An account the table doesn't know stays
 * unknown rather than becoming zero.
 */
export function applyAudience(events, table) {
  const accounts = table?.accounts;
  if (!accounts) return events || [];
  return (events || []).map((e) => {
    if (hasAudience(e)) return e;
    const found = (e.did && accounts[e.did]) || (e.h && accounts[e.h]) || null;
    if (!found || typeof found.fr !== 'number') return e;
    return { ...e, fr: found.fr, ...(typeof found.fo === 'number' ? { fo: found.fo } : {}) };
  });
}

/**
 * One entry per account per window, carrying the single strongest thing they
 * did in it.
 *
 * Per account, because an audience is exposed once however many times its owner
 * acts — somebody who reposts a piece and then replies to it twice showed it to
 * the same followers, and summing the three acts would count that audience
 * three times over.
 *
 * Per window, because the seal divides the project: the same person carrying a
 * piece while it was alive and again a year later did two different things, and
 * the whole finding depends on being able to tell them apart.
 */
export function foldAudience(events, { pre } = {}) {
  const byKey = new Map();
  for (const e of events || []) {
    if (e.self || !e.k) continue;
    if (pre != null && Boolean(e.pre) !== pre) continue;
    if (!REACH_WEIGHTS[e.k]) continue;
    const key = e.did || (e.h ? `handle:${e.h}` : null);
    if (!key) continue;
    const found = byKey.get(key);
    if (found) {
      found.kinds[e.k] = (found.kinds[e.k] || 0) + 1;
      if (e.off < found.off) found.off = e.off;
      // A later event may be the one that carries the audience figure — an
      // account resolved once per measurement, not once per record.
      if (!hasAudience(found) && hasAudience(e)) {
        found.fr = e.fr;
        found.fo = e.fo;
      }
      continue;
    }
    byKey.set(key, {
      key,
      did: e.did || null,
      handle: e.h || '',
      off: e.off,
      kinds: { [e.k]: 1 },
      ...(hasAudience(e) ? { fr: e.fr, fo: e.fo } : {}),
    });
  }

  const out = [];
  for (const person of byKey.values()) {
    const kind = BY_WEIGHT.find((k) => person.kinds[k]) || null;
    const weight = kind ? REACH_WEIGHTS[kind] : 0;
    const known = hasAudience(person);
    const followers = known ? person.fr : null;
    const follows = typeof person.fo === 'number' ? person.fo : null;
    const ratio = audienceRatio(followers, follows);
    const quality = qualityFactor(ratio);
    out.push({
      ...person,
      kind,
      weight,
      followers,
      follows,
      ratio,
      quality,
      known,
      // An unmeasured audience contributes nothing to the total, which is why
      // `unknown` is reported beside it: the total is a floor, not a finding.
      raw: known ? weight * followers : 0,
      weighted: known ? weight * followers * quality : 0,
    });
  }
  return out.sort((a, b) => b.raw - a.raw || a.off - b.off);
}

/** Empty totals, so a window with nothing in it still has a shape. */
const NO_REACH = {
  raw: 0,
  weighted: 0,
  people: 0,
  known: 0,
  unknown: 0,
  audience: 0,
  top: null,
  topShare: 0,
};

/**
 * One window's reach: the total, what it was built from, and who dominated it.
 *
 * `top` is nearly always the whole story. A piece is usually carried by exactly
 * one account with a real audience while everyone else contributes hundreds,
 * and a headline figure that doesn't say so is hiding its own provenance —
 * hence `topShare`, the fraction of the total that one person accounts for.
 */
export function windowReach(events, pre) {
  const people = foldAudience(events, { pre });
  if (!people.length) return { ...NO_REACH, contributors: [] };
  let raw = 0;
  let weighted = 0;
  let audience = 0;
  let known = 0;
  for (const p of people) {
    raw += p.raw;
    weighted += p.weighted;
    if (p.known) {
      known += 1;
      audience += p.followers;
    }
  }
  const top = people.find((p) => p.known && p.raw > 0) || null;
  return {
    raw: Math.round(raw),
    weighted: Math.round(weighted),
    people: people.length,
    known,
    unknown: people.length - known,
    // Every follower of everyone who touched it, before any weighting: the
    // ceiling the weights are discounting from.
    audience,
    top,
    topShare: top && raw > 0 ? top.raw / raw : 0,
    contributors: people,
  };
}

/**
 * A piece's reach either side of the seal.
 *
 * `measurable` is false when no event carries an audience figure at all — a
 * piece measured before this existed, or one whose participants have all
 * deactivated. The caller shows nothing rather than showing a confident zero,
 * for the same reason `fetchLiveDeltas` omits a piece it couldn't read instead
 * of reporting it as unchanged.
 */
export function pieceReach(events) {
  const list = Array.isArray(events) ? events : [];
  const measurable = list.some((e) => !e.self && hasAudience(e));
  return {
    measurable,
    alive: windowReach(list, true),
    after: windowReach(list, false),
  };
}

/**
 * The same split across the whole project.
 *
 * `events` resolves a piece's log — its own recorded one, or the bundled
 * harvest for the pieces that predate the field. Pieces with no audience data
 * are skipped and counted in `unmeasured`, so the totals never quietly include
 * a zero that means "not known".
 */
export function projectReach(pieces, resolveEvents) {
  let aliveRaw = 0;
  let aliveWeighted = 0;
  let afterRaw = 0;
  let afterWeighted = 0;
  let unmeasured = 0;
  const perPiece = [];
  for (const piece of pieces || []) {
    const reach = pieceReach(resolveEvents ? resolveEvents(piece) : piece.events);
    if (!reach.measurable) {
      unmeasured += 1;
      continue;
    }
    aliveRaw += reach.alive.raw;
    aliveWeighted += reach.alive.weighted;
    afterRaw += reach.after.raw;
    afterWeighted += reach.after.weighted;
    perPiece.push({ piece, reach });
  }
  return {
    measured: perPiece.length,
    unmeasured,
    aliveRaw,
    aliveWeighted,
    afterRaw,
    afterWeighted,
    totalRaw: aliveRaw + afterRaw,
    // The finding this whole layer exists to test: whether the pieces have
    // travelled further dead than they ever did alive.
    afterlifeShare: aliveRaw + afterRaw > 0 ? afterRaw / (aliveRaw + afterRaw) : 0,
    perPiece: perPiece.sort((a, b) => b.reach.alive.raw - a.reach.alive.raw),
  };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                           */
/* ------------------------------------------------------------------ */

/**
 * `41200` → `41.2k`. Three significant figures at most: the precision in a
 * follower count is illusory by the time it reaches a total like this, and
 * printing all six digits would claim otherwise.
 */
export function fmtReach(n) {
  const v = Math.round(Number(n) || 0);
  if (v < 1000) return String(v);
  if (v < 10000) return `${(v / 1000).toFixed(1)}k`;
  if (v < 1000000) return `${Math.round(v / 1000)}k`;
  if (v < 10000000) return `${(v / 1000000).toFixed(1)}M`;
  return `${Math.round(v / 1000000)}M`;
}

/** `12.4` → `12.4×`, `0.04` → `0.04×`. The unit is "followers per follow". */
export function fmtRatio(ratio) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return '—';
  if (ratio >= 100) return `${Math.round(ratio)}×`;
  if (ratio >= 10) return `${ratio.toFixed(1)}×`;
  return `${ratio.toFixed(2)}×`;
}
