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
 * What follow-farming looks like from outside.
 *
 * An account that follows tens of thousands of people to collect follow-backs
 * ends up with two large numbers of roughly the same size: 20,000 followers
 * against 21,000 follows. That audience is mostly reciprocal and mostly not
 * looking, so counting it at face value overstates the reach.
 *
 * All three conditions have to hold, and each rules out something the earlier
 * blanket ratio test got wrong:
 *
 *   Both sides large. Somebody with 200 followers who follows 5,000 accounts
 *     is a reader, not a farmer. They gained no audience by it, and their 200
 *     followers are as real as anyone's. The old sqrt(ratio) rule cut them to
 *     a fifth for the crime of following people.
 *   Sizes comparable. An account with 63,000 followers and 2,000 follows has
 *     an audience that chose it. That is the shape farming is defined against.
 *   Follows large in absolute terms. Nobody follows 2,000 accounts by
 *     accident, which is what separates a farmer from a mutual-heavy small
 *     community where everyone follows everyone.
 */
const FARM_MIN = 2000;
const FARM_RATIO_LO = 0.5;
const FARM_RATIO_HI = 2;

/** Does this account carry the follow-farming signature? */
export function looksFarmed(followers, follows) {
  if (typeof followers !== 'number' || typeof follows !== 'number') return false;
  if (followers < FARM_MIN || follows < FARM_MIN) return false;
  const ratio = followers / follows;
  return ratio >= FARM_RATIO_LO && ratio <= FARM_RATIO_HI;
}

/**
 * How much of a stated audience to believe.
 *
 * 1 for almost everyone. The ratio between followers and follows says less
 * about whether an audience is real than it seems to: a lurker with a lopsided
 * ratio still has whatever followers they have, and discounting them was
 * punishing people for reading widely.
 *
 * The one case worth discounting is follow-farming, where the audience is a
 * by-product of the follow list rather than of anything the account posted.
 * Those are halved. Half rather than zeroed because a farmed audience is not
 * an empty one; some of those followers are real people who will see the post.
 *
 * Like the rule it replaces, this can only ever TAKE AWAY. No account is
 * inflated for being popular, so the adjustment can't become a thumb on the
 * scale.
 */
export const FARM_PENALTY = 0.5;

export function qualityFactor(followers, follows) {
  return looksFarmed(followers, follows) ? FARM_PENALTY : 1;
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
    const farmed = looksFarmed(followers, follows);
    const quality = qualityFactor(followers, follows);
    out.push({
      ...person,
      kind,
      weight,
      followers,
      follows,
      ratio,
      farmed,
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
  const alive = windowReach(list, true);
  const after = windowReach(list, false);
  return {
    // Whether ANY window can be priced, which is what a caller asking "is there
    // a reach section to draw at all" wants...
    measurable: list.some((e) => !e.self && hasAudience(e)),
    // ...and per window, which is what a caller drawing ONE of them wants. The
    // single flag was doing both jobs, so takes 2 and 7 — nothing touched them
    // while they were alive, and both collected likes afterwards — passed the
    // filter on the alive chart and drew a zero-width bar with a confident
    // "approx. reach 0" beside an account that only acted after the seal.
    alive: { ...alive, measurable: alive.known > 0 },
    after: { ...after, measurable: after.known > 0 },
  };
}

/**
 * Everyone's audience, keyed the way the logs name them.
 *
 * There are two sources and they are deliberately complementary. A piece
 * measured since the audience field existed records each participant's
 * follower count as it reads it, at the seal — the authoritative figure, and
 * the only one that is contemporary with the piece. The dated table
 * (`backfill-ratioed-audience.mjs`) covers everybody else, and that script
 * SKIPS any account whose log already carries one, precisely so the recorded
 * figure is never overwritten by a later reading.
 *
 * Which is why anything reading only the table had a hole in it exactly the
 * size of the recent pieces: take 17's sixty-eight participants are all in
 * their own log and none of them are in the table, so the roster priced 125
 * of 199 accounts and sorted the rest to the bottom as unknown. Pass logs that
 * `applyAudience` has already been run over and both halves arrive together.
 *
 * Later takes win, so an account that turned up twice is priced at the most
 * recent reading of it. Keyed by DID and by handle, because the harvest that
 * covers the first eleven pieces predates recorded DIDs.
 */
export function audienceFromEvents(pieces, resolveEvents) {
  const out = {};
  const inOrder = [...(pieces || [])].sort((a, b) => (a.take || 0) - (b.take || 0));
  for (const p of inOrder) {
    for (const e of resolveEvents?.(p) || []) {
      if (e.self || !hasAudience(e)) continue;
      const entry = { fr: e.fr, ...(typeof e.fo === 'number' ? { fo: e.fo } : {}) };
      if (e.did) out[e.did] = entry;
      if (e.h && e.h !== '(unresolvable)') out[e.h] = entry;
    }
  }
  return out;
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

/**
 * How long after a piece an audience reading still describes the moment.
 *
 * A week. Follower counts move by a handful over seven days and by orders of
 * magnitude over two years, so a piece measured on Tuesday and read on Thursday
 * carries a figure that is true of the piece; one that ran in June 2025 and was
 * read in 2026 does not, and the page has to say which it is showing.
 */
export const AUDIENCE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Does this audience reading still describe the piece it is attached to?
 *
 * Measured against the piece rather than against today, because what makes a
 * reading stale is the gap between it and the thing it describes: a piece
 * sealed a year ago has a stale audience however recently the figures were
 * read. Unparseable dates are not fresh — an unknown gap is the case the
 * caveat exists for.
 */
export function audienceIsFresh(audienceAt, pieceAt, window = AUDIENCE_FRESH_MS) {
  const read = Date.parse(audienceAt || '');
  const anchor = Date.parse(pieceAt || '');
  if (!Number.isFinite(read) || !Number.isFinite(anchor)) return false;
  // A reading taken BEFORE the piece is fresh by definition: that is the studio
  // measuring a piece as it seals, where the clocks can land either side of it.
  return read - anchor <= window;
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

