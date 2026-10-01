// Browser side of the moderation endpoints.
//
// The admin panel holds an atproto OAuth session, so it can ask the PDS for a
// token signed by dame's own key and present that instead of a password. Tokens
// live about a minute and are scoped to a single method.
//
// They are REUSED until shortly before they expire. Minting one per call put a
// round trip to the PDS in front of every request, which is most of why the hub
// felt slow: opening the queue was a mint, then the call, then another mint for
// the overview beside it. One token per method per minute is the same exposure
// as before (the server already accepts any unexpired token for its method) at
// a fraction of the waiting.
//
// See api/_lib/serviceAuth.js for the verifying half.

import { ME_DID } from '../../config.js';

/** Must match the LXM constants in the endpoints. */
export const LXM = {
  preflight: 'is.dame.mod.preflight',
  precompute: 'is.dame.mod.precompute',
  audit: 'is.dame.mod.audit',
  remove: 'is.dame.mod.remove',
  migrate: 'is.dame.mod.migrate',
  config: 'is.dame.mod.config',
  hub: 'is.dame.mod.hub',
  plan: 'is.dame.mod.plan',
  queue: 'is.dame.mod.queue',
};

/**
 * Mint a service-auth token for one call.
 *
 * `aud` is dame's own DID: this site has no service DID, so the claim being
 * made is simply "the holder of dame's signing key asked for this". The PDS
 * keeps the lifetime short on its own; the endpoint refuses anything longer
 * than ten minutes regardless.
 */
const tokens = new Map();

