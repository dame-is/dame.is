// Trust and distance for one account, relative to you.
//
// This answers "what am I about to do, and who will notice" — NOT "does this
// person deserve it". Nothing here reads a post, infers intent, or judges
// behaviour. It measures social proximity, and proximity is a proxy for blast
// radius, not for harm. Someone close to you can be awful and someone distant
// can be harmless; the score is silent on both.
//
// The reason it is built this way is a measurement, not a preference. Scoring
// the existing 8,697-member block list against the 234 accounts you follow
// showed that the features which separate them best — default handle, lexicon
// diversity, verification, follower count — are all measuring "is this person an
// atproto builder in dame's circle". Against the population this tool actually
// runs on (strangers who engaged with one post) those features fire on almost
// everyone, because almost every ordinary Bluesky account looks like that. So
// they are recorded and displayed, and they are deliberately NOT summed into a
// threat number, because a threat number built from them would mostly detect
// being new to Bluesky.
//
// One number did hold up, and the bands are built on it: how many of the people
// you follow also follow this account. 97% of the accounts in the big sweep had
// zero. 44% of the ones you picked by hand had at least one. That asymmetry is
// the useful signal, and it is useful in one direction only — a vouch is good
// evidence to LEAVE SOMEONE ALONE, and the absence of one is no evidence at all,
// because most harmless strangers have none either.

import { APPVIEW, ME_DID } from '../../config.js';

/** `getRelationships` takes at most 30 `others` per call. */
const REL_BATCH = 30;

/** `getProfiles` takes at most 25 actors per call. */
const PROFILE_BATCH = 25;

export const BANDS = [
  'PROTECTED',
  'CONNECTED',
  'PERIPHERAL',
  'NOTABLE',
  'UNKNOWN',
];

/**
 * Default thresholds. Surfaced in the admin portal so they can be tuned without
 * a deploy; the numbers below are where the measured cohorts actually split.
 *
 * Against the September sweep these put 1.0% in CONNECTED, 2.2% in PERIPHERAL
 * and 1.5% in NOTABLE — 4.7% needing a named look, 95.3% passing through. Against
 * the accounts picked by hand, 54% need a look. That asymmetry is the point: the
 * gate should be nearly frictionless on strangers and hard to get past for
 * people near you.
 */
