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
//   members    the same, with each account's band and how it got there
//   search     find someone on the list by handle
//   account    one account: profile, membership, band, and its whole record
//
// `why` is the one that matters. The whole system's claim is that a decision is
// replayable -- "here is exactly what it saw" -- and until now that record
// existed only in a table nobody could read.

import { APPVIEW } from '../src/config.js';
import { resolveActor } from '../src/lib/moderation/target.js';
import { resolvePds } from '../src/lib/atproto.js';
import { select, selectAll, count } from './_lib/modDb.js';
import { listUri } from './_lib/listWrite.js';
import { authorize } from './_lib/serviceAuth.js';
import {
  latestAudit,
  listitemRkeys,
  openItems,
  profilesFor,
  profileCard,
  shortCode,
} from './_lib/queue.js';

/**
 * Gateway prices, per token, by model id. Fetched from the gateway's public
 * catalogue rather than written down, so the estimate follows the price list.
 * Held for six hours; a failed fetch just means no dollar figure this time.
 */
let priceCache = { at: 0, prices: null };
async function prices() {
  if (priceCache.prices && Date.now() - priceCache.at < 6 * 3600_000) {
    return priceCache.prices;
  }
  try {
    const res = await fetch('https://ai-gateway.vercel.sh/v1/models');
    const body = await res.json();
    const map = new Map(
      (body?.data || []).map((m) => [
        m.id,
        {
          input: Number(m.pricing?.input) || 0,
          output: Number(m.pricing?.output) || 0,
        },
      ]),
    );
    priceCache = { at: Date.now(), prices: map };
    return map;
  } catch {
    return priceCache.prices;
  }
}

