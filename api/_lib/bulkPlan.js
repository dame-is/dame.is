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
import { select, selectAll, upsert, update } from './modDb.js';
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

  // THE AUTHOR IS SCORED WITH THE PARTICIPANTS, in the same call. A post with
  // no likes and no replies used to come back with every band at zero and "Do
  // nothing" as the only option -- a report about the graph AROUND a post,
  // offering nothing about the person who wrote it, who is the one actually in
  // front of dame. summarise() maps over the harvest, so an extra entry in the
  // score map cannot leak into the plan's rows.
  const scores = await scorer.score([
    ...new Set([...harvest.participants.map((p) => p.did), target.did]),
  ]);
  const summary = summarise(harvest, scores, { excludeSelf: ME_DID });
  const author = scores.get(target.did) ?? null;

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
    author,
    kind,
    total: chosen.length,
    byBand,
    // Per-kind counts, so a scan can say "15 likes, 1 repost" rather than only
    // a participant total.
    engagements: summary.totals?.engagements || {},
    // Said before the approval rather than discovered during it. The relay
    // ceiling was nearly hit twice in one day with no warning anywhere.
    cost: estimateWrites(chosen.length - (byBand.PROTECTED || 0)),
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

/**
 * Cost of a set of writes, in the units that actually bind.
 *
 * Two ceilings apply and the tighter one is usually not the one people quote.
 * A create is 3 points against 5,000/hour per account, but it is ALSO one repo
 * event against the relay's 2,600/hour for the whole PDS, shared with every
 * other account on it. Deletes are 1 point and still one event.
 */
export function estimateWrites(n, { kind = 'create' } = {}) {
  if (!n) return 'nothing to write';
  const points = n * (kind === 'create' ? 3 : 1);
  const byPoints = points / 5000;
  const byEvents = n / 2600;
  const hours = Math.max(byPoints, byEvents);
  const mins = Math.round(hours * 60);
  const time =
    mins < 2
      ? 'under a minute'
      : mins < 90
        ? `about ${mins} minutes`
        : `about ${hours.toFixed(1)} hours`;
  return `${n.toLocaleString()} writes, ${points.toLocaleString()} points, ${time}`;
}

/** The most recent plan that actually put someone on the list. */
export async function lastActedPlan() {
  const acted = await selectAll('decision', {
    select: 'plan_id,acted_at,action,undone_at',
    order: 'plan_id.asc',
  });
  const live = acted.filter(
    (d) => d.acted_at && d.action === 'list_add' && !d.undone_at,
  );
  if (!live.length) return null;
  live.sort((a, b) => Date.parse(b.acted_at) - Date.parse(a.acted_at));
  return findPlan(shortCode(live[0].plan_id));
}

/**
 * Take a plan's additions back off the list.
 *
 * The decision rows STAY, stamped undone rather than deleted. A log that erases
 * what it undid cannot answer "was I ever on this list", which is a question
 * somebody may reasonably ask after the fact -- and an append-only record that
 * quietly rewrites itself is not a record.
 *
 * The listitem rkey is not stored anywhere, so the repo is scanned once and
 * matched by subject. Deletes are 1 point rather than 3, so the cap can be
 * higher than an approval's, but it is still capped and still resumable.
 */
export async function undoPlan(
  agent,
  plan,
  { max = 1000, reason = 'undo' } = {},
) {
  const uri = listUri();
  const bot = agent.session?.did;
  if (!uri.startsWith(`at://${bot}/`)) {
    return { ok: false, message: 'That list is not owned by this account.' };
  }

  const rows = await selectAll('decision', {
    select: 'did,band,acted_at,action,undone_at',
    eq: { plan_id: plan.id },
    order: 'did.asc',
  });
  const live = rows.filter(
    (r) => r.acted_at && r.action === 'list_add' && !r.undone_at,
  );
  if (!live.length) {
    return {
      ok: true,
      removed: 0,
      message: 'Nothing from that plan is still on the list.',
    };
  }

  const wanted = new Map(live.map((r) => [r.did, r]));
  const rkeys = [];
  let cursor;
  for (let page = 0; page < 400; page += 1) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: bot,
      collection: 'app.bsky.graph.listitem',
      limit: 100,
      cursor,
    });
    for (const rec of res.data.records || []) {
      if (rec.value?.list !== uri) continue;
      if (!wanted.has(rec.value?.subject)) continue;
      rkeys.push({ rkey: rec.uri.split('/').pop(), did: rec.value.subject });
    }
    cursor = res.data.cursor;
    if (!cursor || !(res.data.records || []).length) break;
  }

  const slice = rkeys.slice(0, max);
  let removed = 0;
  for (let i = 0; i < slice.length; i += BATCH) {
    const batch = slice.slice(i, i + BATCH);
    try {
      await agent.com.atproto.repo.applyWrites({
        repo: bot,
        writes: batch.map((r) => ({
          $type: 'com.atproto.repo.applyWrites#delete',
          collection: 'app.bsky.graph.listitem',
          rkey: r.rkey,
        })),
      });
      const now = new Date().toISOString();
      await upsert(
        'decision',
        batch.map((r) => ({
          plan_id: plan.id,
          did: r.did,
          band: wanted.get(r.did).band,
          action: 'list_add',
          acted_at: wanted.get(r.did).acted_at,
          undone_at: now,
          undo_reason: reason,
        })),
      );
      removed += batch.length;
    } catch (err) {
      const message = String(err?.message || err);
      if (/rate ?limit/i.test(message)) break;
      throw err;
    }
  }

  const remaining = live.length - removed;
  return {
    ok: true,
    removed,
    remaining,
    message:
      `Took ${removed} back off the list.` +
      (remaining
        ? ` ${remaining} left, send "undo ${shortCode(plan.id)}" again.`
        : ''),
  };
}

/** What has been done lately, or to one account. */
export async function historyFor(did = null, { limit = 8 } = {}) {
  const rows = await selectAll('decision', {
    select: 'plan_id,did,band,action,acted_at,approved_via,undone_at',
    ...(did ? { eq: { did } } : {}),
    order: 'plan_id.asc',
  });
  const acted = rows.filter((r) => r.acted_at);
  acted.sort((a, b) => Date.parse(b.acted_at) - Date.parse(a.acted_at));

  const out = [];
  const seenPlans = new Map();
  for (const row of acted) {
    if (!seenPlans.has(row.plan_id)) {
      const plan = await select('plan', {
        select: 'id,note,approved_bands,created_at',
        eq: { id: row.plan_id },
      });
      seenPlans.set(row.plan_id, plan?.[0] ?? null);
    }
    out.push({
      ...row,
      plan: seenPlans.get(row.plan_id),
      code: shortCode(row.plan_id),
    });
    if (out.length >= limit) break;
  }
  return { total: acted.length, rows: out };
}
