// Server half of the managed graph lists (src/lib/graphLists.js decides who;
// this reads the inputs and writes the lists).
//
// WHO WRITES. Everything here acts as dame, through the app password the
// iNaturalist and Are.na mirrors already use (BSKY_APP_PASSWORD). The lists
// have to live in dame's repo to be dame's lists, and the cron has no browser
// session to borrow. The admin panel never writes these records itself: it asks
// this endpoint, so the one writer is also the one that previews, and the
// preview is exactly what the next sync would do.
//
// WHERE THINGS LIVE.
//   is.dame.graph.list/<key>   one record per managed list: the rule, the
//                              Bluesky list it drives, and the last sync's
//                              counts. Public, like every record; it holds
//                              counts, never who joined or left.
//   app.bsky.graph.list        the Bluesky list itself, a curation list.
//   app.bsky.graph.listitem    its members, created and deleted by the diff.
//
// WHERE THE SIGNALS COME FROM. The same sweeps the Analytics studio runs in the
// browser (src/lib/analyticsSync.js), pointed at a server-side agent:
// notifications for inbound, dame's own like/repost/post records for outbound,
// follow records for who dame follows. Proximity comes from the moderation
// gate's vouch snapshot in Supabase, so a 2nd-degree account here is the same
// account with the same count that the moderation queue would show.
//
// THE DIFF IS RECOMPUTED FROM THE LIST EVERY TIME. Nothing remembers what the
// last run meant to write. A run that stops on its write budget, a timeout, or
// two runs overlapping all converge on the next pass, because each one reads
// what is actually on the list and plans from there (planSync also removes a
// doubled listitem).

import { AtpAgent } from '@atproto/api';
import { APPVIEW, ME_DID, ME_HANDLE } from '../../src/config.js';
import { resolveIdentifier, resolveProfiles } from '../../src/lib/atproto.js';
import {
  sweepFollowing,
  sweepInbound,
  sweepOutbound,
} from '../../src/lib/analyticsSync.js';
import {
  compactPostFromRecord,
  outboundFromPosts,
} from '../../src/lib/analytics.js';
import {
  assignBand,
  DEFAULT_THRESHOLDS,
} from '../../src/lib/moderation/score.js';
import {
  CURATE_PURPOSE,
  GRAPH_LIST_NSID,
  MAX_LIST_SIZE,
  MAX_WRITES_PER_RUN,
  degreeBreakdown,
  normalizeDefinition,
  placeOf,
  planSync,
  rankEngagement,
  selectMembers,
  slugKey,
} from '../../src/lib/graphLists.js';
import { select } from './modDb.js';
import { listUri as modListUri } from './listWrite.js';
import { graphFacts } from './graphFacts.js';

const DAY_MS = 86_400_000;
const LIST = 'app.bsky.graph.list';
const LISTITEM = 'app.bsky.graph.listitem';
const POST = 'app.bsky.feed.post';

/** applyWrites batch size. The reference PDS allows 200; half is plenty. */
const WRITE_BATCH = 100;

/** How long gathered signals are reused by a warm instance. */
const SIGNALS_TTL_MS = 5 * 60_000;

/** How many history entries a definition keeps. */
const HISTORY = 30;

/* ------------------------------------------------------------------ */
/* Session                                                              */
/* ------------------------------------------------------------------ */

let owner = null;

/**
 * dame's agent, logged in with the app password and held for twenty minutes.
 * createSession is capped at 300 a day; a cron every six hours plus a few
 * clicks is nowhere near that, but a fresh login per request would be.
 */
export async function ownerAgent() {
  if (owner && Date.now() - owner.at < 20 * 60_000) return owner;
  const identifier =
    process.env.BSKY_IDENTIFIER || process.env.ATP_IDENTIFIER || ME_HANDLE;
  const password =
    process.env.BSKY_APP_PASSWORD || process.env.ATP_APP_PASSWORD;
  if (!password) throw new Error('BSKY_APP_PASSWORD is not configured');
  const { did, pds } = await resolveIdentifier(identifier);
  if (did !== ME_DID)
    throw new Error(`the app password logs in as ${did}, not the site owner`);
  const agent = new AtpAgent({ service: pds });
  await agent.login({ identifier, password });
  owner = { agent, did, pds, at: Date.now() };
  return owner;
}

