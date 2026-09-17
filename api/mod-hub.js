// The moderation hub: what state is this system in, and why is someone listed.
//
// Three reads, each deliberately cheap. The first version of the retirement
// endpoint walked 173 sequential PDS pages inside a function and returned
// FUNCTION_INVOCATION_TIMEOUT, so nothing here pages a repo. Counts come from
// the database, and the list is browsed one AppView page at a time.
//
//   overview   is any of this healthy, and how much has it cost
//   why        the answer to "why am I on your list", for one account
//   list       a page of the list, as profile cards
//
// `why` is the one that matters. The whole system's claim is that a decision is
// replayable -- "here is exactly what it saw" -- and until now that record
// existed only in a table nobody could read.

import { APPVIEW } from '../src/config.js';
import { resolveActor } from '../src/lib/moderation/target.js';
import { select, selectAll, count } from './_lib/modDb.js';
import { listUri } from './_lib/listWrite.js';
import { authorize } from './_lib/serviceAuth.js';

const LXM = 'is.dame.mod.hub';

async function overview() {
  const [latest, settings] = await Promise.all([
    select('vouch', { select: 'taken_at', order: 'taken_at.desc', limit: 1 }),
    select('settings', { select: 'updated_at', eq: { id: 1 } }),
  ]);
  const takenAt = latest?.[0]?.taken_at ?? null;

  const [scored, protectedCount, plans, decisions, spend, session, audits] =
    await Promise.all([
      takenAt ? count('vouch', { eq: { taken_at: takenAt } }) : 0,
      count('protected'),
      count('plan'),
      count('decision'),
      selectAll('llm_usage', {
        select: 'at,kind,model,input_tokens,output_tokens',
        order: 'at.desc',
      }),
      select('bot_session', {
        select: 'handle,did,refreshed_at',
        eq: { id: 1 },
      }),
      select('audit', {
        select: 'id,list_uri,started_at,finished_at,total,scored',
        order: 'started_at.desc',
        limit: 5,
      }),
    ]);

  const tokens = spend.reduce(
    (t, r) => ({
      input: t.input + (r.input_tokens || 0),
      output: t.output + (r.output_tokens || 0),
    }),
    { input: 0, output: 0 },
  );

  return {
    snapshot: {
      takenAt,
      scored,
      protected: protectedCount,
      ageHours: takenAt
        ? Math.round((Date.now() - Date.parse(takenAt)) / 36e5)
        : null,
    },
    list: listUri(),
    bot: session?.[0] ?? null,
    plans,
    decisions,
    calls: spend.length,
    tokens,
    // Most recent first, so a run that scored nothing is visible next to the one
    // that scored everything rather than hidden behind "latest".
    audits: audits ?? [],
    settingsUpdated: settings?.[0]?.updated_at ?? null,
  };
}

/**
 * Why is this account on the list?
 *
 * Every decision ever recorded for them, with the plan that produced it and the
 * inputs the band was computed from. approved_via is the part that matters:
 * "you were in a category dame approved" and "dame read your profile and
 * decided" are different answers, and for a long time the log could not tell
 * them apart.
 */
async function why(actor) {
  const did = await resolveActor(actor);

  const [decisions, protectedRows, audits] = await Promise.all([
    selectAll('decision', {
      select:
        'plan_id,did,band,trust,distance,vouches,action,acted_at,approved_via,undone_at,undo_reason',
      eq: { did },
      order: 'plan_id.asc',
    }),
    select('protected', { select: 'reason,source,added_at', eq: { did } }),
    selectAll('audit_item', {
      select: 'audit_id,band,trust,vouches,followers,decision,decided_at',
      eq: { did },
      order: 'audit_id.asc',
    }),
  ]);

  const planIds = [...new Set(decisions.map((d) => d.plan_id))];
  const plans = [];
  for (const id of planIds) {
    const row = await select('plan', {
      select: 'id,created_at,approved_at,approved_bands,note',
      eq: { id },
    });
    if (row?.[0]) plans.push(row[0]);
  }

  return {
    did,
    actor,
    protected: protectedRows?.[0] ?? null,
    decisions,
    plans,
    audits,
  };
}

/** One page of the list, as profile cards. */
async function listPage(uri, cursor) {
  const u = new URL(`${APPVIEW}/xrpc/app.bsky.graph.getList`);
  u.searchParams.set('list', uri);
  u.searchParams.set('limit', '50');
  if (cursor) u.searchParams.set('cursor', cursor);
  const res = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`getList ${res.status}`);
  const body = await res.json();
  return {
    list: body.list ?? null,
    cursor: body.cursor ?? null,
    items: (body.items || []).map((i) => ({
      did: i.subject?.did,
      handle: i.subject?.handle,
      displayName: i.subject?.displayName ?? null,
      followers: i.subject?.followersCount ?? null,
    })),
  };
}

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;
  const action = req.body?.action || req.query?.action || 'overview';

  try {
    if (action === 'why') {
      const actor = req.body?.actor || req.query?.actor;
      if (!actor) return res.status(400).json({ error: 'pass actor' });
      return res.status(200).json(await why(actor));
    }
    if (action === 'list') {
      const uri = req.body?.listUri || listUri();
      return res
        .status(200)
        .json(await listPage(uri, req.body?.cursor || undefined));
    }
    return res.status(200).json(await overview());
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
