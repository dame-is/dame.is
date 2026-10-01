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
import { evidenceUriFor } from './triage.js';
import { graphFacts, isListed, noteListed } from './graphFacts.js';

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

/**
 * The `approved_via` for a write, given who asked for it.
 *
 * `by` is null for a typed command and 'agent' when agent mode called the
 * function on dame's behalf. Prefixed rather than replaced, because the basis
 * still holds -- a band is still a band -- and what changed is that a model
 * chose it from her sentence instead of her typing it. "agent:band" says both.
 */
const viaFor = (basis, by) => (by ? `${by}:${basis}` : basis);

/** Does this participant match the requested engagement kind? */
function matchesKind(row, kind) {
  const wanted = KINDS[kind];
  if (!wanted) return true; // everyone
  return wanted.some((k) => (row.engagements || {})[k] > 0);
}

/**
 * Did this stored decision row engage in any of these ways?
 *
 * Rows from before `engaged` was recorded have none, and for those the plan's
 * own kind is the only evidence: every row of a likers scan liked the post.
 */
export function engagedAs(row, kinds, plan) {
  if (!kinds?.length) return true;
  if (Array.isArray(row.engaged)) {
    return kinds.some((kind) =>
      (KINDS[kind] || []).some((k) => row.engaged.includes(k)),
    );
  }
  return kinds.includes(plan?.totals?.kind);
}

/**
 * Split rows into those to write and those already on the list.
 *
 * Bulk approvals never checked, so an account in two plans got two listitems:
 * mudfire4 was added at 19:53 and again at 19:58 on 2026-10-01, and the repo
 * held about 10,000 listitems for about 8,900 accounts. Read from the held copy
 * (graphFacts.js), which this process's own writes keep current. If the list
 * cannot be read, everything is written: a duplicate is the cheaper mistake
 * than a block that silently did not happen.
 */
async function splitListed(uri, rows) {
  const facts = await graphFacts({ list: uri }).catch(() => null);
  if (!facts?.listed) return { fresh: rows, listed: [] };
  const fresh = [];
  const listed = [];
  for (const r of rows) (isListed(uri, r.did) ? listed : fresh).push(r);
  return { fresh, listed };
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
  const alreadyListed = chosen.filter((r) => r.alreadyListed).length;
  const blocksYou = chosen.filter((r) => r.blocksYou).length;
  // Who an approval could still add: not PROTECTED, not on the list already.
  // A post whose engagers are mostly listed should not offer "add everyone"
  // for the one account that is left.
  const freshRows = chosen.filter(
    (r) => !r.alreadyListed && r.band !== 'PROTECTED',
  );
  const fresh = {
    total: freshRows.length,
    byBand: Object.fromEntries(
      BANDS.map((b) => [b, freshRows.filter((r) => r.band === b).length]),
    ),
    likers: freshRows.filter((r) => (r.engagements || {}).like > 0).length,
  };

  await upsert('plan', [
    {
      id: planId,
      created_at: new Date().toISOString(),
      approved_at: null,
      approved_bands: null,
      totals: {
        ...summary.totals,
        // The post itself, so a later triage does not have to read it back out
        // of a prose note.
        uri: target.uri,
        kind,
        selected: chosen.length,
        byBand,
        alreadyListed,
        blocksYou,
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
      // Where this account's words live, recorded now so a later triage does
      // not have to re-walk 60 pages of Constellation to find them again.
      evidence_uri: evidenceUriFor(r),
      // How they engaged, so "the likers" of a whole-post scan can be approved
      // without harvesting the post again.
      engaged: Object.keys(r.engagements || {}),
      already_listed: Boolean(r.alreadyListed),
      blocks_me: Boolean(r.blocksYou),
    })),
  );

  return {
    code: shortCode(planId),
    planId,
    uri: target.uri,
    author,
    // How many wrote something. Likes and reposts carry no words, so this is
    // the ceiling on what a content triage could ever say anything about.
    withText: chosen.filter((r) => evidenceUriFor(r)).length,
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
    alreadyListed,
    blocksYou,
    fresh,
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
export async function applyPlan(
  agent,
  plan,
  bands,
  { by = null, kinds = null } = {},
) {
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
    select: 'did,band,acted_at,engaged,already_listed',
    eq: { plan_id: plan.id },
    order: 'did.asc',
  });
  const pending = rows.filter(
    (r) =>
      wanted.includes(r.band) &&
      !r.acted_at &&
      !r.already_listed &&
      engagedAs(r, kinds, plan),
  );
  if (!pending.length) {
    return {
      ok: true,
      added: 0,
      remaining: 0,
      message: 'Nothing left to add for those bands.',
    };
  }

  const again = `approve ${shortCode(plan.id)} ${[...wanted, ...(kinds || [])].join(',')}`;
  const slice = pending.slice(0, PER_APPROVAL);
  const { added, failed, rateLimited, already } = await writeRows(
    agent,
    plan,
    slice,
    { uri, bot, via: viaFor('band', by) },
  );
  if (rateLimited) {
    return {
      ok: true,
      added,
      already,
      remaining: pending.length - added - already,
      message: `Added ${added}. Hit the write rate limit. Send "${again}" again in an hour for the remaining ${pending.length - added - already}.`,
    };
  }

  await update(
    'plan',
    { eq: { id: plan.id } },
    {
      approved_at: plan.approved_at || new Date().toISOString(),
      approved_bands: wanted,
    },
  );

  const remaining = pending.length - added - already - failed;
  return {
    ok: true,
    added,
    failed,
    already,
    remaining,
    message:
      `Added ${added} to the list${failed ? `, ${failed} failed` : ''}.` +
      alreadyNote(already) +
      (remaining
        ? ` ${remaining} left. Send "${again}" again to continue.`
        : ''),
  };
}

