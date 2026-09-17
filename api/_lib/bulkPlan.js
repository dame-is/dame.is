// The bulk operation, behind the gate that exists because of it.
//
// This is the thing the old tool did in one step: take a post, walk everyone who
// touched it, add them all to a modlist. A September sweep that way added 8,473
// accounts in a day, 275 of them followed by someone dame follows, none of them
// looked at. The capability is genuinely useful; what it lacked was a moment
// between "do this" and "done".
//
// So it is two commands, not one:
//
//   add likers <post>          -> harvest, score, write an UNAPPROVED plan,
//                                 reply with the counts by band
//   approve <code> <bands>     -> create the listitems for those bands only
//
// CONSENT IS PER BAND, NOT PER ACCOUNT. That is what mod.plan.approved_bands has
// always modelled, and it is what makes "my system decided this, I did not
// review you personally" an accurate sentence rather than a convenient one.
// Approving UNKNOWN is a claim about a category dame can defend; approving 400
// individuals she never saw is not.
//
// THE MODEL IS NOT IN THIS FILE. The post comes from dame's own message, the
// participants come from Constellation, the bands come from score.js, and the
// approval is dame's literal typed code. A prompt-injected turn cannot reach any
// of it — see src/lib/moderation/command.js.
//
// PROTECTED IS NEVER CARRIED, whatever is approved. The veto is checked here as
// well as in the parser, because this is where the record gets created.

import crypto from 'node:crypto';

import { APPVIEW, ME_DID } from '../../src/config.js';
import { resolveActor } from '../../src/lib/moderation/target.js';
import { resolveTarget } from '../../src/lib/moderation/target.js';
import { harvestPost } from '../../src/lib/moderation/harvest.js';
import {
  createScorer,
  summarise,
  BANDS,
} from '../../src/lib/moderation/score.js';
import { KINDS } from '../../src/lib/moderation/command.js';
import { selectAll, upsert, update } from './modDb.js';
import { loadReference } from './reference.js';
import { listUri } from './listWrite.js';

/**
 * How many listitems one `approve` will create.
 *
 * 500 creates is 1,500 points against a 5,000/hour ceiling, which leaves room
 * for the bot to also answer DMs and post replies in the same hour. Approving
 * again continues where it stopped, so the cap costs a second message rather
 * than a truncated result.
 */
export const PER_APPROVAL = 500;

const BATCH = 50;

/** Short enough to retype in a DM, long enough not to collide. */
const shortCode = (uuid) => uuid.replace(/-/g, '').slice(0, 8);

/** Does this participant match the requested engagement kind? */
function matchesKind(row, kind) {
  const wanted = KINDS[kind];
  if (!wanted) return true; // everyone
  return wanted.some((k) => (row.engagements || {})[k] > 0);
}

/**
 * Harvest a post, score everyone on it, and store an unapproved plan.
 *
 * @returns {Promise<{code, uri, kind, total, byBand, truncated, protectedCount}>}
 */
export async function proposePlan({ link, kind }) {
  const target = await resolveTarget(link);
  const harvest = await harvestPost(target.uri);
  const { ref, takenAt } = await loadReference();
  const scorer = createScorer(ref);

  const scores = await scorer.score(harvest.participants.map((p) => p.did));
  const summary = summarise(harvest, scores, { excludeSelf: ME_DID });

  // The kind filter runs AFTER scoring so the stored plan records the band of
  // everyone on the post, not only the slice being asked about. Re-reading an
  // old plan then answers "who else was there" without a second harvest.
  const chosen = summary.rows.filter((r) => matchesKind(r, kind));

  const planId = crypto.randomUUID();
  const byBand = Object.fromEntries(BANDS.map((b) => [b, 0]));
  for (const r of chosen) byBand[r.band] = (byBand[r.band] || 0) + 1;

  await upsert('plan', [
    {
      id: planId,
      created_at: new Date().toISOString(),
      approved_at: null,
      approved_bands: null,
      totals: {
        ...summary.totals,
        kind,
        selected: chosen.length,
        byBand,
        snapshot: takenAt,
        truncated: summary.truncated,
      },
      note: `bulk ${kind} from ${target.uri}`,
    },
  ]);

  // One decision row per account, with the inputs that produced the band. This
  // is the answer to "why am I on your list", written BEFORE anything is
  // approved so a plan that is never approved is still a record of what was
  // nearly done.
  await upsert(
    'decision',
    chosen.map((r) => ({
      plan_id: planId,
      did: r.did,
      band: r.band,
      trust: r.trust ?? null,
      distance: r.distance ?? null,
      vouches: r.vouches ?? null,
      action: null,
    })),
  );

  return {
    code: shortCode(planId),
    planId,
    uri: target.uri,
    kind,
    total: chosen.length,
    byBand,
    // Per-kind counts, so a scan can say "15 likes, 1 repost" rather than only
    // a participant total.
    engagements: summary.totals?.engagements || {},
    truncated: summary.truncated,
    protectedCount: byBand.PROTECTED || 0,
  };
}

