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
  migrate: 'is.dame.mod.migrate',
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

/**
 * Actually remove accounts from a list.
 *
 * Runs in the BROWSER, signed by dame's own OAuth session against dame's own
 * repo. The server never removes anyone: the credential that changes who is
 * blocked is the same one that owns the list, which keeps the authority and the
 * write in one place and means no service-role key can alter the graph.
 *
 * Deletes are batched through applyWrites — one HTTP call per 50, and a delete
 * is 1 point against the write budget where a create is 3.
 */
export async function removeFromList(
  agent,
  listUri,
  dids,
  { onProgress } = {},
) {
  const wanted = new Set(dids);
  if (!wanted.size) return { removed: 0 };

  // Map subject -> rkey by reading the listitems back. The audit stores DIDs,
  // not record keys, because a listitem can be recreated and the rkey would go
  // stale in the table while the membership did not.
  const rkeys = [];
  let cursor;
  for (let page = 0; page < 200; page += 1) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: agent.session?.did ?? agent.did,
      collection: 'app.bsky.graph.listitem',
      limit: 100,
      cursor,
    });
    for (const rec of res.data.records || []) {
      if (rec.value?.list !== listUri) continue;
      if (!wanted.has(rec.value?.subject)) continue;
      rkeys.push(rec.uri.split('/').pop());
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }

  let removed = 0;
  for (let i = 0; i < rkeys.length; i += 50) {
    const slice = rkeys.slice(i, i + 50);
    await agent.com.atproto.repo.applyWrites({
      repo: agent.session?.did ?? agent.did,
      writes: slice.map((rkey) => ({
        $type: 'com.atproto.repo.applyWrites#delete',
        collection: 'app.bsky.graph.listitem',
        rkey,
      })),
    });
    removed += slice.length;
    onProgress?.({ removed, total: rkeys.length });
  }
  return { removed, found: rkeys.length, asked: wanted.size };
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