/** The `exp` claim of a JWT, in milliseconds, or 0 if it cannot be read. */
export function tokenExpiry(token) {
  try {
    const part = String(token).split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = Number(JSON.parse(json).exp);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Seconds of life a cached token must still have to be handed out. */
const TOKEN_MARGIN_MS = 15_000;

async function mint(agent, lxm) {
  const key = `${agent?.session?.did ?? agent?.did ?? ''}|${lxm}`;
  const hit = tokens.get(key);
  if (hit?.token && hit.exp - Date.now() > TOKEN_MARGIN_MS) return hit.token;
  // Two panels asking at once share one mint rather than racing two.
  if (hit?.pending) return hit.pending;
  const pending = agent.com.atproto.server
    .getServiceAuth({ aud: ME_DID, lxm })
    .then((res) => {
      const token = res?.data?.token;
      if (!token)
        throw new Error('the PDS did not return a service auth token');
      tokens.set(key, { token, exp: tokenExpiry(token) });
      return token;
    })
    .catch((err) => {
      tokens.delete(key);
      throw err;
    });
  tokens.set(key, { pending });
  return pending;
}

async function call(agent, path, { lxm, body, signal } = {}) {
  const token = await mint(agent, lxm);
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body here means the platform answered, not the handler —
    // a Vercel timeout page or an auth redirect. Say so rather than showing
    // the user a JSON parse error from deep in the stack.
    throw new Error(
      `${path} returned ${res.status} with a non-JSON body (${text.slice(0, 120)})`,
    );
  }
  if (!res.ok)
    throw new Error(parsed?.error || `${path} returned ${res.status}`);
  return parsed;
}

/**
 * Score everyone who interacted with a post.
 *
 * Read-only. Nothing is blocked, muted or listed by this call — it answers what
 * a bulk action WOULD hit, which is the question the old workflow could not ask.
 */
export function preflight(agent, link, { dry = false, signal } = {}) {
  return call(agent, `/api/mod-preflight${dry ? '?dry=1' : ''}`, {
    lxm: LXM.preflight,
    body: { link },
    signal,
  });
}

/** Snapshot status, or nudge the reference build along. */
export function precomputeStatus(agent, { restart = false, signal } = {}) {
  return call(agent, `/api/mod-precompute${restart ? '?restart=1' : ''}`, {
    lxm: LXM.precompute,
    body: {},
    signal,
  });
}

/** Band → how it should read on screen. Order is severity, loudest first. */
export const BAND_META = [
  {
    key: 'PROTECTED',
    label: 'Protected',
    hint: 'You follow them, or they are on one of your curation lists. No automated path can touch these.',
  },
  {
    key: 'CONNECTED',
    label: 'Connected',
    hint: 'Several of the people you follow also follow them, or one does and they have real reach.',
  },
  {
    key: 'PERIPHERAL',
    label: 'Peripheral',
    hint: 'One or two of the people you follow also follow them.',
  },
  {
    key: 'NOTABLE',
    label: 'Notable',
    hint: 'No connection to your circle, but a large audience or an unusually loud account.',
  },
  {
    key: 'UNKNOWN',
    label: 'Unknown',
    hint: 'No connection found and nothing notable. This is the bulk of any stranger sweep.',
  },
];

/** Engagement kind → a verb phrase, for reading a row aloud. */
export const KIND_LABEL = {
  quote: 'quoted',
  reply: 'replied',
  threadReply: 'in thread',
  repost: 'reposted',
  like: 'liked',
  gate: 'gated',
};

export function describeEngagements(engagements = {}) {
  return Object.entries(engagements)
    .map(([kind, n]) => {
      const label = KIND_LABEL[kind] || kind;
      return n > 1 ? `${label} ×${n}` : label;
    })
    .join(', ');
}

/* ------------------------------------------------------------------ audit */

/**
 * Score the members of an existing list.
 *
 * Resumable: call with no action to continue, and keep calling until `state`
 * comes back `finished`. Scoring ~8,700 accounts is more API calls than fit in
 * one invocation.
 */
export function auditRun(agent, { listUri, start = false, signal } = {}) {
  return call(agent, '/api/mod-audit', {
    lxm: LXM.audit,
    body: start ? { action: 'start', listUri } : {},
    signal,
  });
}

/** The queue: audited members that no longer score UNKNOWN and are undecided. */
export function auditReview(agent, { signal } = {}) {
  return call(agent, '/api/mod-audit', {
    lxm: LXM.audit,
    body: { action: 'review' },
    signal,
  });
}

/** Record keep/remove against audited members. Does not touch the list. */
export function auditDecide(agent, decisions, { signal } = {}) {
  return call(agent, '/api/mod-audit', {
    lxm: LXM.audit,
    body: { action: 'decide', decisions },
    signal,
  });
}

/** at://<did>/... — the repo segment is who owns the record. */
function ownerOf(uri) {
  const match = String(uri || '').match(/^at:\/\/(did:[^/]+)\//);
  return match ? match[1] : null;
}

/**
 * Remove accounts from a list, whoever owns it.
 *
 * Routes on ownership rather than assuming, because the answer changes the
 * moment the migration succeeds. A list in dame's repo can only be written by
 * dame's own session, so those deletes happen here in the browser. A list on
 * the moderator account cannot be written from here at all — the browser holds
 * no credential for it — so those go to the server, which does.
 *
 * The previous version hardcoded the browser's own DID as the repo. Against a
 * moderator-owned list that listed dame's records, matched none of them, and
 * reported success having removed nothing.
 */
export async function removeFromList(
  agent,
  listUri,
  dids,
  { onProgress } = {},
) {
  const wanted = [...new Set(dids)];
  if (!wanted.length) return { removed: 0, found: 0, asked: 0 };

  const me = agent.session?.did ?? agent.did;
  const owner = ownerOf(listUri);
  if (!owner) throw new Error('listUri is not an at:// URI');

  if (owner !== me) {
    // Not ours to write. The server holds the moderator credential; it will
    // refuse in turn if the list is not the moderator's either, so a typo in
    // the list URI surfaces as an error rather than as a silent no-op.
    return call(agent, '/api/mod-remove', {
      lxm: LXM.remove,
      body: { listUri, dids: wanted },
    });
  }

  // Map subject -> rkey by reading the listitems back. The audit stores DIDs,
  // not record keys, because a listitem can be recreated and the rkey would go
  // stale in the table while the membership did not.
  const want = new Set(wanted);
  const rkeys = [];
  let cursor;
  for (let page = 0; page < 200; page += 1) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: me,
      collection: 'app.bsky.graph.listitem',
      limit: 100,
      cursor,
    });
    for (const rec of res.data.records || []) {
      if (rec.value?.list !== listUri) continue;
      if (!want.has(rec.value?.subject)) continue;
      rkeys.push(rec.uri.split('/').pop());
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }

  let removed = 0;
  for (let i = 0; i < rkeys.length; i += 50) {
    const slice = rkeys.slice(i, i + 50);
    await agent.com.atproto.repo.applyWrites({
      repo: me,
      writes: slice.map((rkey) => ({
        $type: 'com.atproto.repo.applyWrites#delete',
        collection: 'app.bsky.graph.listitem',
        rkey,
      })),
    });
    removed += slice.length;
    onProgress?.({ removed, total: rkeys.length });
  }
  return { removed, found: rkeys.length, asked: wanted.length };
}

