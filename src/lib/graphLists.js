// Managed Bluesky lists drawn from the social graph: who you engage with, who
// engages with you, and who sits close to you in the follow graph. Pure: no
// fetch, no clock, no React. api/_lib/graphLists.js gathers the inputs and
// writes the result; the admin's Graph tab draws the same numbers.
//
// Two families of list, and they measure different things:
//
//   engagement   who acted toward whom in a rolling window (30 days by
//                default). Built from the same events the Analytics People tab
//                ranks: notifications inbound, your own like/repost/post
//                records outbound.
//
//   proximity    where someone sits in your follow graph, in the moderation
//                gate's own terms (src/lib/moderation/score.js). 1st degree is
//                someone you follow. 2nd degree is someone at least one of
//                your follows follows, and the moderation snapshot already
//                counts how many do: that count is the "vouch" the bands are
//                built on. So "within reach" here and CONNECTED there are the
//                same measurement, read in the other direction.
//
// What "beyond 2nd degree" means: not found. The snapshot only enumerates the
// accounts your follows follow (82k of them in November 2026). Measuring a real
// 3rd degree would mean reading the follow lists of all of those, which the
// moderation doc already rules out for the same reason.

import { distanceFrom } from './moderation/score.js';

export const GRAPH_LIST_NSID = 'is.dame.graph.list';

export const CURATE_PURPOSE = 'app.bsky.graph.defs#curatelist';

const DAY_MS = 86_400_000;

/** The rolling window, unless a list says otherwise. */
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * Most members a managed list may hold. Every member is a record write, and a
 * self-hosted PDS shares 2,600 repo events an hour with everything else on it
 * (see "What writes cost" in docs/MODERATION.md).
 */
export const MAX_LIST_SIZE = 1000;

/**
 * Writes one sync may make across every list. A first sync of a large list
 * finishes over a few runs rather than eating a whole hour's relay budget in
 * one go; the next run picks up where the diff leaves off, because the diff is
 * recomputed from what is actually on the list each time.
 */
export const MAX_WRITES_PER_RUN = 600;

export const ENGAGEMENT_EVENT_KINDS = Object.freeze([
  'like',
  'repost',
  'reply',
  'quote',
  'mention',
]);

export const LIST_KINDS = Object.freeze({
  'engaged-out': {
    label: 'People I engage with most',
    family: 'engagement',
    direction: 'out',
  },
  'engaged-in': {
    label: 'People who engage with me most',
    family: 'engagement',
    direction: 'in',
  },
  proximity: {
    label: 'Close in my graph',
    family: 'proximity',
  },
});

/**
 * Starting points for the "New list" buttons. Each is an ordinary definition;
 * nothing about a preset is remembered once it has been made.
 */
export const PRESETS = Object.freeze([
  {
    key: 'engaged-out',
    kind: 'engaged-out',
    name: 'Who I engage with',
    description:
      'The people I liked, reposted, replied to or quoted most in the last 30 days. Kept up to date automatically.',
    notFollowing: false,
    size: 50,
    minInteractions: 3,
  },
  {
    key: 'engaged-out-new',
    kind: 'engaged-out',
    name: 'Who I engage with (not followed)',
    description:
      'People I engaged with most in the last 30 days and do not follow yet. Kept up to date automatically.',
    notFollowing: true,
    size: 50,
    minInteractions: 2,
  },
  {
    key: 'engaged-in',
    kind: 'engaged-in',
    name: 'Who engages with me',
    description:
      'The people who liked, reposted, replied to or quoted me most in the last 30 days. Kept up to date automatically.',
    notFollowing: false,
    size: 50,
    minInteractions: 3,
  },
  {
    key: 'engaged-in-new',
    kind: 'engaged-in',
    name: 'Who engages with me (not followed)',
    description:
      'People who engaged with me most in the last 30 days whom I do not follow yet. Kept up to date automatically.',
    notFollowing: true,
    size: 50,
    minInteractions: 2,
  },
  {
    key: 'second-degree',
    kind: 'proximity',
    name: 'Close to my circle',
    description:
      'Accounts I do not follow that many of the people I follow do. Kept up to date automatically.',
    notFollowing: true,
    maxDegree: 2,
    size: 150,
    minVouches: 20,
  },
]);

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

