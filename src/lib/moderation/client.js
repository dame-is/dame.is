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
