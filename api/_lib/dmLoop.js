// One pass of the moderator account's DM intake, shared by the droplet consumer
// and by api/mod-agent.js.
//
// Extracted rather than reimplemented. The droplet answers DMs in about two
// seconds and the serverless endpoint is now only the escape hatch for when the
// droplet is down, but "the fast path and the fallback answer differently" is a
// bug that would surface exactly when someone is already having a bad day.
//
// TWO RULES hold this together, and both are about blast radius:
//
//  1. Only dame is answered. Every other sender is skipped silently. The bot
//     account is reachable by anyone who can DM it, and the thing on the other
//     end reads its input as instructions, so the sender check is the security
//     boundary — not the prompt.
//  2. The analyst has no write tools. It looks and explains. Acting still goes
//     through the gate with dame's approval, so a fully prompt-injected turn
//     costs a wrong paragraph.
//
// AT MOST ONCE, on purpose. The cursor advances before any reply is sent, so a
// message that crashes the turn is dropped rather than replayed. The other
// choice — advance after — turns one poisoned message into an infinite loop of
// DMs to dame, which is worse than one missed answer she can see went missing.

import { generateText } from 'ai';

import { ME_DID } from '../../src/config.js';
import {
  answer,
  chunkForDm,
  historyFrom,
  DEFAULT_MODEL,
} from '../../src/lib/moderation/agent.js';
import { select, upsert } from './modDb.js';

/** How many messages one pass will answer. */
export const MAX_TURNS = 5;

/** Pages of getLog a cold start will walk to reach the live tail. */
const COLD_START_MAX_PAGES = 50;

export async function readCursor() {
  const rows = await select('dm_cursor', { select: 'cursor', eq: { id: 1 } });
  return rows?.[0]?.cursor ?? null;
}

/**
 * Store the resume point, but only when it has actually moved.
 *
 * The droplet polls every 2s, so writing unconditionally is 43,200 updates a
 * day to a single row for the sake of the handful that change anything. The
 * write still happens BEFORE any reply is sent, which is the property that
 * matters: it is what makes a crashed turn a dropped message rather than a
 * replayed one.
 */
let lastWritten = null;

export async function writeCursor(cursor) {
  if (cursor === lastWritten) return;
  await upsert('dm_cursor', [
    { id: 1, cursor, updated_at: new Date().toISOString() },
  ]);
  lastWritten = cursor;
}

/**
 * Walk getLog to its end and remember where that was, answering nothing.
 *
 * `mod.dm_cursor` starts empty, and getLog with no cursor replays the whole
 * conversation history from the beginning. Without this, the first run answers
 * whatever dame happened to send weeks ago as though it had just arrived. The
 * house Jetstream consumers start from the live tail for the same reason.
 */
export async function seekToTail(chat, { log = () => {} } = {}) {
  let cursor = null;
  for (let page = 0; page < COLD_START_MAX_PAGES; page += 1) {
    const res = await chat.chat.bsky.convo.getLog(cursor ? { cursor } : {});
    const entries = res.data.logs || [];
    if (res.data.cursor) cursor = res.data.cursor;
    if (!entries.length) break;
  }
  if (cursor) await writeCursor(cursor);
  log('DM cursor initialised at the live tail', { cursor });
  return cursor;
}

/**
 * Answer everything dame has sent since the stored cursor.
 *
 * @param {object} opts
 * @param {object} opts.chat      an agent proxied to the chat service
 * @param {Function} opts.getIo   async () => tool backends, from makeIo().
 *   A FACTORY, not an object: building it loads a ~73k row snapshot, and a poll
 *   that finds nothing — which is almost every poll — must not pay for that. On
 *   the droplet the same laziness is what lets the snapshot be released while
 *   idle; on Vercel it keeps an empty firing off the 60s budget entirely.
 * @param {string} [opts.model]
 * @param {string} opts.botDid    the moderator account's DID
 * @param {Function} [opts.generate]  injected for tests
 * @returns {Promise<{ answered: number, scanned: number, turns: Array }>}
 */
export async function runDmPass({
  chat,
  getIo,
  model = process.env.MOD_AGENT_MODEL || DEFAULT_MODEL,
  botDid,
  generate = generateText,
  log = () => {},
}) {
  const cursor = await readCursor();
  if (!cursor) {
    await seekToTail(chat, { log });
    return { answered: 0, scanned: 0, turns: [], coldStart: true };
  }

  const res = await chat.chat.bsky.convo.getLog({ cursor });
  const entries = res.data.logs || [];

  const inbound = entries.filter(
    (entry) =>
      entry.$type === 'chat.bsky.convo.defs#logCreateMessage' &&
      entry.message?.sender?.did === ME_DID &&
      typeof entry.message?.text === 'string',
  );

  // Advance regardless of what we do with the contents: a message the bot will
  // not answer must not be replayed on every pass forever.
  if (res.data.cursor) await writeCursor(res.data.cursor);

  if (!inbound.length)
    return { answered: 0, scanned: entries.length, turns: [] };

  // Only now is the snapshot worth loading.
  const io = await getIo();

  const turns = [];
  for (const entry of inbound.slice(-MAX_TURNS)) {
    // Read the conversation back so a follow-up means something. Bluesky stores
    // it already, so this needs no state of our own — and it is per convo, so
    // two threads do not bleed into each other.
    let history = [];
    try {
      const page = await chat.chat.bsky.convo.getMessages({
        convoId: entry.convoId,
        limit: 40,
      });
      history = historyFrom(page.data.messages, {
        selfDid: ME_DID,
        botDid,
        beforeId: entry.message.id,
      });
    } catch {
      // A conversation we cannot read is still a question we can answer, just
      // without context. Better a reply that misses the reference than silence.
      history = [];
    }

    const reply = await answer({
      generate,
      message: entry.message.text,
      io,
      history,
      model,
      surface: 'dm',
    });

    const text = reply.text || 'No answer produced.';
    const chunks = chunkForDm(text);
    for (const chunk of chunks) {
      await chat.chat.bsky.convo.sendMessage({
        convoId: entry.convoId,
        message: { text: chunk },
      });
    }

    // The reply is already sent and the cursor already advanced, so a failure
    // to record the spend must not throw away the rest of the pass.
    await upsert('llm_usage', [
      {
        kind: 'dm',
        model,
        input_tokens: reply.usage?.inputTokens ?? null,
        output_tokens: reply.usage?.outputTokens ?? null,
      },
    ]).catch(() => {});

    log('Answered a DM', {
      convoId: entry.convoId,
      chunks: chunks.length,
      steps: reply.steps,
    });
    turns.push({
      convoId: entry.convoId,
      chunks: chunks.length,
      steps: reply.steps,
    });
  }

  return { answered: turns.length, scanned: entries.length, turns };
}