/* -------------------------------------------------------------- migration */

export function migrateStart(
  agent,
  { sourceList, carryBands, name, signal } = {},
) {
  return call(agent, '/api/mod-migrate', {
    lxm: LXM.migrate,
    body: { action: 'start', sourceList, carryBands, name },
    signal,
  });
}

export function migrateStatus(agent, { signal } = {}) {
  return call(agent, '/api/mod-migrate', {
    lxm: LXM.migrate,
    body: { action: 'status' },
    signal,
  });
}

/** Carry one batch now instead of waiting for the cron. */
export function migrateRun(agent, { signal } = {}) {
  return call(agent, '/api/mod-migrate', {
    lxm: LXM.migrate,
    body: {},
    signal,
  });
}

/* ------------------------------------------------------ the analyst's config */

export const CONFIG_NSID = 'is.dame.mod.config';
export const CONFIG_RKEY = 'self';

/** The effective config: the record, or the cached copy, or the default. */
export function getAgentConfig(agent, { signal } = {}) {
  return call(agent, '/api/mod-config', { lxm: LXM.config, signal });
}

/**
 * Publish the config as a record in DAME'S OWN REPO.
 *
 * Written here rather than on the server on purpose. The server holds the bot's
 * credential, and the one thing the bot must not be able to do is rewrite the
 * instructions it runs under — so the write is signed by dame's session and the
 * server only ever reads. Same split as list removals.
 *
 * The server is then asked to re-read, so its cached fallback matches what was
 * just published instead of going stale until the next answer.
 */
export async function setAgentConfig(
  agent,
  { style, guidance, openers, report, postReport, model, limits },
  { signal } = {},
) {
  const repo = agent.session?.did ?? agent.did;
  await agent.com.atproto.repo.putRecord({
    repo,
    collection: CONFIG_NSID,
    rkey: CONFIG_RKEY,
    record: {
      $type: CONFIG_NSID,
      style: String(style || '').trim(),
      guidance: String(guidance || '').trim(),
      openers: String(openers || '').trim(),
      report: String(report || '').trim(),
      postReport: String(postReport || '').trim(),
      model: String(model || '').trim(),
      limits: limits || {},
      updatedAt: new Date().toISOString(),
    },
  });
  return call(agent, '/api/mod-config', {
    lxm: LXM.config,
    body: { refresh: true },
    signal,
  });
}

/* --------------------------------------------------- retiring the old list */

/**
 * Every subject on a list, read from the repo that owns it.
 *
 * Both repos live on the same PDS and listRecords needs no auth for a repo you
 * do not own, so one session reads both.
 */
async function membersOf(agent, listUri, onProgress) {
  const did = ownerOf(listUri);
  if (!did) throw new Error(`not an at:// uri: ${listUri}`);
  const subjects = new Set();
  const rkeys = [];
  let cursor;
  for (let page = 0; page < 400; page += 1) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: 'app.bsky.graph.listitem',
      limit: 100,
      cursor,
    });
    for (const rec of res.data.records || []) {
      if (rec.value?.list !== listUri) continue;
      subjects.add(rec.value.subject);
      rkeys.push(rec.uri.split('/').pop());
    }
    onProgress?.({ scanned: rkeys.length });
    cursor = res.data.cursor;
    if (!cursor || !(res.data.records || []).length) break;
  }
  return { subjects, rkeys };
}

/**
 * Is the old list safe to delete?
 *
 * IN THE BROWSER, not on the server. This walks both repos, which for these
 * lists is about 173 sequential requests, and the first version put that inside
 * a Vercel function where it returned FUNCTION_INVOCATION_TIMEOUT. A tab has no
 * such ceiling, and the deleting already happens here anyway.
 *
 * Compares SUBJECTS, not counts. A matching total with a different membership
 * would pass a count and lose people.
 */