/** Find a plan by its short code. */
export async function findPlan(code) {
  const rows = await selectAll('plan', {
    select: 'id,created_at,approved_at,approved_bands,totals,note',
    order: 'created_at.desc',
  });
  return (
    rows.find((p) => shortCode(p.id) === String(code).toLowerCase()) ?? null
  );
}

/**
 * Create listitems for the approved bands.
 *
 * Resumable and idempotent: rows already carrying `acted_at` are skipped, so
 * running `approve` again continues rather than duplicating. Stops at
 * PER_APPROVAL and says how many are left.
 */
export async function applyPlan(agent, plan, bands) {
  const uri = listUri();
  const bot = agent.session?.did;
  if (!uri.startsWith(`at://${bot}/`)) {
    return {
      ok: false,
      message:
        'That list is not owned by this account, so I cannot write to it. ' +
        'Point MOD_LIST_URI at the migrated list.',
    };
  }

  // PROTECTED is dropped here as well as in the parser. This is where the
  // record is created, and a veto that is only enforced upstream is a veto that
  // holds until someone adds a second caller.
  const wanted = bands.filter((b) => b !== 'PROTECTED' && BANDS.includes(b));
  if (!wanted.length) {
    return {
      ok: false,
      message: `Name the bands: ${BANDS.filter((b) => b !== 'PROTECTED').join(', ')}.`,
    };
  }

  const rows = await selectAll('decision', {
    select: 'did,band,acted_at',
    eq: { plan_id: plan.id },
    order: 'did.asc',
  });
  const pending = rows.filter((r) => wanted.includes(r.band) && !r.acted_at);
  if (!pending.length) {
    return {
      ok: true,
      added: 0,
      remaining: 0,
      message: 'Nothing left to add for those bands.',
    };
  }

  const slice = pending.slice(0, PER_APPROVAL);
  let added = 0;
  let failed = 0;

  for (let i = 0; i < slice.length; i += BATCH) {
    const batch = slice.slice(i, i + BATCH);
    try {
      await agent.com.atproto.repo.applyWrites({
        repo: bot,
        writes: batch.map((r) => ({
          $type: 'com.atproto.repo.applyWrites#create',
          collection: 'app.bsky.graph.listitem',
          value: {
            $type: 'app.bsky.graph.listitem',
            subject: r.did,
            list: uri,
            createdAt: new Date().toISOString(),
          },
        })),
      });
      const now = new Date().toISOString();
      await upsert(
        'decision',
        batch.map((r) => ({
          plan_id: plan.id,
          did: r.did,
          band: r.band,
          action: 'list_add',
          acted_at: now,
          approved_via: 'band',
        })),
      );
      added += batch.length;
    } catch (err) {
      failed += batch.length;
      const message = String(err?.message || err);
      // A rate limit means stop, not retry. The remaining budget is gone and
      // approving again in an hour is the correct backoff.
      if (/rate ?limit/i.test(message)) {
        return {
          ok: true,
          added,
          remaining: pending.length - added,
          message: `Added ${added}. Hit the write rate limit. Send "approve ${shortCode(plan.id)} ${wanted.join(',')}" again in an hour for the remaining ${pending.length - added}.`,
        };
      }
    }
  }

  await update(
    'plan',
    { eq: { id: plan.id } },
    {
      approved_at: plan.approved_at || new Date().toISOString(),
      approved_bands: wanted,
    },
  );

  const remaining = pending.length - added;
  return {
    ok: true,
    added,
    failed,
    remaining,
    message:
      `Added ${added} to the list${failed ? `, ${failed} failed` : ''}.` +
      (remaining
        ? ` ${remaining} left. Send "approve ${shortCode(plan.id)} ${wanted.join(',')}" again to continue.`
        : ''),
  };
}

/** Mark a plan as declined, so the log records the decision not to act. */
export async function cancelPlan(plan) {
  await update(
    'plan',
    { eq: { id: plan.id } },
    {
      approved_at: new Date().toISOString(),
      approved_bands: [],
      note: `${plan.note || ''} (cancelled)`,
    },
  );
}