/* ------------------------------------------------------------------ */
/* Repo reads                                                           */
/* ------------------------------------------------------------------ */

async function allRecords(agent, collection, { maxPages = 200 } = {}) {
  const out = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    let res;
    try {
      res = await agent.com.atproto.repo.listRecords({
        repo: ME_DID,
        collection,
        limit: 100,
        cursor,
      });
    } catch (err) {
      if (/could not locate|not found/i.test(err?.message || '')) break;
      throw err;
    }
    out.push(...(res?.data?.records || []));
    cursor = res?.data?.cursor;
    if (!cursor || !res?.data?.records?.length) break;
  }
  return out;
}

/** Every managed-list definition, keyed by rkey. */
export async function readDefinitions(agent) {
  const rows = await allRecords(agent, GRAPH_LIST_NSID, { maxPages: 5 });
  return rows
    .map((r) => {
      const key = r.uri.split('/').pop();
      const def = normalizeDefinition(r.value);
      if (!def) return null;
      return {
        key,
        uri: r.uri,
        ...def,
        lastSync: r.value.lastSync || null,
        history: r.value.history || [],
        createdAt: r.value.createdAt || null,
      };
    })
    .filter(Boolean);
}

/** Every listitem in dame's repo, grouped by list. */
async function listMembers(agent) {
  const rows = await allRecords(agent, LISTITEM);
  const byList = new Map();
  for (const r of rows) {
    const list = r.value?.list;
    const did = r.value?.subject;
    if (!list || !did) continue;
    if (!byList.has(list)) byList.set(list, []);
    byList.get(list).push({ did, uri: r.uri });
  }
  return byList;
}

/** dame's own posts in the window, as outbound reply/quote events. */
async function recentPostEvents(agent, cutoffMs) {
  const events = [];
  let cursor;
  for (let page = 0; page < 40; page += 1) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: ME_DID,
      collection: POST,
      limit: 100,
      cursor,
    });
    const batch = res?.data?.records || [];
    const posts = batch
      .map((r) => compactPostFromRecord(r.uri, r.value))
      .filter(Boolean);
    events.push(
      ...outboundFromPosts(posts.filter((p) => Date.parse(p.at) >= cutoffMs)),
    );
    cursor = res?.data?.cursor;
    // Newest first by rkey; a page that is entirely older than the window ends it.
    if (
      !cursor ||
      !batch.length ||
      posts.every((p) => Date.parse(p.at) < cutoffMs)
    )
      break;
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* The vouch snapshot                                                   */
/* ------------------------------------------------------------------ */

async function latestSnapshot() {
  const rows = await select('vouch', {
    select: 'taken_at',
    order: 'taken_at.desc',
    limit: 1,
  });
  return rows?.[0]?.taken_at ?? null;
}

/**
 * The most-vouched accounts, at least `min` each, up to `limit` of them.
 * Ordered by the count so a capped read keeps the top of the table, which is
 * the only part a capped list can use.
 */
async function topVouches(takenAt, min, limit) {
  const out = new Map();
  for (let offset = 0; offset < limit; offset += 1000) {
    const rows = await select('vouch', {
      select: 'did,vouches',
      eq: { taken_at: takenAt },
      where: { vouches: `gte.${min}` },
      order: 'vouches.desc,did.asc',
      limit: Math.min(1000, limit - offset),
      offset,
    });
    for (const r of rows || []) out.set(r.did, r.vouches);
    if (!rows || rows.length < 1000) break;
  }
  return out;
}

/** Vouch counts for specific accounts. Absent means zero. */
export async function vouchesFor(takenAt, dids) {
  const out = new Map();
  const list = [...new Set(dids)];
  for (let i = 0; i < list.length; i += 80) {
    const chunk = list.slice(i, i + 80);
    const rows = await select('vouch', {
      select: 'did,vouches',
      eq: { taken_at: takenAt },
      where: { did: `in.(${chunk.map((d) => `"${d}"`).join(',')})` },
    });
    for (const r of rows || []) out.set(r.did, r.vouches);
  }
  return out;
}