export async function retireStatus(
  agent,
  { sourceList, targetList, onProgress } = {},
) {
  const me = agent.session?.did ?? agent.did;
  if (ownerOf(sourceList) !== me) {
    throw new Error(
      'that list is not in your repo, so there is nothing to retire',
    );
  }

  const source = await membersOf(agent, sourceList, (p) =>
    onProgress?.({ phase: 'old list', ...p }),
  );
  const target = await membersOf(agent, targetList, (p) =>
    onProgress?.({ phase: 'new list', ...p }),
  );

  const blocks = await agent.com.atproto.repo.listRecords({
    repo: me,
    collection: 'app.bsky.graph.listblock',
    limit: 100,
  });
  const subs = (blocks.data.records || []).map((r) => ({
    uri: r.uri,
    subject: r.value.subject,
  }));

  return {
    source: {
      uri: sourceList,
      records: source.rkeys.length,
      accounts: source.subjects.size,
      // A list can hold the same account twice. They all have to go, and the
      // gap between the two numbers is how many extra deletes that is.
      duplicates: source.rkeys.length - source.subjects.size,
    },
    target: { uri: targetList, accounts: target.subjects.size },
    missing: [...source.subjects].filter((d) => !target.subjects.has(d)),
    subscribedToTarget: subs.some((b) => b.subject === targetList),
    sourceBlockUri: subs.find((b) => b.subject === sourceList)?.uri ?? null,
    // Deletes are 1 point each against 5,000/hour, and each is also a repo
    // event against the relay's 2,600/hour for the whole PDS.
    points: source.rkeys.length + 1,
  };
}

/**
 * Delete a list from dame's own repo, once something else is holding the blocks.
 *
 * In the browser because the list is in dame's repo and the server holds only
 * the bot's credential. Capped per run and resumable: 8,695 deletes is 8,695
 * repo events against a relay ceiling of 2,600 an hour for the whole PDS, so
 * this is several sittings by design rather than one tab left open for three
 * hours.
 *
 * ORDER MATTERS. The subscription goes first: staying subscribed to a list
 * while emptying it means watching your own block list drain. Everyone stays
 * blocked throughout because the caller has already checked that the target
 * list covers them.
 */
export async function retireList(
  agent,
  { sourceList, sourceBlockUri, max = 2000, onProgress } = {},
) {
  const repo = agent.session?.did ?? agent.did;
  if (ownerOf(sourceList) !== repo) {
    throw new Error('that list is not in your repo');
  }

  let removed = 0;

  if (sourceBlockUri) {
    await agent.com.atproto.repo.deleteRecord({
      repo,
      collection: 'app.bsky.graph.listblock',
      rkey: sourceBlockUri.split('/').pop(),
    });
  }

  // Re-read each run rather than trusting a count from before the last batch.
  const rkeys = [];
  let cursor;
  for (let page = 0; page < 400; page += 1) {
    const res = await agent.com.atproto.repo.listRecords({
      repo,
      collection: 'app.bsky.graph.listitem',
      limit: 100,
      cursor,
    });
    for (const rec of res.data.records || []) {
      if (rec.value?.list === sourceList) rkeys.push(rec.uri.split('/').pop());
    }
    cursor = res.data.cursor;
    if (!cursor || !(res.data.records || []).length) break;
  }

  const slice = rkeys.slice(0, max);
  for (let i = 0; i < slice.length; i += 50) {
    const batch = slice.slice(i, i + 50);
    try {
      await agent.com.atproto.repo.applyWrites({
        repo,
        writes: batch.map((rkey) => ({
          $type: 'com.atproto.repo.applyWrites#delete',
          collection: 'app.bsky.graph.listitem',
          rkey,
        })),
      });
      removed += batch.length;
      onProgress?.({ removed, total: rkeys.length });
    } catch (err) {
      const message = String(err?.message || err);
      if (/rate ?limit/i.test(message)) {
        return {
          removed,
          remaining: rkeys.length - removed,
          rateLimited: true,
        };
      }
      throw err;
    }
  }

  const remaining = rkeys.length - removed;
  // The list record goes last. A list record with orphaned items under it is a
  // tidier failure than items pointing at a list that no longer exists, which
  // is the exact mess the migration left in the bot's repo.
  if (!remaining) {
    await agent.com.atproto.repo.deleteRecord({
      repo,
      collection: 'app.bsky.graph.list',
      rkey: sourceList.split('/').pop(),
    });
  }
  return { removed, remaining, done: !remaining };
}