export const DEFAULT_THRESHOLDS = {
  connectedVouches: 3,
  connectedVouchesWithReach: 1,
  connectedReach: 5000,
  notableReach: 10000,
  notableActivityPostsPerDay: 20,
  notableActivityReach: 2000,
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * A 0–99 sorting key. Higher means more embedded in your world.
 *
 * This exists to ORDER a review list, not to gate an action — the band does the
 * gating. Weights are deliberately blunt; a formula tuned to three decimal
 * places would imply a precision the underlying data does not support.
 * PROTECTED accounts are given 100 so they always sort to the top.
 */
export function trustScore({
  vouches = 0,
  followers = 0,
  ageDays = 0,
  mutual = false,
  followsYou = false,
}) {
  const vouchTerm = 55 * Math.min(1, Math.log1p(vouches) / Math.log1p(12));
  const reachTerm = 25 * Math.min(1, Math.log10(1 + followers) / 5);
  const tenureTerm = 10 * Math.min(1, ageDays / 365);
  const tieTerm = mutual ? 10 : followsYou ? 5 : 0;
  return clamp(Math.round(vouchTerm + reachTerm + tenureTerm + tieTerm), 0, 99);
}

/**
 * Assign a band. Vetoes win over everything.
 *
 * `protectedReason` being set is the whole of PROTECTED — membership is decided
 * by the caller's protected set (your follows, mutuals, patrons, curation lists)
 * rather than recomputed here, so there is exactly one place to look when asking
 * why someone was spared.
 */
export function assignBand(f, thresholds = DEFAULT_THRESHOLDS) {
  if (f.protectedReason) return 'PROTECTED';
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const vouches = f.vouches || 0;
  const followers = f.followers || 0;
  if (
    vouches >= t.connectedVouches ||
    (vouches >= t.connectedVouchesWithReach && followers >= t.connectedReach)
  ) {
    return 'CONNECTED';
  }
  if (vouches >= 1) return 'PERIPHERAL';
  if (
    followers >= t.notableReach ||
    ((f.postsPerDay || 0) >= t.notableActivityPostsPerDay &&
      followers >= t.notableActivityReach)
  ) {
    return 'NOTABLE';
  }
  return 'UNKNOWN';
}

/**
 * Graph distance, as far as the precomputed sets can see it.
 *
 * 0  you follow them
 * 1  at least one account you follow follows them
 * 2  they are somewhere in the one-hop neighbourhood's own reach
 * 3  no connection found within what we precomputed
 *
 * Note the ceiling: 3 means "not found", not "three hops away". Establishing a
 * real distance of 3+ would mean walking the follow graph of ~73k accounts,
 * which is not worth what it would cost to learn something the bands do not use.
 */
export function distanceFrom({ inCircle, vouches, inNeighbourhood }) {
  if (inCircle) return 0;
  if (vouches > 0) return 1;
  if (inNeighbourhood) return 2;
  return 3;
}

async function getJson(url, fetchImpl, signal) {
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal,
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Build a scorer over a set of precomputed reference data.
 *
 * Everything the scorer needs about YOU is injected rather than fetched, for two
 * reasons: it makes the whole thing testable without a network, and it means the
 * same code runs against a JSON snapshot on a laptop and against Supabase in a
 * cron without knowing the difference.
 *
 * @param {object} ref
 * @param {Map<string, number>} ref.vouches       did -> how many of your circle follow them
 * @param {Set<string>} ref.circle                accounts you follow
 * @param {Map<string, string>} ref.protectedSet  did -> reason ("patron", "mutual", "list:Noticing")
 * @param {Set<string>} [ref.neighbourhood]       the one-hop reach, for distance 2
 * @param {Set<string>} [ref.alreadyListed]       already on the mod list
 * @param {object} [ref.thresholds]
 */
export function createScorer(
  ref,
  { fetchImpl = fetch, appview = APPVIEW } = {},
) {
  const {
    vouches = new Map(),
    circle = new Set(),
    protectedSet = new Map(),
    neighbourhood = new Set(),
    alreadyListed = new Set(),
    thresholds = DEFAULT_THRESHOLDS,
  } = ref;

  async function profiles(dids, signal) {
    const out = new Map();
    for (let i = 0; i < dids.length; i += PROFILE_BATCH) {
      const q = dids
        .slice(i, i + PROFILE_BATCH)
        .map((d) => `actors=${encodeURIComponent(d)}`)
        .join('&');
      const body = await getJson(
        `${appview}/xrpc/app.bsky.actor.getProfiles?${q}`,
        fetchImpl,
        signal,
      );
      for (const p of body?.profiles || []) out.set(p.did, p);
    }
    return out;
  }

  /**
   * Mutual-follow state between you and each account, in batches of 30.
   *
   * Unauthenticated on purpose — `getRelationships` needs no auth, so the
   * scorer never has to hold a session to answer the question that matters most
   * for a veto.
   */
  async function relationships(dids, signal) {
    const out = new Map();
    for (let i = 0; i < dids.length; i += REL_BATCH) {
      const batch = dids.slice(i, i + REL_BATCH);
      const q = batch.map((d) => `others=${encodeURIComponent(d)}`).join('&');
      const body = await getJson(
        `${appview}/xrpc/app.bsky.graph.getRelationships?actor=${encodeURIComponent(ME_DID)}&${q}`,
        fetchImpl,
        signal,
      );
      for (const r of body?.relationships || []) {
        if (!r?.did) continue;
        out.set(r.did, {
          youFollow: Boolean(r.following),
          followsYou: Boolean(r.followedBy),
        });
      }
    }
    return out;
  }

  return {
    /**
     * Score a list of DIDs.
     *
     * @returns {Promise<Map<string, object>>} did -> { band, trust, distance, ... }
     */
    async score(dids, { signal } = {}) {
      const unique = [...new Set(dids)];
      const [profs, rels] = await Promise.all([
        profiles(unique, signal),
        relationships(unique, signal),
      ]);

      const out = new Map();
      for (const did of unique) {
        const p = profs.get(did);
        const rel = rels.get(did) || { youFollow: false, followsYou: false };
        const v = vouches.get(did) || 0;
        const ageDays = p?.createdAt
          ? Math.round((Date.now() - Date.parse(p.createdAt)) / 86400000)
          : null;
        const followers = p?.followersCount ?? 0;
        const mutual = rel.youFollow && rel.followsYou;

        // A protected reason can come from the injected set or be implied by
        // the live relationship — you cannot have automated tooling act on
        // someone you follow, whether or not the snapshot has caught up.
        const protectedReason =
          protectedSet.get(did) ||
          (rel.youFollow ? 'you follow them' : null) ||
          (circle.has(did) ? 'in your circle snapshot' : null);

        const features = {
          vouches: v,
          followers,
          follows: p?.followsCount ?? 0,
          posts: p?.postsCount ?? 0,
          ageDays,
          postsPerDay:
            ageDays && ageDays > 1 && p?.postsCount
              ? Number((p.postsCount / ageDays).toFixed(2))
              : null,
          mutual,
          followsYou: rel.followsYou,
          youFollow: rel.youFollow,
          protectedReason,
        };

        out.set(did, {
          did,
          handle: p?.handle ?? null,
          displayName: p?.displayName ?? null,
          missing: !p,
          band: assignBand(features, thresholds),
          trust: protectedReason ? 100 : trustScore(features),
          distance: distanceFrom({
            inCircle: rel.youFollow || circle.has(did),
            vouches: v,
            inNeighbourhood: neighbourhood.has(did),
          }),
          alreadyListed: alreadyListed.has(did),
          ...features,
        });
      }
      return out;
    },
  };
}

/**
 * Join a harvest to scores and summarise it — the shape the portal, the brief,
 * and the DM reply all render from.
 *
 * `requiresReview` is everything that is not UNKNOWN. That is the list a person
 * is expected to actually read, and keeping it small is the design constraint on
 * every threshold above: if it is routinely longer than a screen, the thresholds
 * are wrong, because a review nobody reads is not a review.
 */
export function summarise(harvest, scores, { excludeSelf = null } = {}) {
  const rows = harvest.participants
    .filter((p) => p.did !== excludeSelf)
    .map((p) => ({ ...p, ...(scores.get(p.did) || { band: 'UNKNOWN' }) }));

  const byBand = Object.fromEntries(BANDS.map((b) => [b, 0]));
  for (const r of rows) byBand[r.band] = (byBand[r.band] || 0) + 1;

  const requiresReview = rows
    .filter((r) => r.band !== 'UNKNOWN')
    .sort((a, b) => b.trust - a.trust);

  return {
    uri: harvest.uri,
    harvestedAt: harvest.harvestedAt,
    truncated: harvest.truncated,
    totals: {
      ...harvest.totals,
      participants: rows.length,
      byBand,
      reviewReach: requiresReview.reduce((n, r) => n + (r.followers || 0), 0),
    },
    rows,
    requiresReview,
    autoEligible: rows.filter((r) => r.band === 'UNKNOWN'),
  };
}
