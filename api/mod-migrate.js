// Vercel serverless function: carry the block list onto the moderator account.
//
// Moving the list is what makes "I didn't block you, I subscribe to an
// automated list" true rather than a story. While the list lives in dame's
// repo, dame's repo is the public artifact; once the moderator account owns it,
// dame holds one listblock record and nothing else.
//
// Migration and remediation are the SAME operation, which is the point of doing
// them together: only members whose band is in `carry_bands` are carried. A
// member that scores CONNECTED today is simply not brought along, so the 88
// accounts the September sweep should never have caught are fixed by never
// being copied rather than by a second cleanup pass nobody gets around to.
//
// Cost: ~8,000 listitem creates at 3 points each, against 5,000 points/hour.
// At 250 per firing on a ten-minute cron that is ~1,500/hour, just inside the
// cap, finishing in about six hours. The cron no-ops on a single select once
// the job is done, so it costs nothing to leave wired up.
//
// Actions (POST body):
//   { action: 'start', sourceList, carryBands?, name? }
//   { }                 run one batch
//   { action: 'status' }

import { select, selectAll, upsert, update } from './_lib/modDb.js';
import { botAgent } from './_lib/botAgent.js';
import { authorize } from './_lib/serviceAuth.js';

export const config = { maxDuration: 60 };

const LXM = 'is.dame.mod.migrate';

/**
 * Creates per firing.
 *
 * 250 × 3 points = 750/firing. On a ten-minute cron that is 4,500 points an
 * hour against a 5,000 cap, leaving room for dame's own posting — the write
 * budget is shared with the account doing the writing, and locking the
 * moderator account out of its own repo mid-migration would be a silly way to
 * lose an afternoon.
 */
const PER_RUN = 250;

/** applyWrites batches many creates into one HTTP call; points still count. */
const BATCH = 50;

async function migrationRow() {
  const rows = await select('migration', { select: '*', eq: { id: 1 } });
  return rows?.[0] ?? null;
}

async function ensureTargetList(agent, name) {
  const created = await agent.com.atproto.repo.createRecord({
    repo: agent.session.did,
    collection: 'app.bsky.graph.list',
    record: {
      $type: 'app.bsky.graph.list',
      purpose: 'app.bsky.graph.defs#modlist',
      name: name || 'Automated moderation list',
      description:
        'Maintained automatically. Members are selected by graph distance from ' +
        'the list owner and reviewed before being added. If you are on here and ' +
        'think that is wrong, say so — it is a filter, not a verdict.',
      createdAt: new Date().toISOString(),
    },
  });
  return created.data.uri;
}

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;
  const action = req.body?.action || req.query?.action || '';

  try {
    let row = await migrationRow();

    if (action === 'status') {
      const pending = await select('migration_item', {
        select: 'did',
        is: { carried_at: 'null' },
        limit: 1,
      });
      return res
        .status(200)
        .json({ migration: row, morePending: pending.length > 0 });
    }

    if (action === 'start') {
      const sourceList = req.body?.sourceList;
      if (!sourceList) {
        return res.status(400).json({ error: 'pass sourceList' });
      }
      const carryBands = Array.isArray(req.body?.carryBands)
        ? req.body.carryBands
        : ['UNKNOWN'];
      const audit = (
        await select('audit', {
          select: 'id',
          order: 'started_at.desc',
          limit: 1,
        })
      )?.[0];
      if (!audit) {
        return res.status(400).json({
          error:
            'run /api/mod-audit to completion first — migrating without scores would carry everyone, including the accounts this is meant to leave behind',
        });
      }
      await upsert('migration', [
        {
          id: 1,
          source_list: sourceList,
          target_list: null,
          audit_id: audit.id,
          carry_bands: carryBands,
          started_at: new Date().toISOString(),
          finished_at: null,
          carried: 0,
          failed: 0,
        },
      ]);
      row = await migrationRow();
    }

    if (!row) return res.status(200).json({ state: 'idle' });
    if (row.finished_at) {
      return res.status(200).json({ state: 'finished', migration: row });
    }

    const { agent, via } = await botAgent();

    let targetList = row.target_list;
    if (!targetList) {
      targetList = await ensureTargetList(agent, req.body?.name);
      await update('migration', { eq: { id: 1 } }, { target_list: targetList });
    }

    // Candidates: audited members in a carried band that have no migration_item
    // yet. The left join is done client-side because PostgREST cannot express
    // "not exists in another table" without a view, and at these sizes one
    // extra read is cheaper than a migration for a view.
    //
    // PAGED, NOT LIMITED. These said `limit: 20000` and got 1,000, because
    // PostgREST caps at the project's Max rows and ignores a larger limit
    // without saying so. The effect was worse than a short read: once the first
    // 1,000 candidates had been carried, every later run saw the same 1,000,
    // found them all done, and marked the migration FINISHED having carried
    // nothing — with 7,051 accounts still on the old list. A migration that
    // reports success is not something anyone re-checks.
    const [candidates, already] = await Promise.all([
      selectAll('audit_item', {
        select: 'did,band',
        eq: { audit_id: row.audit_id },
        order: 'did.asc',
      }),
      selectAll('migration_item', { select: 'did', order: 'did.asc' }),
    ]);
    const done = new Set(already.map((r) => r.did));
    const carry = row.carry_bands || ['UNKNOWN'];
    const todo = candidates
      .filter((c) => carry.includes(c.band) && !done.has(c.did))
      .slice(0, PER_RUN);

    if (!todo.length) {
      await update(
        'migration',
        { eq: { id: 1 } },
        { finished_at: new Date().toISOString() },
      );
      return res
        .status(200)
        .json({ state: 'finished', migration: await migrationRow() });
    }

    // Claim before writing. A crash between the network write and the bookkeeping
    // should leave a row that looks unfinished, not an account that was silently
    // skipped — re-running then retries it rather than losing it.
    await upsert(
      'migration_item',
      todo.map((c) => ({ did: c.did, band: c.band })),
    );

    let carried = 0;
    let failed = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      const slice = todo.slice(i, i + BATCH);
      try {
        await agent.com.atproto.repo.applyWrites({
          repo: agent.session.did,
          writes: slice.map((c) => ({
            $type: 'com.atproto.repo.applyWrites#create',
            collection: 'app.bsky.graph.listitem',
            value: {
              $type: 'app.bsky.graph.listitem',
              subject: c.did,
              list: targetList,
              createdAt: new Date().toISOString(),
            },
          })),
        });
        const now = new Date().toISOString();
        await upsert(
          'migration_item',
          slice.map((c) => ({ did: c.did, band: c.band, carried_at: now })),
        );
        carried += slice.length;
      } catch (err) {
        const message = String(err?.message || err).slice(0, 300);
        await upsert(
          'migration_item',
          slice.map((c) => ({ did: c.did, band: c.band, error: message })),
        );
        failed += slice.length;
        // A rate limit means stop, not retry: the remaining budget is gone and
        // the next firing is ten minutes away, which is the correct backoff.
        if (/rate ?limit/i.test(message)) break;
      }
    }

    await update(
      'migration',
      { eq: { id: 1 } },
      {
        carried: (row.carried || 0) + carried,
        failed: (row.failed || 0) + failed,
      },
    );

    return res.status(200).json({
      state: 'carrying',
      via,
      targetList,
      carried,
      failed,
      remaining: Math.max(
        0,
        candidates.filter((c) => carry.includes(c.band)).length -
          done.size -
          carried,
      ),
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
