// Vercel serverless function: the gate.
//
// Paste a post link, get back everyone who touched it, scored against your own
// graph, sorted into bands. Nothing is written to the network here and nothing
// is approved — this endpoint exists to answer "what would a bulk action on this
// post actually hit" BEFORE the action, which is the one question the old
// workflow had no way to ask.
//
// It persists the harvest and an unapproved plan so the answer can be reviewed
// later, re-scored against a newer snapshot, and pointed at when someone asks
// why they ended up on a list.
//
// POST { link } or GET ?link=  — accepts a post URL from any Bluesky client, or
// an at:// URI. `?dry=1` skips persistence, for poking at it without leaving
// rows behind.

import { ME_DID } from '../src/config.js';
import { resolveTarget, TargetError } from '../src/lib/moderation/target.js';
import { harvestPost } from '../src/lib/moderation/harvest.js';
import {
  createScorer,
  summarise,
  DEFAULT_THRESHOLDS,
} from '../src/lib/moderation/score.js';
import { referenceFrom } from '../src/lib/moderation/precompute.js';
import { select, upsert } from './_lib/modDb.js';
import { authorize } from './_lib/serviceAuth.js';

export const config = { maxDuration: 60 };

/**
 * The lexicon method a browser token must be scoped to.
 *
 * Not a real lexicon — nothing publishes it and nothing validates against it.
 * It exists so a token minted for the preflight cannot be replayed against the
 * settings endpoint, which is the whole value of `lxm` for a private service.
 */
const LXM = 'is.dame.mod.preflight';

/**
 * Load the newest finalised snapshot.
 *
 * Throws rather than scoring against nothing. A preflight with an empty vouch
 * table would put every single account in UNKNOWN and wave the whole batch
 * through — the exact failure this system exists to prevent, wearing the
 * costume of a successful run.
 */
async function loadReference() {
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
    select('vouch', { select: 'did,vouches', eq: { taken_at: takenAt } }),
    select('circle', { select: 'did', eq: { taken_at: takenAt } }),
    select('protected', { select: 'did,reason' }),
    select('settings', { select: 'thresholds', eq: { id: 1 } }),
  ]);

  return {
    takenAt,
    ref: referenceFrom({
      vouchRows,
      circleDids: circleRows.map((r) => r.did),
      protectedRows,
    }),
    thresholds: settings?.[0]?.thresholds || DEFAULT_THRESHOLDS,
  };
}

async function persist(target, harvest, summary, thresholds) {
  const [row] = await upsertReturning('harvest', {
    uri: target.uri,
    harvested_at: harvest.harvestedAt,
    sources: harvest.sources,
    totals: summary.totals,
    truncated: harvest.truncated,
  });
  await upsert(
    'harvest_participant',
    harvest.participants.map((p) => ({
      harvest_id: row.id,
      did: p.did,
      engagements: p.engagements,
      primary_kind: p.primary,
      total: p.total,
    })),
  );
  const [plan] = await upsertReturning('plan', {
    harvest_id: row.id,
    thresholds,
    totals: summary.totals,
  });
  await upsert(
    'decision',
    summary.rows.map((r) => ({
      plan_id: plan.id,
      did: r.did,
      band: r.band,
      trust: r.trust ?? null,
      distance: r.distance ?? null,
      vouches: r.vouches ?? null,
    })),
  );
  return { harvestId: row.id, planId: plan.id };
}

/** POST one row and get it back — PostgREST needs `return=representation`. */
async function upsertReturning(table, row) {
  const url = process.env.SUPABASE_URL.replace(/\/$/, '');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'mod',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`insert into ${table} failed: ${await res.text()}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;

  const link = req.body?.link || req.query?.link;
  if (!link)
    return res
      .status(400)
      .json({ error: 'pass a post link or at:// URI as `link`' });

  try {
    const target = await resolveTarget(link);
    const { takenAt, ref, thresholds } = await loadReference();
    const harvest = await harvestPost(target.uri);

    const scorer = createScorer({ ...ref, thresholds });
    const scores = await scorer.score(harvest.participants.map((p) => p.did));
    const summary = summarise(harvest, scores, { excludeSelf: ME_DID });

    const dry = req.query?.dry === '1';
    const ids = dry
      ? null
      : await persist(target, harvest, summary, thresholds);

    return res.status(200).json({
      target,
      snapshot: takenAt,
      ...ids,
      totals: summary.totals,
      truncated: summary.truncated,
      // The review list is named; the auto-eligible majority is a count. That
      // asymmetry is the product: a list of 8,000 strangers is not reviewable
      // and pretending otherwise is how the last accident happened.
      requiresReview: summary.requiresReview.map((r) => ({
        did: r.did,
        handle: r.handle,
        band: r.band,
        trust: r.trust,
        distance: r.distance,
        vouches: r.vouches,
        followers: r.followers,
        postsPerDay: r.postsPerDay,
        engagements: r.engagements,
        protectedReason: r.protectedReason ?? null,
        alreadyListed: r.alreadyListed,
      })),
      autoEligible: summary.autoEligible.length,
    });
  } catch (err) {
    const status = err instanceof TargetError ? 400 : 500;
    return res.status(status).json({ error: String(err?.message || err) });
  }
}