export { shortCode };

/** Handles for a page of DIDs, 25 at a time, best effort. */
async function handlesFor(dids) {
  const out = new Map();
  for (let i = 0; i < dids.length; i += 25) {
    const q = dids
      .slice(i, i + 25)
      .map((d) => `actors=${encodeURIComponent(d)}`)
      .join('&');
    try {
      const res = await fetch(
        `${APPVIEW}/xrpc/app.bsky.actor.getProfiles?${q}`,
      );
      if (!res.ok) continue;
      const body = await res.json();
      for (const p of body?.profiles || []) {
        out.set(p.did, {
          handle: p.handle,
          followers: p.followersCount ?? null,
        });
      }
    } catch {
      // A profile we cannot fetch still has a DID and a band, which is the part
      // that matters. Reviewing with a DID instead of a handle is ugly, not wrong.
    }
  }
  return out;
}

/**
 * The accounts in a plan that are worth a person's attention.
 *
 * Defaults to everything that is not UNKNOWN, sorted by trust, because that is
 * the review queue the whole system is built around: the accounts most embedded
 * in dame's world read first, so if attention runs out it runs out in the right
 * place.
 *
 * DM ONLY. This prints handles and follower counts; the public reply path must
 * never reach it.
 */
export async function reviewPlan(plan, { bands = null, limit = 15 } = {}) {
  const rows = await selectAll('decision', {
    select: 'did,band,trust,vouches,acted_at',
    eq: { plan_id: plan.id },
    order: 'did.asc',
  });
  const wanted = bands?.length
    ? rows.filter((r) => bands.includes(r.band))
    : rows.filter((r) => r.band !== 'UNKNOWN');
  const sorted = wanted.sort((a, b) => (b.trust ?? 0) - (a.trust ?? 0));
  const page = sorted.slice(0, limit);
  const profiles = await handlesFor(page.map((r) => r.did));
  return {
    total: sorted.length,
    shown: page.length,
    rows: page.map((r) => ({
      ...r,
      handle: profiles.get(r.did)?.handle || r.did,
      followers: profiles.get(r.did)?.followers ?? null,
    })),
  };
}

/**
 * Act on named accounts inside a plan — the personal path.
 *
 * Recorded as approved_via 'individual' rather than 'band'. Both write the same
 * listitem; only one of them means dame looked at the account. The log has to be
 * able to say which, because that is the difference between "you were in a
 * category I approved" and "I read your profile and decided".
 */
export async function applyPlanToActors(agent, plan, actors) {
  const uri = listUri();
  const bot = agent.session?.did;
  if (!uri.startsWith(`at://${bot}/`)) {
    return { ok: false, message: 'That list is not owned by this account.' };
  }

  const rows = await selectAll('decision', {
    select: 'did,band,acted_at',
    eq: { plan_id: plan.id },
    order: 'did.asc',
  });
  const byDid = new Map(rows.map((r) => [r.did, r]));

  const resolved = [];
  const unknown = [];
  for (const a of actors) {
    let did;
    try {
      did = await resolveActor(a);
    } catch {
      unknown.push(a);
      continue;
    }
    const row = byDid.get(did);
    if (!row) unknown.push(a);
    else resolved.push({ ...row, actor: a });
  }

  // The veto again, at the write. Approving someone by name does not outrank it.
  const vetoed = resolved.filter((r) => r.band === 'PROTECTED');
  const todo = resolved.filter((r) => r.band !== 'PROTECTED' && !r.acted_at);

  let added = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    await agent.com.atproto.repo.applyWrites({
      repo: bot,
      writes: batch.map((r) => ({
        $type: 'com.atproto.repo.applyWrites#create',
        collection: 'app.bsky.graph.listitem',
        value: {
          $type: 'app.bsky.graph.listitem',
          subject: r.did,
          list: uri,
          createdAt: new Date().toISOString(),
        },
      })),
    });
    const now = new Date().toISOString();
    await upsert(
      'decision',
      batch.map((r) => ({
        plan_id: plan.id,
        did: r.did,
        band: r.band,
        action: 'list_add',
        acted_at: now,
        approved_via: 'individual',
      })),
    );
    added += batch.length;
  }

  const parts = [`Added ${added} by name.`];
  if (vetoed.length) {
    parts.push(`${vetoed.length} refused: PROTECTED.`);
  }
  if (unknown.length) {
    parts.push(`Not in this plan: ${unknown.join(', ')}.`);
  }
  return { ok: true, added, message: parts.join(' ') };
}