/* ------------------------------------------------------------------- the hub */

/** Snapshot freshness, list, bot session, spend, recent audits. */
export function hubOverview(agent, { signal } = {}) {
  return call(agent, '/api/mod-hub', {
    lxm: LXM.hub,
    body: { action: 'overview' },
    signal,
  });
}

/** Why is this account on the list? Every decision ever recorded for them. */
export function whyListed(agent, actor, { signal } = {}) {
  return call(agent, '/api/mod-hub', {
    lxm: LXM.hub,
    body: { action: 'why', actor },
    signal,
  });
}

/** Every list the moderator account owns. */
export function hubLists(agent, { signal } = {}) {
  return call(agent, '/api/mod-hub', {
    lxm: LXM.hub,
    body: { action: 'lists' },
    signal,
  });
}

/** One page of the list, as profile cards. */
export function listMembers(agent, { listUri, cursor, signal } = {}) {
  return call(agent, '/api/mod-hub', {
    lxm: LXM.hub,
    body: { action: 'list', listUri, cursor },
    signal,
  });
}

/* ----------------------------------------------------------------- the plans */

/** Recent plans, newest first, with what each one carried. */
export function planList(agent, { signal } = {}) {
  return call(agent, '/api/mod-plan', {
    lxm: LXM.plan,
    body: { action: 'plans' },
    signal,
  });
}

/**
 * One plan, filtered and paged.
 *
 * This is the surface a DM cannot be. Ten quotes as a spot check is the most a
 * chat bubble can honestly offer before a bulk action; reading all 231 with the
 * words beside them is a screen's job.
 */
export function planDetail(
  agent,
  { code, label, band, state, offset, signal } = {},
) {
  return call(agent, '/api/mod-plan', {
    lxm: LXM.plan,
    body: { action: 'detail', code, label, band, state, offset },
    signal,
  });
}

/** Add the accounts that were ticked. Recorded as individual, not as a band. */
export function planAdd(agent, { code, dids, signal } = {}) {
  return call(agent, '/api/mod-plan', {
    lxm: LXM.plan,
    body: { action: 'add', code, dids },
    signal,
  });
}

/** Take a plan's additions back off the list. */
export function planUndo(agent, { code, signal } = {}) {
  return call(agent, '/api/mod-plan', {
    lxm: LXM.plan,
    body: { action: 'undo', code },
    signal,
  });
}

/* ------------------------------------------------------------- the queue */

/**
 * One page of the review queue: everyone on the list who needs a look, with
 * profiles. `reason` filters to one of PROTECTED, CONNECTED, disputed,
 * PERIPHERAL, NOTABLE.
 */
export function queuePage(
  agent,
  { reason = 'all', offset = 0, limit = 20, signal } = {},
) {
  return call(agent, '/api/mod-queue', {
    lxm: LXM.queue,
    body: { action: 'page', reason, offset, limit },
    signal,
  });
}

/** keep | remove | restore (undo a removal) | reopen (undo a keep). */
export function queueDecide(
  agent,
  { did, decision, reason, band, signal } = {},
) {
  return call(agent, '/api/mod-queue', {
    lxm: LXM.queue,
    body: { action: 'decide', did, decision, reason, band },
    signal,
  });
}

/* ------------------------------------------------------- who is on the list */

/** A page of the list, newest first, each with its band and how it got there. */
export function listPage(agent, { cursor, signal } = {}) {
  return call(agent, '/api/mod-hub', {
    lxm: LXM.hub,
    body: { action: 'members', cursor },
    signal,
  });
}

/** Find accounts on the list by handle. */
export function searchList(agent, q, { signal } = {}) {
  return call(agent, '/api/mod-hub', {
    lxm: LXM.hub,
    body: { action: 'search', q },
    signal,
  });
}

/** One account: profile, membership, band, and every decision about them. */
export function accountDetail(agent, actor, { signal } = {}) {
  return call(agent, '/api/mod-hub', {
    lxm: LXM.hub,
    body: { action: 'account', actor },
    signal,
  });
}