/** Which of `dids` follow dame back. Public, unauthenticated, 30 a call. */
async function followsBack(dids) {
  const out = new Set();
  for (let i = 0; i < dids.length; i += 30) {
    const q = dids
      .slice(i, i + 30)
      .map((d) => `others=${encodeURIComponent(d)}`)
      .join('&');
    try {
      const res = await fetch(
        `${APPVIEW}/xrpc/app.bsky.graph.getRelationships?actor=${encodeURIComponent(ME_DID)}&${q}`,
        { headers: { Accept: 'application/json' } },
      );
      const body = res.ok ? await res.json() : null;
      for (const r of body?.relationships || [])
        if (r?.did && r.followedBy) out.add(r.did);
    } catch {
      /* a chunk we could not read stays "not known to follow back" */
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Signals                                                              */
/* ------------------------------------------------------------------ */

let signalsCache = null;

/**
 * Everything the rules read, for one window. Held for five minutes so a
 * preview followed by a sync (or the Graph tab opening beside them) gathers
 * once.
 *
 * `vouchFloor` and `vouchLimit` bound the read of the snapshot to what the
 * proximity lists can use. The snapshot holds 82k accounts at one vouch or
 * more; a list capped at 150 needs the top few hundred.
 */
export async function gatherSignals({
  windowDays = 30,
  vouchFloor = 1,
  vouchLimit = 2000,
  fresh = false,
} = {}) {
  const key = `${windowDays}|${vouchFloor}|${vouchLimit}`;
  if (
    !fresh &&
    signalsCache?.key === key &&
    Date.now() - signalsCache.at < SIGNALS_TTL_MS
  ) {
    return signalsCache.value;
  }
  const { agent } = await ownerAgent();
  const cutoffMs = Date.now() - windowDays * DAY_MS;

  const [inbound, outbound, postEvents, follows, takenAt, facts] =
    await Promise.all([
      sweepInbound(agent, { cutoffMs }),
      sweepOutbound(agent, ME_DID, { cutoffMs }),
      recentPostEvents(agent, cutoffMs).catch(() => []),
      sweepFollowing(agent, ME_DID),
      latestSnapshot().catch(() => null),
      graphFacts({ list: modListUri() }).catch(() => null),
    ]);
  if (follows.error)
    throw new Error(`could not read who you follow: ${follows.error}`);
  if (inbound.error)
    throw new Error(`could not read notifications: ${inbound.error}`);
  if (outbound.error)
    throw new Error(`could not read your likes and reposts: ${outbound.error}`);

  const following = new Set(follows.following.map((f) => f.did));
  const vouches = takenAt
    ? await topVouches(takenAt, vouchFloor, vouchLimit + following.size)
    : new Map();
  const mutuals = await followsBack([...following]);

  const excluded = new Set([ME_DID]);
  // Accounts on the moderation list never go on a managed list. If the list
  // could not be read that is said, not assumed empty.
  const modListed = facts?.listed || null;
  if (modListed) for (const did of modListed) excluded.add(did);

  const value = {
    gatheredAt: new Date().toISOString(),
    windowDays,
    inbound: inbound.events,
    outbound: [...outbound.events, ...postEvents],
    following,
    followers: mutuals,
    vouches,
    takenAt,
    excluded,
    coverage: {
      inboundComplete: inbound.complete,
      inboundTruncated: inbound.truncated,
      inboundReachedMs: inbound.reachedMs,
      outboundComplete: outbound.complete,
      snapshotAt: takenAt,
      modListRead: Boolean(modListed),
    },
  };
  signalsCache = { key, at: Date.now(), value };
  return value;
}

/** The read bounds that cover every proximity rule in `defs`. */
export function vouchBounds(defs) {
  const prox = defs.filter((d) => d.kind === 'proximity' && d.maxDegree >= 2);
  if (!prox.length) return { vouchFloor: 3, vouchLimit: 500 };
  return {
    vouchFloor: Math.min(...prox.map((d) => d.minVouches)),
    vouchLimit: Math.min(
      20_000,
      Math.max(...prox.map((d) => Math.ceil(d.size * 1.2))) + 200,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Cards                                                                */
/* ------------------------------------------------------------------ */

/** Profile cards with each account's place in the graph and its band. */
export async function cardsFor(dids, signals, extra = new Map()) {
  const profiles = await resolveProfiles(dids);
  return dids.map((did) => {
    const p = profiles[did] || {};
    const place = placeOf(did, signals);
    const band = assignBand(
      {
        vouches: place.vouches,
        followers: p.followers || 0,
        protectedReason: place.youFollow ? 'you follow them' : null,
      },
      DEFAULT_THRESHOLDS,
    );
    return {
      did,
      handle: p.handle || null,
      displayName: p.displayName || null,
      avatar: p.avatar || null,
      followers: p.followers ?? null,
      ...place,
      band,
      ...(extra.get(did) || {}),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Definitions                                                          */
/* ------------------------------------------------------------------ */

function recordFor(def, prev = {}) {
  const now = new Date().toISOString();
  // The rule's own fields only: never the rkey, the record URI, or anything a
  // caller tacked on (a live member count, a preset name).
  const rule = normalizeDefinition(def);
  return {
    $type: GRAPH_LIST_NSID,
    ...rule,
    listUri: def.listUri || null,
    lastSync: prev.lastSync ?? def.lastSync ?? null,
    history: prev.history ?? def.history ?? [],
    createdAt: prev.createdAt || def.createdAt || now,
    updatedAt: now,
  };
}

/**
 * Create or update a definition. A new one gets its Bluesky list made here; an
 * existing one has the list's name and description kept in step.
 */
export async function saveDefinition(input) {
  const def = normalizeDefinition(input);
  if (!def) throw new Error('unknown list kind');
  const { agent } = await ownerAgent();
  const existing = (await readDefinitions(agent)).find(
    (d) => d.key === input.key,
  );
  const key =
    existing?.key || (await freeKey(agent, slugKey(input.key || def.name)));

  // Only a list this endpoint made is ever attached. Pointing a rule at a
  // hand-curated list would have the first sync delete everyone the rule
  // does not pick.
  let listUri = existing?.listUri || null;
  if (!listUri) {
    const made = await agent.com.atproto.repo.createRecord({
      repo: ME_DID,
      collection: LIST,
      record: {
        $type: LIST,
        purpose: CURATE_PURPOSE,
        name: def.name,
        description: def.description,
        createdAt: new Date().toISOString(),
      },
    });
    listUri = made.data.uri;
  } else {
    await renameList(agent, listUri, def);
  }

  const record = recordFor({ ...def, listUri }, existing || {});
  await agent.com.atproto.repo.putRecord({
    repo: ME_DID,
    collection: GRAPH_LIST_NSID,
    rkey: key,
    record,
  });
  return { key, ...record };
}

async function freeKey(agent, base) {
  const taken = new Set(
    (await allRecords(agent, GRAPH_LIST_NSID, { maxPages: 5 })).map((r) =>
      r.uri.split('/').pop(),
    ),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1)
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  throw new Error('no free key');
}

async function renameList(agent, listUri, def) {
  const rkey = listUri.split('/').pop();
  try {
    const { data } = await agent.com.atproto.repo.getRecord({
      repo: ME_DID,
      collection: LIST,
      rkey,
    });
    if (
      data.value?.name === def.name &&
      (data.value?.description || '') === def.description
    )
      return;
    await agent.com.atproto.repo.putRecord({
      repo: ME_DID,
      collection: LIST,
      rkey,
      record: { ...data.value, name: def.name, description: def.description },
      swapRecord: data.cid,
    });
  } catch {
    // A list deleted in another client: the next sync will say so.
  }
}

/**
 * Stop managing a list. With `deleteList`, the Bluesky list and its members go
 * too; without, the list is left exactly as it stands and simply stops moving.
 */
export async function removeDefinition(key, { deleteList = false } = {}) {
  const { agent } = await ownerAgent();
  const def = (await readDefinitions(agent)).find((d) => d.key === key);
  if (!def) throw new Error(`no managed list called ${key}`);
  let removed = 0;
  if (deleteList && def.listUri) {
    const items = (await listMembers(agent)).get(def.listUri) || [];
    removed = await applyPlan(agent, def.listUri, { add: [], remove: items });
    await agent.com.atproto.repo
      .deleteRecord({
        repo: ME_DID,
        collection: LIST,
        rkey: def.listUri.split('/').pop(),
      })
      .catch(() => null);
  }
  await agent.com.atproto.repo.deleteRecord({
    repo: ME_DID,
    collection: GRAPH_LIST_NSID,
    rkey: key,
  });
  return { key, deletedList: deleteList, removed };
}

/* ------------------------------------------------------------------ */
/* Preview and sync                                                     */
/* ------------------------------------------------------------------ */

async function applyPlan(agent, listUri, plan) {
  const now = new Date().toISOString();
  const writes = [
    ...plan.remove.map((item) => ({
      $type: 'com.atproto.repo.applyWrites#delete',
      collection: LISTITEM,
      rkey: item.uri.split('/').pop(),
    })),
    ...plan.add.map((did) => ({
      $type: 'com.atproto.repo.applyWrites#create',
      collection: LISTITEM,
      value: { $type: LISTITEM, subject: did, list: listUri, createdAt: now },
    })),
  ];
  for (let i = 0; i < writes.length; i += WRITE_BATCH) {
    await agent.com.atproto.repo.applyWrites({
      repo: ME_DID,
      writes: writes.slice(i, i + WRITE_BATCH),
    });
  }
  return writes.length;
}

/**
 * Who a definition would put on its list now, and what that would change.
 * Writes nothing.
 */
export async function preview(input, { limit = 100 } = {}) {
  const def = normalizeDefinition(input);
  if (!def) throw new Error('unknown list kind');
  const { agent } = await ownerAgent();
  const signals = await gatherSignals({
    windowDays: def.windowDays,
    ...vouchBounds([def]),
  });
  const current = def.listUri
    ? (await listMembers(agent)).get(def.listUri) || []
    : [];
  const incumbents = new Set(current.map((c) => c.did));
  const { rows, eligible } = selectMembers(def, signals, incumbents);
  const plan = planSync(
    current,
    rows.map((r) => r.did),
  );
  const extra = new Map(
    rows.map((r) => [
      r.did,
      {
        total: r.total ?? null,
        byKind: r.byKind ?? null,
        onList: incumbents.has(r.did),
      },
    ]),
  );
  return {
    definition: def,
    size: rows.length,
    eligible,
    adds: plan.add.length,
    removes: plan.remove.length,
    kept: plan.kept,
    members: await cardsFor(
      rows.slice(0, limit).map((r) => r.did),
      signals,
      extra,
    ),
    leaving: await cardsFor(
      plan.remove.slice(0, 25).map((r) => r.did),
      signals,
    ),
    coverage: signals.coverage,
  };
}

/**
 * Bring every enabled list (or the one named) into line with its rule.
 *
 * @returns {Promise<{lists: Array, writes: number, pending: number, coverage: object}>}
 */
export async function syncAll({ only = null, budgetMs = 40_000 } = {}) {
  const started = Date.now();
  const { agent } = await ownerAgent();
  const defs = (await readDefinitions(agent)).filter((d) =>
    only ? d.key === only : d.enabled,
  );
  if (!defs.length) return { lists: [], writes: 0, pending: 0, coverage: null };

  // One window per run keeps the gather to one pass. Definitions with another
  // window are gathered for separately.
  const byWindow = new Map();
  for (const d of defs) {
    if (!byWindow.has(d.windowDays)) byWindow.set(d.windowDays, []);
    byWindow.get(d.windowDays).push(d);
  }

  const members = await listMembers(agent);
  let budget = MAX_WRITES_PER_RUN;
  let writes = 0;
  let pending = 0;
  let coverage = null;
  const out = [];

  for (const [windowDays, group] of byWindow) {
    const signals = await gatherSignals({
      windowDays,
      ...vouchBounds(group),
      fresh: true,
    });
    coverage = signals.coverage;
    for (const def of group) {
      const at = new Date().toISOString();
      if (Date.now() - started > budgetMs) {
        out.push({
          key: def.key,
          skipped: 'out of time; the next run picks it up',
        });
        continue;
      }
      try {
        if (!def.listUri) throw new Error('no Bluesky list attached');
        const current = members.get(def.listUri) || [];
        const incumbents = new Set(current.map((c) => c.did));
        const { rows, eligible } = selectMembers(def, signals, incumbents);
        const plan = planSync(
          current,
          rows.map((r) => r.did),
          { maxWrites: budget },
        );
        const n = await applyPlan(agent, def.listUri, plan);
        budget -= n;
        writes += n;
        pending += plan.pending;
        const lastSync = {
          at,
          size: plan.kept + plan.add.length,
          target: rows.length,
          eligible,
          added: plan.add.length,
          removed: plan.remove.length,
          pending: plan.pending,
          error: null,
        };
        await writeStatus(agent, def, lastSync);
        out.push({
          key: def.key,
          ...lastSync,
          addedDids: plan.add.slice(0, 50),
          removedDids: plan.remove.slice(0, 50).map((r) => r.did),
        });
      } catch (err) {
        const lastSync = {
          ...(def.lastSync || {}),
          at,
          error: String(err?.message || err),
        };
        await writeStatus(agent, def, lastSync).catch(() => null);
        out.push({ key: def.key, error: lastSync.error });
      }
    }
  }
  return { lists: out, writes, pending, coverage };
}

async function writeStatus(agent, def, lastSync) {
  const history = [
    {
      at: lastSync.at,
      size: lastSync.size ?? null,
      added: lastSync.added ?? 0,
      removed: lastSync.removed ?? 0,
    },
    ...(def.history || []),
  ].slice(0, HISTORY);
  const record = recordFor(
    { ...def, lastSync, history },
    { lastSync, history, createdAt: def.createdAt },
  );
  await agent.com.atproto.repo.putRecord({
    repo: ME_DID,
    collection: GRAPH_LIST_NSID,
    rkey: def.key,
    record,
  });
}

/* ------------------------------------------------------------------ */
/* Status and the orbit                                                 */
/* ------------------------------------------------------------------ */

/** Definitions with their lists' live sizes. Cheap: no signal gather. */
export async function status() {
  const { agent } = await ownerAgent();
  const [defs, members] = await Promise.all([
    readDefinitions(agent),
    listMembers(agent),
  ]);
  return {
    maxSize: MAX_LIST_SIZE,
    maxWritesPerRun: MAX_WRITES_PER_RUN,
    lists: defs.map((d) => ({
      ...d,
      members: (members.get(d.listUri) || []).length,
    })),
  };
}

/**
 * The Graph tab's picture: where the people around you sit.
 *
 * Nodes are everyone you follow, the people you and they engaged with most in
 * the window, and the closest 2nd-degree accounts you don't follow. The
 * breakdowns cover everyone who engaged either way in the window, not just the
 * drawn nodes.
 */
export async function orbit({
  windowDays = 30,
  perSide = 60,
  secondDegree = 40,
} = {}) {
  const signals = await gatherSignals({
    windowDays,
    vouchFloor: 3,
    vouchLimit: secondDegree + 400,
  });
  const t0 = Date.now() - windowDays * DAY_MS;
  const inRank = rankEngagement(signals.inbound, { t0, excludeDid: ME_DID });
  const outRank = rankEngagement(signals.outbound, { t0, excludeDid: ME_DID });

  // Engagers need their own vouch counts: the capped read above only holds
  // the top of the table.
  const engagers = [...new Set([...inRank, ...outRank].map((r) => r.did))];
  const extraVouches = signals.takenAt
    ? await vouchesFor(signals.takenAt, engagers)
    : new Map();
  const vouches = new Map([...signals.vouches, ...extraVouches]);
  const ctx = { ...signals, vouches };

  const inBy = new Map(inRank.map((r) => [r.did, r.total]));
  const outBy = new Map(outRank.map((r) => [r.did, r.total]));
  const close = [...vouches]
    .filter(
      ([did]) => !signals.following.has(did) && !signals.excluded.has(did),
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, secondDegree)
    .map(([did]) => did);

  const nodeDids = [
    ...new Set([
      ...signals.following,
      ...inRank.slice(0, perSide).map((r) => r.did),
      ...outRank.slice(0, perSide).map((r) => r.did),
      ...close,
    ]),
  ].filter((did) => !signals.excluded.has(did) || signals.following.has(did));

  const extra = new Map(
    nodeDids.map((did) => [
      did,
      { in: inBy.get(did) || 0, out: outBy.get(did) || 0 },
    ]),
  );
  const nodes = await cardsFor(nodeDids, ctx, extra);

  return {
    windowDays,
    gatheredAt: signals.gatheredAt,
    snapshotAt: signals.takenAt,
    following: signals.following.size,
    mutuals: signals.followers.size,
    maxVouches: Math.max(1, ...[...vouches.values()]),
    breakdown: {
      inbound: degreeBreakdown(
        inRank.map((r) => r.did),
        ctx,
      ),
      outbound: degreeBreakdown(
        outRank.map((r) => r.did),
        ctx,
      ),
    },
    nodes,
    coverage: signals.coverage,
  };
}