/** How many accounts the list holds, from the AppView. */
async function listSize(uri) {
  try {
    const u = new URL(`${APPVIEW}/xrpc/app.bsky.graph.getList`);
    u.searchParams.set('list', uri);
    u.searchParams.set('limit', '1');
    const res = await fetch(u, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    return {
      name: body?.list?.name ?? null,
      count: body?.list?.listItemCount ?? null,
      avatar: body?.list?.avatar ?? null,
    };
  } catch {
    return null;
  }
}

const LXM = 'is.dame.mod.hub';

export async function overview() {
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

  // Spend by model, priced at today's gateway rates. An estimate, and labelled
  // as one: reasoning tokens and cache discounts are not in these rows.
  const [price, size, queue] = await Promise.all([
    prices(),
    listSize(listUri()),
    openItems().catch(() => null),
  ]);
  const byModel = new Map();
  const weekAgo = Date.now() - 7 * 24 * 3600_000;
  let week = 0;
  for (const r of spend) {
    const m = byModel.get(r.model) || {
      model: r.model,
      calls: 0,
      input: 0,
      output: 0,
      usd: 0,
    };
    const p = price?.get(r.model);
    const usd = p
      ? (r.input_tokens || 0) * p.input + (r.output_tokens || 0) * p.output
      : 0;
    m.calls += 1;
    m.input += r.input_tokens || 0;
    m.output += r.output_tokens || 0;
    m.usd += usd;
    byModel.set(r.model, m);
    if (Date.parse(r.at) >= weekAgo) week += usd;
  }
  const models = [...byModel.values()].sort((a, b) => b.usd - a.usd);

  return {
    listInfo: size,
    queue: queue
      ? { total: queue.total, counts: queue.counts, decided: queue.decided }
      : null,
    cost: price
      ? {
          total: models.reduce((t, m) => t + m.usd, 0),
          week,
          models,
          priced: true,
        }
      : { priced: false, models },
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

/**
 * Every list the moderator account owns.
 *
 * The List tab used to assume one list and ask for it by a hardcoded URI, which
 * is a guess that was already wrong. The account can own several -- a block
 * list, a curation list, whatever gets made next -- and which one you want to
 * look at is a question with an answer the repo already holds.
 *
 * Read from the REPO rather than from the AppView: listRecords returns what the
 * account actually has, including a list the AppView has not indexed yet, and
 * it needs no auth.
 */
async function lists() {
  const bot = process.env.MOD_IDENTIFIER;
  const active = listUri();
  const owner = /^at:\/\/(did:[^/]+)\//.exec(active)?.[1];
  const repo = bot?.startsWith('did:') ? bot : owner;
  if (!repo) return { lists: [] };

  const pds = await resolvePds(repo);
  const out = [];
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    const url =
      `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(repo)}` +
      `&collection=app.bsky.graph.list&limit=100` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const body = await fetch(url, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!body) break;
    for (const rec of body.records || []) {
      out.push({
        uri: rec.uri,
        name: rec.value?.name ?? '(unnamed)',
        purpose: rec.value?.purpose ?? null,
        description: rec.value?.description ?? null,
        createdAt: rec.value?.createdAt ?? null,
        active: rec.uri === active,
      });
    }
    cursor = body.cursor;
    if (!cursor) break;
  }
  return { repo, active, lists: out };
}

/**
 * A page of the list as profile cards, each with its band from the latest
 * audit and the decision that put it there, if one is recorded. Accounts the
 * migration carried have no decision row; they were added in September and the
 * card says only what the audit knows.
 */
export async function members(uri, cursor) {
  const u = new URL(`${APPVIEW}/xrpc/app.bsky.graph.getList`);
  u.searchParams.set('list', uri);
  u.searchParams.set('limit', '50');
  if (cursor) u.searchParams.set('cursor', cursor);
  const res = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`getList ${res.status}`);
  const body = await res.json();
  const items = (body.items || []).map((i) => ({
    ...profileCard(i.subject || {}),
    listitem: i.uri ?? null,
  }));
  const enriched = await enrich(items);
  return {
    list: {
      uri,
      name: body.list?.name ?? null,
      count: body.list?.listItemCount ?? null,
    },
    cursor: body.cursor ?? null,
    items: enriched,
  };
}

/** Band from the latest audit, and how each account got onto the list. */
async function enrich(items) {
  const dids = items.map((i) => i.did).filter(Boolean);
  if (!dids.length) return items;
  const inList = `in.(${dids.map((d) => `"${d}"`).join(',')})`;
  const audit = await latestAudit().catch(() => null);
  const [bands, decisions, reviews] = await Promise.all([
    audit
      ? select('audit_item', {
          select: 'did,band,vouches,trust,protected_reason',
          eq: { audit_id: audit.id },
          where: { did: inList },
        }).catch(() => [])
      : [],
    select('decision', {
      select: 'did,plan_id,approved_via,acted_at,triage',
      where: {
        did: inList,
        acted_at: 'not.is.null',
        undone_at: 'is.null',
      },
      order: 'acted_at.desc',
    }).catch(() => []),
    select('review', {
      select: 'did,decision,decided_at',
      where: { did: inList },
    }).catch(() => []),
  ]);
  const band = new Map((bands || []).map((b) => [b.did, b]));
  const how = new Map();
  for (const d of decisions || []) if (!how.has(d.did)) how.set(d.did, d);
  const rev = new Map((reviews || []).map((r) => [r.did, r]));
  return items.map((i) => {
    const b = band.get(i.did);
    const d = how.get(i.did);
    return {
      ...i,
      band: b?.band ?? null,
      vouches: b?.vouches ?? null,
      protectedReason: b?.protected_reason ?? null,
      addedVia: d?.approved_via ?? null,
      addedAt: d?.acted_at ?? null,
      plan: d?.plan_id ? shortCode(d.plan_id) : null,
      label: d?.triage ?? null,
      reviewed: rev.get(i.did)?.decision ?? null,
    };
  });
}

/**
 * Find accounts on the list by handle.
 *
 * Searches the latest audit, which is a snapshot of the whole list with
 * handles, rather than paging 9,000 members through the AppView. Someone added
 * since that audit is found by typing their full handle, which resolves
 * directly and is checked against the list itself.
 */
export async function search(q) {
  const term = String(q || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  if (term.length < 2) return { items: [] };
  const list = listUri();

  let dids = [];
  const looksExact = /^did:[a-z]+:/.test(term) || /\.[a-z]{2,}$/.test(term);
  if (looksExact) {
    const did = await resolveActor(term).catch(() => null);
    if (did) dids.push(did);
  }
  const audit = await latestAudit(list).catch(() => null);
  if (audit) {
    const safe = term.replace(/[^a-z0-9._:-]/g, '');
    if (safe) {
      const rows = await select('audit_item', {
        select: 'did',
        eq: { audit_id: audit.id },
        where: { handle: `ilike.*${safe}*` },
        order: 'trust.desc',
        limit: 30,
      }).catch(() => []);
      dids.push(...(rows || []).map((r) => r.did));
    }
  }
  dids = [...new Set(dids)].slice(0, 30);
  const [profiles, membership] = await Promise.all([
    profilesFor(dids),
    Promise.all(dids.map((d) => listitemRkeys(list, d).catch(() => null))),
  ]);
  const items = dids
    .map((did, n) => ({
      ...(profiles.get(did) || { did }),
      onList: Array.isArray(membership[n]) ? membership[n].length > 0 : null,
    }))
    // An exact lookup of someone who is not on the list still answers the
    // question that was asked; a fuzzy match that is not on the list does not.
    .filter((i) => i.onList !== false || (looksExact && dids[0] === i.did));
  return { items: await enrich(items) };
}

/** One account, everything at once: the detail sheet's single request. */
export async function account(actor) {
  const list = listUri();
  const record = await why(actor);
  const [profiles, rkeys, audit, reviewRows] = await Promise.all([
    profilesFor([record.did]),
    listitemRkeys(list, record.did).catch(() => null),
    latestAudit(list).catch(() => null),
    select('review', {
      select: 'decision,reason,band,decided_at,note',
      eq: { did: record.did },
    }).catch(() => []),
  ]);
  const band = audit
    ? await select('audit_item', {
        select: 'band,trust,vouches,followers,protected_reason',
        eq: { audit_id: audit.id, did: record.did },
      }).catch(() => [])
    : [];
  return {
    ...record,
    profile: profiles.get(record.did) ?? { did: record.did },
    onList: Array.isArray(rkeys) ? rkeys.length > 0 : null,
    score: band?.[0] ?? null,
    scoredAt: audit?.finished_at ?? null,
    review: reviewRows?.[0] ?? null,
    plans: record.plans.map((p) => ({ ...p, code: shortCode(p.id) })),
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
    if (action === 'lists') {
      return res.status(200).json(await lists());
    }
    if (action === 'members') {
      const uri = req.body?.listUri || listUri();
      return res
        .status(200)
        .json(await members(uri, req.body?.cursor || undefined));
    }
    if (action === 'search') {
      return res.status(200).json(await search(req.body?.q));
    }
    if (action === 'account') {
      const actor = req.body?.actor;
      if (!actor) return res.status(400).json({ error: 'pass actor' });
      return res.status(200).json(await account(actor));
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
