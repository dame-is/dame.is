// The in-depth review surface: one plan, every account in it, and what they
// wrote.
//
// WHY THIS EXISTS SEPARATELY FROM THE DM. The DM is good at a decision and bad
// at a corpus. It can show ten quotes as a spot check before a bulk action and
// it cannot show 231, because nobody reads 231 of anything in a chat bubble --
// and a menu that implies otherwise is the exact failure this system was built
// against. A screen can. So the DM stays the place you ACT quickly and this is
// the place you LOOK properly, and they read the same rows from the same table.
//
// The ordering is trust descending everywhere, as it is in the audit queue and
// in the DM review: the accounts most embedded in dame's world first, so that
// attention running out halfway down runs out in the right place.
//
// WRITES ARE NAMED, NEVER BULK. `add` takes an explicit list of DIDs that dame
// ticked, and records them as `individual` rather than as a band or a label --
// because that is what actually happened. Approving a whole label is still a DM
// command; if you are on this screen you are here to look at people one at a
// time, and the log should say so.
//
// Actions (POST body):
//   { action: 'plans' }                        recent plans, newest first
//   { action: 'detail', code, ...filters }     one plan, one page of rows
//   { action: 'add', code, dids: [] }          add those accounts, by name
//   { action: 'undo', code }                   take the plan's additions back off

import { APPVIEW } from '../src/config.js';
import {
  shortCode,
  undoPlan,
  findPlan,
  applyPlanToActors,
} from './_lib/bulkPlan.js';
import { botAgent } from './_lib/botAgent.js';
import { select, selectAll } from './_lib/modDb.js';
import { authorize } from './_lib/serviceAuth.js';

export const config = { maxDuration: 60 };

const LXM = 'is.dame.mod.plan';

/** Rows per page. Enough to scan, small enough to resolve handles for. */
const PAGE = 50;

/** Profiles for a page of DIDs, 25 at a time. Best effort. */
async function profilesFor(dids) {
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
          displayName: p.displayName ?? null,
          followers: p.followersCount ?? null,
          avatar: p.avatar ?? null,
        });
      }
    } catch {
      // An account we cannot fetch still has a DID, a band and its own words,
      // which is the part being reviewed. A missing handle is ugly, not wrong.
    }
  }
  return out;
}

/** Recent plans with enough shape to choose one. */
export async function plans() {
  const rows = await select('plan', {
    select: 'id,created_at,approved_at,approved_bands,totals,note',
    order: 'created_at.desc',
    limit: 25,
  });
  // One read of the decision table rather than one per plan: at these sizes the
  // whole thing is a few pages, and 25 round trips to count rows is not.
  const ids = new Set(rows.map((r) => r.id));
  const all = await selectAll('decision', {
    select: 'plan_id,triage,acted_at,undone_at',
    order: 'plan_id.asc',
  });
  const byPlan = new Map();
  for (const d of all) {
    if (!ids.has(d.plan_id)) continue;
    const agg = byPlan.get(d.plan_id) || {
      accounts: 0,
      added: 0,
      undone: 0,
      hostile: 0,
      arguing: 0,
      neutral: 0,
      labelled: 0,
    };
    agg.accounts += 1;
    if (d.acted_at && !d.undone_at) agg.added += 1;
    if (d.undone_at) agg.undone += 1;
    if (d.triage && d.triage in agg) {
      agg[d.triage] += 1;
      agg.labelled += 1;
    }
    byPlan.set(d.plan_id, agg);
  }

  return {
    plans: rows.map((p) => ({
      code: shortCode(p.id),
      createdAt: p.created_at,
      approvedAt: p.approved_at,
      approvedBands: p.approved_bands,
      note: p.note,
      uri: p.totals?.uri ?? null,
      kind: p.totals?.kind ?? null,
      ...(byPlan.get(p.id) || { accounts: 0, added: 0, undone: 0 }),
    })),
  };
}

/** One plan, filtered and paged, with the words each account wrote. */
export async function detail(body) {
  const plan = await findPlan(body.code);
  if (!plan) return { error: 'no plan with that code' };

  const rows = await selectAll('decision', {
    select:
      'did,band,trust,vouches,triage,triage_quote,acted_at,undone_at,approved_via,evidence_uri',
    eq: { plan_id: plan.id },
    order: 'did.asc',
  });

  const label = body.label || null;
  const band = body.band || null;
  const state = body.state || 'all';

  const live = (r) => r.acted_at && !r.undone_at;
  const filtered = rows.filter((r) => {
    if (label && r.triage !== label) return false;
    if (band && r.band !== band) return false;
    if (state === 'pending' && live(r)) return false;
    if (state === 'added' && !live(r)) return false;
    return true;
  });

  // Most connected first, as everywhere else a person reads a queue here.
  filtered.sort((a, b) => (b.trust ?? 0) - (a.trust ?? 0));

  const offset = Math.max(0, Number(body.offset) || 0);
  const page = filtered.slice(offset, offset + PAGE);
  const profiles = await profilesFor(page.map((r) => r.did));

  const counts = { total: rows.length, added: 0, labelled: 0 };
  const byLabel = { hostile: 0, arguing: 0, neutral: 0, gone: 0 };
  const byBand = {};
  for (const r of rows) {
    if (live(r)) counts.added += 1;
    if (r.triage) {
      counts.labelled += 1;
      if (r.triage in byLabel) byLabel[r.triage] += 1;
    }
    byBand[r.band] = (byBand[r.band] || 0) + 1;
  }

  return {
    code: shortCode(plan.id),
    note: plan.note,
    uri: plan.totals?.uri ?? null,
    createdAt: plan.created_at,
    counts,
    byLabel,
    byBand,
    matched: filtered.length,
    offset,
    pageSize: PAGE,
    rows: page.map((r) => ({
      did: r.did,
      band: r.band,
      trust: r.trust,
      vouches: r.vouches,
      triage: r.triage,
      quote: r.triage_quote,
      evidenceUri: r.evidence_uri,
      added: Boolean(live(r)),
      undone: Boolean(r.undone_at),
      approvedVia: r.approved_via,
      ...(profiles.get(r.did) || {}),
    })),
  };
}

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;
  const action = req.body?.action || req.query?.action || 'plans';

  try {
    if (action === 'plans') return res.status(200).json(await plans());
    if (action === 'detail') {
      const out = await detail(req.body || {});
      return res.status(out.error ? 404 : 200).json(out);
    }

    if (action === 'add') {
      const plan = await findPlan(req.body?.code);
      if (!plan) return res.status(404).json({ error: 'no plan' });
      const dids = Array.isArray(req.body?.dids) ? req.body.dids : [];
      if (!dids.length) return res.status(400).json({ error: 'no accounts' });
      // Named, so recorded as `individual`. Somebody sat and read these.
      const { agent } = await botAgent();
      return res
        .status(200)
        .json(await applyPlanToActors(agent, plan, dids.slice(0, 200)));
    }

    if (action === 'undo') {
      const plan = await findPlan(req.body?.code);
      if (!plan) return res.status(404).json({ error: 'no plan' });
      const { agent } = await botAgent();
      return res.status(200).json(
        await undoPlan(agent, plan, {
          reason: req.body?.reason || 'undone from the portal',
        }),
      );
    }

    return res.status(400).json({ error: `unknown action ${action}` });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
