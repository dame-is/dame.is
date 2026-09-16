// Vercel serverless function: score an existing moderation list.
//
// The list was built by sweeps, and a sweep only knows the graph around one
// post at one moment. This re-asks the question the sweep could not: of the
// people already on here, who is no longer a stranger?
//
// The answer is the remediation queue. On the September list, 398 of 8,697
// members score above UNKNOWN today, 88 of them CONNECTED — including an
// account followed by 24 of dame's 234. Those are not a sweep working as
// intended; they are the sweep's blast radius, visible for the first time.
//
// Scoring 8,700 accounts is ~640 API calls, so this is resumable in the same
// shape as mod-precompute: page from a stored cursor, spend a time budget,
// stop, report what is left.
//
// This endpoint never removes anyone. It scores and records decisions. The
// actual listitem deletes happen in the browser, signed by dame's own OAuth
// session against dame's own repo — no service-role credential is involved in
// changing who is blocked, which keeps the write and the authority in the same
// place.
//
// Actions (POST body):
//   { action: 'start', listUri }   begin a fresh audit
//   { }                            continue the current audit
//   { action: 'decide', decisions: [{ did, decision }] }
//   { action: 'review' }           the queue: scored, not UNKNOWN, undecided

import { ME_DID } from '../src/config.js';
import { resolvePds } from '../src/lib/atproto.js';
import {
  createScorer,
  DEFAULT_THRESHOLDS,
} from '../src/lib/moderation/score.js';
import { referenceFrom } from '../src/lib/moderation/precompute.js';
import { select, upsert, update } from './_lib/modDb.js';
import { authorize } from './_lib/serviceAuth.js';

export const config = { maxDuration: 60 };

const LXM = 'is.dame.mod.audit';
const BUDGET_MS = 40_000;

/** listRecords pages of 100; this many per invocation. */
const PAGES_PER_RUN = 15;

async function loadReference() {
  const latest = await select('vouch', {
    select: 'taken_at',
    order: 'taken_at.desc',
    limit: 1,
  });
  const takenAt = latest?.[0]?.taken_at;
  if (!takenAt) {
    throw new Error('no finalised snapshot — run /api/mod-precompute first');
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

async function currentAudit() {
  const rows = await select('audit', {
    select: '*',
    order: 'started_at.desc',
    limit: 1,
  });
  return rows?.[0] ?? null;
}

/** POST a row and get it back, for tables with a generated id. */
async function insertReturning(table, row) {
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
  if (!res.ok)
    throw new Error(`insert into ${table} failed: ${await res.text()}`);
  return (await res.json())[0];
}

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;

  const action = req.body?.action || req.query?.action || '';

  try {
    if (action === 'review') {
      const audit = await currentAudit();
      if (!audit) return res.status(200).json({ audit: null, items: [] });
      // Everything that is not UNKNOWN and has not been decided. Sorted by
      // trust so the accounts most embedded in dame's world are read first —
      // if attention runs out halfway down, it ran out in the right place.
      const items = await select('audit_item', {
        select: '*',
        eq: { audit_id: audit.id },
        order: 'trust.desc',
        limit: 1000,
      });
      return res.status(200).json({
        audit,
        items: items.filter((i) => i.band !== 'UNKNOWN' && !i.decision),
      });
    }

    if (action === 'decide') {
      const audit = await currentAudit();
      if (!audit)
        return res.status(400).json({ error: 'no audit to decide on' });
      const decisions = Array.isArray(req.body?.decisions)
        ? req.body.decisions
        : [];
      const now = new Date().toISOString();
      const valid = decisions.filter(
        (d) => d?.did && (d.decision === 'keep' || d.decision === 'remove'),
      );
      if (!valid.length)
        return res.status(400).json({ error: 'no valid decisions' });
      for (const d of valid) {
        await update(
          'audit_item',
          { eq: { audit_id: audit.id, did: d.did } },
          { decision: d.decision, decided_at: now },
        );
      }
      return res.status(200).json({ recorded: valid.length });
    }

    // start / continue
    let audit = await currentAudit();
    if (action === 'start' || !audit) {
      const listUri = req.body?.listUri || audit?.list_uri;
      if (!listUri) {
        return res
          .status(400)
          .json({ error: 'pass listUri (the at:// URI of the list to audit)' });
      }
      audit = await insertReturning('audit', { list_uri: listUri });
    }
    if (audit.finished_at) {
      return res.status(200).json({ state: 'finished', audit });
    }

    const { ref, thresholds, takenAt } = await loadReference();
    const scorer = createScorer({ ...ref, thresholds });
    const pds = await resolvePds(ME_DID);

    const started = Date.now();
    let cursor = audit.cursor || undefined;
    let scored = audit.scored || 0;
    let pages = 0;
    let done = false;

    while (pages < PAGES_PER_RUN && Date.now() - started < BUDGET_MS) {
      const url =
        `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(ME_DID)}` +
        `&collection=app.bsky.graph.listitem&limit=100` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const page = await fetch(url, {
        headers: { Accept: 'application/json' },
      }).then((r) => (r.ok ? r.json() : null));
      if (!page) break;

      const dids = (page.records || [])
        .filter((r) => r.value?.list === audit.list_uri && r.value?.subject)
        .map((r) => r.value.subject);

      if (dids.length) {
        const scores = await scorer.score(dids);
        await upsert(
          'audit_item',
          [...scores.values()].map((s) => ({
            audit_id: audit.id,
            did: s.did,
            handle: s.handle,
            band: s.band,
            trust: s.trust,
            vouches: s.vouches,
            followers: s.followers,
            protected_reason: s.protectedReason ?? null,
          })),
        );
        scored += dids.length;
      }

      pages += 1;
      cursor = page.cursor;
      if (!cursor) {
        done = true;
        break;
      }
    }

    await update(
      'audit',
      { eq: { id: audit.id } },
      {
        cursor: done ? null : (cursor ?? null),
        scored,
        ...(done
          ? { finished_at: new Date().toISOString(), total: scored }
          : {}),
      },
    );

    return res.status(200).json({
      state: done ? 'finished' : 'scoring',
      auditId: audit.id,
      snapshot: takenAt,
      scored,
      pages,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