/** A record key: lowercase letters, digits and hyphens, at most 64. */
export function slugKey(input) {
  return (
    String(input || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'list'
  );
}

/**
 * A definition with every field present and in range. Unknown kinds become
 * null, so a hand-edited record cannot make the sync guess.
 */
export function normalizeDefinition(input = {}) {
  const kind = LIST_KINDS[input.kind] ? input.kind : null;
  if (!kind) return null;
  const family = LIST_KINDS[kind].family;
  const kinds = Array.isArray(input.kinds)
    ? ENGAGEMENT_EVENT_KINDS.filter((k) => input.kinds.includes(k))
    : [...ENGAGEMENT_EVENT_KINDS];
  return {
    kind,
    name: String(input.name || LIST_KINDS[kind].label).slice(0, 64),
    description: String(input.description || '').slice(0, 300),
    listUri: input.listUri || null,
    enabled: input.enabled !== false,
    notFollowing: Boolean(input.notFollowing),
    size: clampInt(input.size, 1, MAX_LIST_SIZE, 50),
    windowDays: clampInt(input.windowDays, 1, 365, DEFAULT_WINDOW_DAYS),
    minInteractions:
      family === 'engagement' ? clampInt(input.minInteractions, 1, 1000, 2) : 0,
    // Outbound has no mentions (nothing records the owner mentioning someone
    // as an event), so it is dropped there rather than silently matching zero.
    kinds:
      family === 'engagement'
        ? kinds.filter((k) => !(kind === 'engaged-out' && k === 'mention'))
        : [],
    // "1st degree, not followed" is the empty set; read it as 2nd degree.
    maxDegree:
      family === 'proximity'
        ? input.notFollowing
          ? 2
          : clampInt(input.maxDegree, 1, 2, 2)
        : 0,
    minVouches:
      family === 'proximity' ? clampInt(input.minVouches, 1, 500, 3) : 0,
    // Whether membership counts as curation for the moderation gate's
    // PROTECTED veto. Off unless asked for: a hand-made curation list is a
    // deliberate act, and a list rebuilt by a cron from who replied to you
    // (pile-ons included) is not.
    protects: Boolean(input.protects),
  };
}

/** One sentence saying what a definition selects. */
export function describeRule(def) {
  const d = normalizeDefinition(def);
  if (!d) return 'Unknown list kind.';
  const top = `Up to ${d.size.toLocaleString('en-US')}`;
  const unfollowed = d.notFollowing ? ' you don’t follow yet' : '';
  if (d.kind === 'proximity') {
    if (d.maxDegree === 1) {
      return `${top} people you follow, closest first.`;
    }
    return d.notFollowing
      ? `${top} accounts you don’t follow that at least ${d.minVouches} of your follows follow.`
      : `${top} accounts you follow, then accounts at least ${d.minVouches} of your follows follow.`;
  }
  const what =
    d.kinds.length === ENGAGEMENT_EVENT_KINDS.length ||
    (d.kind === 'engaged-out' && d.kinds.length === 4)
      ? 'interactions'
      : d.kinds.map((k) => (k === 'reply' ? 'replies' : `${k}s`)).join(', ');
  const who =
    d.kind === 'engaged-out'
      ? 'people you engaged with'
      : 'people who engaged with you';
  return `${top} ${who}${unfollowed}, at least ${d.minInteractions} ${what} in the last ${d.windowDays} days.`;
}

/* ------------------------------------------------------------------ */
/* Ranking                                                              */
/* ------------------------------------------------------------------ */

/**
 * Rank the accounts behind engagement events inside a window. The same tally
 * as topActors in analytics.js, with a kind set and a floor.
 *
 * @returns {Array<{did, total, byKind}>} most engaged first, ties by DID.
 */
export function rankEngagement(
  events,
  {
    t0 = -Infinity,
    t1 = Infinity,
    kinds = ENGAGEMENT_EVENT_KINDS,
    minInteractions = 1,
    excludeDid = null,
  } = {},
) {
  const allow = new Set(kinds);
  const byDid = new Map();
  for (const ev of events || []) {
    if (!ev?.did || ev.did === excludeDid || !allow.has(ev.kind)) continue;
    const at = typeof ev.at === 'number' ? ev.at : Date.parse(ev.at);
    if (!Number.isFinite(at) || at < t0 || at > t1) continue;
    let row = byDid.get(ev.did);
    if (!row) byDid.set(ev.did, (row = { did: ev.did, total: 0, byKind: {} }));
    row.total += 1;
    row.byKind[ev.kind] = (row.byKind[ev.kind] || 0) + 1;
  }
  return [...byDid.values()]
    .filter((r) => r.total >= minInteractions)
    .sort((a, b) => b.total - a.total || (a.did < b.did ? -1 : 1));
}

/**
 * Where an account sits relative to you, in the moderation gate's terms.
 *
 * `degree` is the human number (1st, 2nd, beyond); `distance` is score.js's
 * (0, 1, 3), kept so a row here and a row in the moderation queue can be
 * compared without translating.
 */
export function placeOf(did, { following, followers, vouches }) {
  const youFollow = following?.has(did) || false;
  const followsYou = followers?.has(did) || false;
  const v = vouches?.get(did) || 0;
  const distance = distanceFrom({
    inCircle: youFollow,
    vouches: v,
    inNeighbourhood: v > 0,
  });
  const degree = distance === 0 ? 1 : distance <= 2 ? 2 : null;
  return {
    youFollow,
    followsYou,
    mutual: youFollow && followsYou,
    vouches: v,
    distance,
    degree,
  };
}

/**
 * Rank accounts by graph proximity. 1st degree (people you follow) first when
 * included, then 2nd degree by how many of your follows follow them. `boost`
 * (did → number, e.g. recent engagement) breaks ties, so of two accounts with
 * 12 vouches the one you actually talk to sorts first.
 */
export function rankProximity({
  vouches,
  following,
  maxDegree = 2,
  minVouches = 1,
  notFollowing = false,
  boost = null,
}) {
  const rows = [];
  if (!notFollowing) {
    for (const did of following || []) {
      rows.push({
        did,
        degree: 1,
        vouches: vouches?.get(did) || 0,
        boost: boost?.get(did) || 0,
      });
    }
  }
  if (maxDegree >= 2) {
    for (const [did, v] of vouches || []) {
      if (following?.has(did) || v < minVouches) continue;
      rows.push({ did, degree: 2, vouches: v, boost: boost?.get(did) || 0 });
    }
  }
  return rows.sort(
    (a, b) =>
      a.degree - b.degree ||
      b.vouches - a.vouches ||
      b.boost - a.boost ||
      (a.did < b.did ? -1 : 1),
  );
}

/**
 * Take the top `size`, but let current members hold their place against
 * newcomers who only just edge past them.
 *
 * Without this a list capped at 50 rewrites its boundary every run: whoever is
 * 50th and 51st trade places on a single like, and each swap is two record
 * writes and a churned list for anyone subscribed. An incumbent ranked within
 * `slack` places of the cut is treated as `slack` places higher, which is
 * enough to stop the flapping and not enough to keep someone who has drifted
 * well away.
 */
export function stickyTop(
  ranked,
  incumbents,
  size,
  slack = Math.ceil(size * 0.1),
) {
  const keyed = (ranked || []).map((row, i) => {
    const sitting = Boolean(incumbents?.has(row.did));
    return { row, i, sitting, eff: sitting ? i - slack : i };
  });
  // A dead heat goes to whoever is already on the list.
  keyed.sort((a, b) => a.eff - b.eff || b.sitting - a.sitting || a.i - b.i);
  return keyed.slice(0, Math.max(0, size)).map((k) => k.row);
}

/**
 * Who should be on a list right now.
 *
 * @param {object} def        a definition (normalised here)
 * @param {object} signals
 * @param {Array}  signals.inbound    inbound engagement events
 * @param {Array}  signals.outbound   outbound engagement events
 * @param {Set}    signals.following  DIDs you follow
 * @param {Map}    signals.vouches    DID → how many of your follows follow them
 * @param {Set}    [signals.excluded] never list these (you; the moderation list)
 * @param {Set}    [incumbents]       who is on the list now
 * @param {number} nowMs
 * @returns {{ rows: Array, eligible: number }} rows in list order
 */
export function selectMembers(
  def,
  signals,
  incumbents = new Set(),
  nowMs = Date.now(),
) {
  const d = normalizeDefinition(def);
  if (!d) return { rows: [], eligible: 0 };
  const {
    inbound = [],
    outbound = [],
    following = new Set(),
    vouches = new Map(),
    excluded = new Set(),
  } = signals;
  const t0 = nowMs - d.windowDays * DAY_MS;

  let ranked;
  if (d.kind === 'proximity') {
    const boost = new Map();
    for (const r of rankEngagement([...inbound, ...outbound], {
      t0,
      t1: nowMs,
    }))
      boost.set(r.did, r.total);
    ranked = rankProximity({
      vouches,
      following,
      maxDegree: d.maxDegree,
      minVouches: d.minVouches,
      notFollowing: d.notFollowing,
      boost,
    });
  } else {
    ranked = rankEngagement(d.kind === 'engaged-in' ? inbound : outbound, {
      t0,
      t1: nowMs,
      kinds: d.kinds,
      minInteractions: d.minInteractions,
    });
    if (d.notFollowing) ranked = ranked.filter((r) => !following.has(r.did));
  }
  ranked = ranked.filter((r) => !excluded.has(r.did));
  return {
    rows: stickyTop(ranked, incumbents, d.size),
    eligible: ranked.length,
  };
}

/* ------------------------------------------------------------------ */
/* The diff                                                             */
/* ------------------------------------------------------------------ */

/**
 * What to write so the list holds exactly `desired`.
 *
 * `current` is the listitem records on the list now, `{ did, uri }`. A DID
 * listed twice (two listitems for one account, which nothing stops a client
 * from making) has its extras removed; the first is kept.
 *
 * `maxWrites` caps the work. Removals go first, so a list never sits above
 * its size while a capped sync is part done; the rest waits for the next run,
 * and `pending` says how much.
 *
 * @returns {{ add: string[], remove: Array<{did, uri}>, kept: number, pending: number }}
 */
export function planSync(current, desired, { maxWrites = Infinity } = {}) {
  const want = new Set(desired);
  const seen = new Set();
  const remove = [];
  for (const item of current || []) {
    if (!item?.did) continue;
    if (!want.has(item.did) || seen.has(item.did)) remove.push(item);
    else seen.add(item.did);
  }
  const add = [...want].filter((did) => !seen.has(did));
  const total = remove.length + add.length;
  const removeNow = remove.slice(0, maxWrites);
  const addNow = add.slice(0, Math.max(0, maxWrites - removeNow.length));
  return {
    add: addNow,
    remove: removeNow,
    kept: seen.size,
    pending: total - removeNow.length - addNow.length,
  };
}

/* ------------------------------------------------------------------ */
/* The Graph tab's breakdown                                            */
/* ------------------------------------------------------------------ */

/**
 * Bucket a set of accounts by where they sit: mutual, you follow them, 2nd
 * degree strong / weak, and not found. "Strong" uses the CONNECTED line
 * (`strongVouches`, 3 by default) so the breakdown and the moderation bands
 * draw the boundary in the same place.
 */
export function degreeBreakdown(dids, ctx, { strongVouches = 3 } = {}) {
  const out = {
    mutual: 0,
    following: 0,
    strong: 0,
    weak: 0,
    beyond: 0,
    total: 0,
  };
  for (const did of dids || []) {
    const p = placeOf(did, ctx);
    out.total += 1;
    if (p.mutual) out.mutual += 1;
    else if (p.youFollow) out.following += 1;
    else if (p.vouches >= strongVouches) out.strong += 1;
    else if (p.vouches > 0) out.weak += 1;
    else out.beyond += 1;
  }
  return out;
}

export const DEGREE_BUCKETS = Object.freeze([
  { key: 'mutual', label: 'Mutuals', hint: 'You follow each other.' },
  {
    key: 'following',
    label: 'You follow',
    hint: '1st degree: you follow them; they don’t follow back.',
  },
  {
    key: 'strong',
    label: '2nd, close',
    hint: '2nd degree: 3 or more of your follows follow them (the moderation gate’s CONNECTED line).',
  },
  {
    key: 'weak',
    label: '2nd, loose',
    hint: '2nd degree: one or two of your follows follow them.',
  },
  {
    key: 'beyond',
    label: 'Further',
    hint: 'None of your follows follow them, as of the last snapshot. Not measured beyond this.',
  },
]);

/**
 * Orbit layout: a radius in [0, 1] for each account, 0 being you.
 *
 * Mutuals sit on the innermost ring, people you follow just outside it, 2nd
 * degree spread across the middle by vouch count (more vouches, closer), and
 * accounts with no measured connection on the rim. Engagement does not move
 * anyone in or out; the chart draws it as size, so "close in the graph" and
 * "talks to you a lot" stay two readable things instead of one blended score.
 */
export function orbitRadius(place, { maxVouches = 100 } = {}) {
  if (place.mutual) return 0.2;
  if (place.youFollow) return 0.32;
  if (place.vouches > 0) {
    const t = Math.log1p(place.vouches) / Math.log1p(Math.max(2, maxVouches));
    return 0.88 - 0.44 * Math.min(1, t);
  }
  return 0.96;
}