/** " 3 were already on it." when some were, nothing when none were. */
function alreadyNote(n) {
  if (!n) return '';
  return n === 1 ? ' 1 was already on it.' : ` ${n} were already on it.`;
}

/**
 * Create the listitems for a set of already-chosen rows.
 *
 * Shared by band approvals and label approvals so there is one place that knows
 * how a listitem gets made and how it gets logged. `via` is the whole reason
 * both exist: "you were in a category I approved", "I read your profile and
 * decided" and "a model read what you wrote and I approved that reading" are
 * three different answers to why someone is on the list, and the log has to be
 * able to tell them apart.
 */
async function writeRows(agent, plan, rows, { uri, bot, via }) {
  let added = 0;
  let failed = 0;
  const { fresh, listed } = await splitListed(uri, rows);
  if (listed.length) {
    await upsert(
      'decision',
      listed.map((r) => ({
        plan_id: plan.id,
        did: r.did,
        band: r.band,
        already_listed: true,
      })),
    ).catch(() => {});
  }
  rows = fresh;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      const res = await agent.com.atproto.repo.applyWrites({
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
      const created = res?.data?.results || [];
      batch.forEach((r, n) =>
        noteListed(
          uri,
          r.did,
          String(created[n]?.uri || '')
            .split('/')
            .pop(),
        ),
      );
      const now = new Date().toISOString();
      await upsert(
        'decision',
        batch.map((r) => ({
          plan_id: plan.id,
          did: r.did,
          band: r.band,
          action: 'list_add',
          acted_at: now,
          approved_via: via,
        })),
      );
      added += batch.length;
    } catch (err) {
      failed += batch.length;
      const message = String(err?.message || err);
      // A rate limit means stop, not retry. The remaining budget is gone and
      // approving again in an hour is the correct backoff.
      if (/rate ?limit/i.test(message))
        return { added, failed, rateLimited: true, already: listed.length };
    }
  }
  return { added, failed, rateLimited: false, already: listed.length };
}

/**
 * Add the accounts a content triage gave this label.
 *
 * Recorded as `approved_via: triage:<label>`, never as a band. A band is
 * reproducible from the snapshot; this is a model reading that nobody can
 * reproduce, so the log says which one it was.
 */
export async function applyPlanToTriage(
  agent,
  plan,
  label,
  { by = null, skipBands = [] } = {},
) {
  const uri = listUri();
  const bot = agent.session?.did;
  if (!uri.startsWith(`at://${bot}/`)) {
    return { ok: false, message: 'That list is not owned by this account.' };
  }

  const rows = await selectAll('decision', {
    select: 'did,band,triage,acted_at,already_listed',
    eq: { plan_id: plan.id, triage: label },
    order: 'did.asc',
  });
  // The veto, at the write, as everywhere else.
  // skipBands is how a watch holds CONNECTED and NOTABLE back for a 👍 even
  // when it was asked to add the hostile ones on its own.
  const pending = rows.filter(
    (r) =>
      r.band !== 'PROTECTED' &&
      !skipBands.includes(r.band) &&
      !r.acted_at &&
      !r.already_listed,
  );
  if (!pending.length) {
    return { ok: true, added: 0, message: `Nothing left to add for ${label}.` };
  }

  const slice = pending.slice(0, PER_APPROVAL);
  const { added, failed, already } = await writeRows(agent, plan, slice, {
    uri,
    bot,
    via: viaFor(`triage:${label}`, by),
  });
  const remaining = pending.length - added - already - failed;
  return {
    ok: true,
    added,
    failed,
    already,
    remaining,
    message:
      `Added ${added} that a model read as ${label}.` +
      alreadyNote(already) +
      (remaining
        ? ` ${remaining} left, send "approve ${shortCode(plan.id)} ${label}" again.`
        : ''),
  };
}

/**
 * How many accounts a plan action would touch, counted the way the action
 * itself counts them: `pending` is what an approval would still add (never
 * PROTECTED, never anyone already acted on), `live` is what an undo would take
 * back. Read before a write so the check on it can see the size of it.
 */
