// Browser side of the moderation endpoints.
//
// The admin panel holds an atproto OAuth session, so it can ask the PDS for a
// token signed by dame's own key and present that instead of a password. Every
// call mints a fresh one: they live about a minute, they are scoped to a single
// method, and there is nothing worth caching or worth stealing.
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
  retire: 'is.dame.mod.retire',
};

/**
 * Mint a service-auth token for one call.
 *
 * `aud` is dame's own DID: this site has no service DID, so the claim being
 * made is simply "the holder of dame's signing key asked for this". The PDS
 * keeps the lifetime short on its own; the endpoint refuses anything longer
 * than ten minutes regardless.
 */
async function mint(agent, lxm) {
  const res = await agent.com.atproto.server.getServiceAuth({
    aud: ME_DID,
    lxm,
  });
  const token = res?.data?.token;
  if (!token) throw new Error('the PDS did not return a service auth token');
  return token;
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
  { style, guidance, openers, model, limits },
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

/** Is the old list safe to delete? Reads both repos server-side. */
export function retireStatus(agent, { sourceList, targetList, signal } = {}) {
  return call(agent, '/api/mod-retire', {
    lxm: LXM.retire,
    body: { sourceList, targetList },
    signal,
  });
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
