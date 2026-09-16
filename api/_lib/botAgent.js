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
import { select, upsert } from './modDb.js';

const SERVICE = 'https://bsky.social';

/** DMs are served by the chat service, not the PDS or the AppView. */
const CHAT_SERVICE_DID = 'did:web:api.bsky.chat';

function credentials() {
  const identifier = process.env.MOD_IDENTIFIER || process.env.BSKY_IDENTIFIER;
  const password =
    process.env.MOD_APP_PASSWORD || process.env.BSKY_APP_PASSWORD;
  if (!identifier || !password) {
    throw new Error('MOD_IDENTIFIER and MOD_APP_PASSWORD must be configured');
  }
  return { identifier, password };
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
 * An authenticated agent for the moderator account.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.chat] wrap the agent for the chat service
 * @returns {Promise<{ agent: object, via: 'resume'|'login' }>}
 */
export async function botAgent({ chat = false } = {}) {
  const { identifier, password } = credentials();

  // persistSession fires on refresh AND on login, so every path that produces a
  // usable session writes it back without the callers having to remember.
  // Failures here are swallowed deliberately: a session we could not cache is
  // still a session that works for this run, and throwing would turn a storage
  // hiccup into an outage.
  const agent = new AtpAgent({
    service: SERVICE,
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

  if (!chat) return { agent, via };
  return { agent: agent.withProxy('bsky_chat', CHAT_SERVICE_DID), via };
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