export async function countDecisions(
  plan,
  { bands = null, label = null, state = 'pending', kinds = null } = {},
) {
  const rows = await selectAll('decision', {
    select: 'did,band,triage,action,acted_at,undone_at,engaged,already_listed',
    eq: { plan_id: plan.id },
    order: 'did.asc',
  });
  return rows.filter((r) => {
    // Mirrors undoPlan's own filter, so the number checked is the number undone.
    if (state === 'live') {
      return r.acted_at && r.action === 'list_add' && !r.undone_at;
    }
    if (r.acted_at || r.band === 'PROTECTED' || r.already_listed) return false;
    if (bands?.length && !bands.includes(r.band)) return false;
    if (label && r.triage !== label) return false;
    return engagedAs(r, kinds, plan);
  }).length;
}

/** What a plan holds for these DIDs: band, triage label, whether acted on. */
export async function decisionsFor(plan, dids) {
  const wanted = new Set(dids.filter(Boolean));
  if (!wanted.size) return new Map();
  const rows = await selectAll('decision', {
    select: 'did,band,triage,acted_at,undone_at',
    eq: { plan_id: plan.id },
    order: 'did.asc',
  });
  return new Map(rows.filter((r) => wanted.has(r.did)).map((r) => [r.did, r]));
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
export async function handlesFor(dids) {
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
export async function applyPlanToActors(
  agent,
  plan,
  actors,
  { by = null } = {},
) {
  const uri = listUri();
  const bot = agent.session?.did;
  if (!uri.startsWith(`at://${bot}/`)) {
    return { ok: false, message: 'That list is not owned by this account.' };
  }

  const rows = await selectAll('decision', {
    select: 'did,band,acted_at,already_listed',
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
  const { fresh: todo, listed } = await splitListed(
    uri,
    resolved.filter((r) => r.band !== 'PROTECTED' && !r.acted_at),
  );
  if (listed.length) {
    await upsert(
      'decision',
      listed.map((r) => ({
        plan_id: plan.id,
        did: r.did,
        band: r.band,
        already_listed: true,
      })),
    ).catch(() => {});
  }

  let added = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const res = await agent.com.atproto.repo.applyWrites({
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
    const created = res?.data?.results || [];
    batch.forEach((r, n) =>
      noteListed(
        uri,
        r.did,
        String(created[n]?.uri || '')
          .split('/')
          .pop(),
      ),
    );
    const now = new Date().toISOString();
    await upsert(
      'decision',
      batch.map((r) => ({
        plan_id: plan.id,
        did: r.did,
        band: r.band,
        action: 'list_add',
        acted_at: now,
        approved_via: viaFor('individual', by),
      })),
    );
    added += batch.length;
  }

  const parts = [`Added ${added} by name.${alreadyNote(listed.length)}`];
  if (vetoed.length) {
    parts.push(`${vetoed.length} refused: PROTECTED.`);
  }
  if (unknown.length) {
    parts.push(`Not in this plan: ${unknown.join(', ')}.`);
  }
  return {
    ok: true,
    added,
    already: listed.length,
    message: parts.join(' '),
  };
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

/**
 * What happened to the list in the last `hours`: adds, removals and undos,
 * grouped by plan, newest first. For "what did you do today?".
 *
 * Read from the decision log, so it covers every path that writes -- typed
 * commands, the agent, approvals, watches -- and says which one it was.
 */
export async function activitySince(hours = 24, { now = Date.now() } = {}) {
  const since = new Date(now - hours * 3_600_000).toISOString();
  const [acted, undone] = await Promise.all([
    selectAll('decision', {
      select: 'plan_id,did,action,acted_at,approved_via',
      where: { acted_at: `gte.${since}` },
      order: 'acted_at.desc',
    }),
    selectAll('decision', {
      select: 'plan_id,did,undone_at',
      where: { undone_at: `gte.${since}` },
      order: 'undone_at.desc',
    }),
  ]);
  const byPlan = new Map();
  const entry = (id) => {
    if (!byPlan.has(id)) {
      byPlan.set(id, {
        code: shortCode(id),
        added: 0,
        removed: 0,
        undone: 0,
        via: new Set(),
        at: null,
      });
    }
    return byPlan.get(id);
  };
  for (const r of acted) {
    const e = entry(r.plan_id);
    if (r.action === 'list_remove') e.removed += 1;
    else e.added += 1;
    if (r.approved_via) e.via.add(r.approved_via);
    if (!e.at || r.acted_at > e.at) e.at = r.acted_at;
  }
  for (const r of undone) {
    const e = entry(r.plan_id);
    e.undone += 1;
    if (!e.at || r.undone_at > e.at) e.at = r.undone_at;
  }
  const ids = [...byPlan.keys()];
  const notes = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const rows = await select('plan', {
      select: 'id,note',
      where: { id: `in.(${ids.slice(i, i + 50).join(',')})` },
    }).catch(() => []);
    for (const p of rows || []) notes.set(p.id, p.note);
  }
  const plans = ids
    .map((id) => ({
      ...byPlan.get(id),
      via: [...byPlan.get(id).via],
      note: notes.get(id) ?? null,
    }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    since,
    hours,
    totals: {
      added: plans.reduce((n, p) => n + p.added, 0),
      removed: plans.reduce((n, p) => n + p.removed, 0),
      undone: plans.reduce((n, p) => n + p.undone, 0),
    },
    plans: plans.slice(0, 40),
  };
}
