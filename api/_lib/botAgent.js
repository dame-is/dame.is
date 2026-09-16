// The moderator account's session, reused instead of re-established.
//
// `agent.login()` spends com.atproto.server.createSession, which is capped at
// 30 per 5 minutes and 300 per day per account. A ten-minute cron alone is 144
// of those; add the migration job, a few manual runs and a bad afternoon of
// debugging and the account locks itself out of its own automation. Refreshing
// a stored session has no such cap.
//
// So: resume from the stored session, let the SDK refresh it, persist whatever
// it hands back, and fall through to a real login only when the refresh token
// is genuinely dead (expired, revoked, or the password was rotated).
//
// The stored session contains a refresh token, which is a bearer credential for
// the account. It lives in mod.bot_session, service-role only, like everything
// else in that schema — and the same caveat applies as to the app password it
// replaces: whoever holds it is the moderator account.

import { AtpAgent } from '@atproto/api';
import { resolvePds } from '../../src/lib/atproto.js';
import { select, upsert } from './modDb.js';

/**
 * Where to authenticate, when we cannot work it out from the identifier.
 *
 * Only correct for an account Bluesky hosts. The moderator account is not one:
 * it lives on pds.atpota.to, and createSession against bsky.social for an
 * account bsky.social has never heard of answers "Invalid identifier or
 * password" — which reads as a typo in the app password and sends you to
 * rotate a credential that was never wrong.
 */
const FALLBACK_SERVICE = 'https://bsky.social';

/** DMs are served by the chat service, not the PDS or the AppView. */
export const CHAT_SERVICE_DID = 'did:web:api.bsky.chat';

/**
 * The chat-service view of an agent that is already logged in.
 *
 * The droplet consumer needs BOTH views at once from ONE session: the plain
 * agent to post a public reply, and this one to read and send DMs. Logging in
 * twice to get them would spend two createSession calls against a 300/day cap
 * for no reason, and `withProxy` is just a wrapper around the same session.
 */
export function chatView(agent) {
  return agent.withProxy('bsky_chat', CHAT_SERVICE_DID);
}

/**
 * Credentials for the moderator account.
 *
 * `identifier` may be a handle or a DID — the createSession lexicon types it as
 * a plain string described as "Handle or other identifier supported by the
 * server", and Bluesky's accepts all three of handle, DID and email.
 *
 * A DID is the better thing to store. A handle is rented: rename the moderator
 * account and a stored handle stops authenticating, with the failure landing in
 * a cron nobody is watching. A DID is permanent.
 */
function credentials() {
  const identifier = process.env.MOD_IDENTIFIER || process.env.BSKY_IDENTIFIER;
  const password =
    process.env.MOD_APP_PASSWORD || process.env.BSKY_APP_PASSWORD;
  if (!identifier || !password) {
    throw new Error('MOD_IDENTIFIER and MOD_APP_PASSWORD must be configured');
  }
  return { identifier, password };
}

/**
 * Refuse a session that is not the account we were configured for.
 *
 * Only checkable when the identifier is a DID, which is the other reason to
 * prefer one. The failure it catches is mundane and expensive: a DID and an app
 * password from two different accounts. Login succeeds — the password is valid,
 * just for someone else — and every write afterwards lands in the wrong repo.
 * mod-migrate would cheerfully create eight thousand listitems there.
 */
function assertExpectedAccount(identifier, session) {
  if (!identifier.startsWith('did:')) return;
  if (session?.did === identifier) return;
  throw new Error(
    `MOD_IDENTIFIER is ${identifier} but the app password authenticated as ${session?.did} — ` +
      'the identifier and the password belong to different accounts',
  );
}

async function readSession() {
  const rows = await select('bot_session', {
    select: 'session,handle,did',
    eq: { id: 1 },
  });
  return rows?.[0]?.session ?? null;
}

async function writeSession(session) {
  await upsert('bot_session', [
    {
      id: 1,
      did: session?.did ?? null,
      handle: session?.handle ?? null,
      session,
      refreshed_at: new Date().toISOString(),
    },
  ]);
}

/**
 * The PDS that actually holds this account.
 *
 * atproto has no central login: credentials are only valid at the server that
 * hosts the repo, and a DID document says which one that is. Hardcoding
 * bsky.social works right up until the account is self-hosted, and then fails
 * with a message about the password.
 *
 * MOD_SERVICE overrides, for a PDS whose DID document is unreachable or for
 * pointing a test at a local one. A handle cannot be resolved this way without
 * a round trip we do not need — one more reason the identifier should be a DID.
 */
async function serviceFor(identifier) {
  if (process.env.MOD_SERVICE)
    return process.env.MOD_SERVICE.replace(/\/$/, '');
  if (!identifier.startsWith('did:')) return FALLBACK_SERVICE;
  try {
    return await resolvePds(identifier);
  } catch {
    // An unreachable directory should not take the bot offline when the
    // fallback might still be the right answer.
    return FALLBACK_SERVICE;
  }
}

/**
 * An authenticated agent for the moderator account.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.chat] wrap the agent for the chat service
 * @returns {Promise<{ agent: object, via: 'resume'|'login' }>}
 */
export async function botAgent({ chat = false } = {}) {
  const { identifier, password } = credentials();
  const service = await serviceFor(identifier);

  // persistSession fires on refresh AND on login, so every path that produces a
  // usable session writes it back without the callers having to remember.
  // Failures here are swallowed deliberately: a session we could not cache is
  // still a session that works for this run, and throwing would turn a storage
  // hiccup into an outage.
  const agent = new AtpAgent({
    service,
    persistSession: (event, session) => {
      if (!session) return;
      if (event === 'create' || event === 'update') {
        writeSession(session).catch(() => {});
      }
    },
  });

  let via = 'login';
  const stored = await readSession().catch(() => null);
  if (stored?.refreshJwt) {
    try {
      // resumeSession validates and refreshes if the access token has aged out.
      // A dead refresh token throws here, which is the one case that must fall
      // through to a real login rather than fail the run.
      await agent.resumeSession(stored);
      via = 'resume';
    } catch {
      via = 'login';
    }
  }

  if (via === 'login') {
    await agent.login({ identifier, password });
  }

  assertExpectedAccount(identifier, agent.session);

  if (!chat) return { agent, via };
  return { agent: chatView(agent), via };
}

/**
 * Forget the cached session.
 *
 * For when the app password is rotated and the stored refresh token is now for
 * an account state that no longer exists.
 */
export async function clearBotSession() {
  await upsert('bot_session', [
    { id: 1, session: {}, refreshed_at: new Date().toISOString() },
  ]);
}
