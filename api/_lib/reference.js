// The scoring reference, loaded once and shared by everything that scores.
//
// Three handlers and now a droplet consumer all need the same thing: the newest
// finalised snapshot, turned into the lookups `createScorer` wants. That was
// copied into each of them, which is how they drifted — `mod-agent` scored
// against DEFAULT_THRESHOLDS while `mod-preflight` and `mod-audit` scored
// against the portal-tuned ones in `mod.settings`, so the analyst could report a
// different band than the Preflight tab for the same account on the same day.
// Bands the analyst cannot change are only worth something if they are the same
// bands.
//
// THE READ THAT HAS TO BE PAGED. `mod.vouch` is ~73k rows per snapshot and
// PostgREST caps a select at the project's Max rows setting (1,000 here). The
// copies all used a plain `select`, so every one of them was building the
// reference from 1.4% of the vouch table: 72,215 accounts with a real vouch
// count scored zero, landed in UNKNOWN, and were waved through. See `selectAll`
// in ./modDb.js for why that failure is invisible from the outside.

import { APPVIEW, ME_DID } from '../../src/config.js';
import {
  resolveTarget,
  resolveActor,
} from '../../src/lib/moderation/target.js';
import { harvestPost } from '../../src/lib/moderation/harvest.js';
import {
  createScorer,
  summarise,
  DEFAULT_THRESHOLDS,
} from '../../src/lib/moderation/score.js';
import { referenceFrom } from '../../src/lib/moderation/precompute.js';
import { select, selectAll } from './modDb.js';

/**
 * The newest finalised snapshot, as scorer-shaped lookups.
 *
 * Throws rather than scoring against nothing. Scoring against an empty vouch
 * table puts every account in UNKNOWN and waves the whole batch through — the
 * exact failure this system exists to prevent, wearing the costume of a
 * successful run.
 *
 * @returns {Promise<{ takenAt: string, ref: object, thresholds: object }>}
 */
export async function loadReference() {
  const latest = await select('vouch', {
    select: 'taken_at',
    order: 'taken_at.desc',
    limit: 1,
  });
  const takenAt = latest?.[0]?.taken_at;
  if (!takenAt) {
    throw new Error(
      'no finalised snapshot — run /api/mod-precompute before scoring anything',
    );
  }

  const [vouchRows, circleRows, protectedRows, settings] = await Promise.all([
    // Paged, ordered by the primary key so pages cannot overlap or skip.
    selectAll('vouch', {
      select: 'did,vouches',
      eq: { taken_at: takenAt },
      order: 'did.asc',
    }),
    selectAll('circle', {
      select: 'did',
      eq: { taken_at: takenAt },
      order: 'did.asc',
    }),
    // 954 rows today, so one page covers it — which is exactly why this one is
    // worth paging now rather than at 1,001.
    selectAll('protected', { select: 'did,reason', order: 'did.asc' }),
    select('settings', { select: 'thresholds', eq: { id: 1 } }),
  ]);

  const thresholds = settings?.[0]?.thresholds || DEFAULT_THRESHOLDS;
  return {
    takenAt,
    thresholds,
    ref: {
      ...referenceFrom({
        vouchRows,
        circleDids: circleRows.map((r) => r.did),
        protectedRows,
      }),
      thresholds,
    },
  };
}

/**
 * The read-only backends the analyst's tools call.
 *
 * Every one is a SELECT or a public AppView read. There is deliberately no
 * backend here that blocks, mutes, lists or approves: the analyst's entire
 * surface is looking, and `buildTools` in agent.js can only expose what this
 * object offers.
 *
 * Built once per reference load and shared across turns, so a conversation does
 * not re-read the vouch table for every message.
 */
export function makeIo({ ref, takenAt }) {
  const scorer = createScorer(ref);
  return {
    async preflight(link) {
      const target = await resolveTarget(link);
      const harvest = await harvestPost(target.uri);
      const scores = await scorer.score(harvest.participants.map((p) => p.did));
      const summary = summarise(harvest, scores, { excludeSelf: ME_DID });
      return {
        target,
        totals: summary.totals,
        truncated: summary.truncated,
        requiresReview: summary.requiresReview,
        autoEligible: summary.autoEligible.length,
      };
    },
    async lookUp(actor) {
      // Resolve first: score() keys its result by the exact string it is handed,
      // so a handle would come back as an unresolved account rather than as the
      // person it names.
      const did = await resolveActor(actor);
      const scored = await scorer.score([did]);
      return [...scored.values()][0] ?? null;
    },
    referenceStatus: () => ({
      snapshot: takenAt,
      scoredAccounts: ref.vouches.size,
      circleSize: ref.circle.size,
      protectedAccounts: ref.protectedSet.size,
      appview: APPVIEW,
    }),
  };
}
