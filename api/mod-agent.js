// Vercel serverless function: the moderator account's DM loop.
//
// Poll chat.bsky.convo.getLog from a stored cursor, answer anything dame sent,
// reply in the same conversation. That is the whole interface — send the bot a
// post link and it comes back with who is in the graph around it and what a
// bulk action would hit.
//
// TWO RULES hold this together, and both are about blast radius rather than
// tidiness:
//
//  1. Only dame is answered. Every other sender is skipped silently. The bot
//     account is reachable by anyone who can DM it, and the thing on the other
//     end reads its input as instructions, so the sender check is the security
//     boundary — not the prompt.
//  2. The analyst has no write tools. It looks and explains. Acting still goes
//     through the gate with dame's approval, so a fully prompt-injected turn
//     costs a wrong paragraph.
//
// The cursor advances even for skipped events, so a message the bot refuses to
// answer cannot wedge the loop into replaying it forever.

import { generateText } from 'ai';

import { ME_DID } from '../src/config.js';
import { resolveTarget, resolveActor } from '../src/lib/moderation/target.js';
import { harvestPost } from '../src/lib/moderation/harvest.js';
import { createScorer, summarise } from '../src/lib/moderation/score.js';
import { referenceFrom } from '../src/lib/moderation/precompute.js';
import {
  answer,
  chunkForDm,
  DEFAULT_MODEL,
} from '../src/lib/moderation/agent.js';
import { select, upsert } from './_lib/modDb.js';
import { botAgent } from './_lib/botAgent.js';
import { authorize } from './_lib/serviceAuth.js';

export const config = { maxDuration: 60 };

const LXM = 'is.dame.mod.agent';
/** How many messages one firing will answer. */
const MAX_TURNS = 5;

/** Load the newest finalised snapshot into scorer-shaped lookups. */
async function loadReference() {
  const latest = await select('vouch', {
    select: 'taken_at',
    order: 'taken_at.desc',
    limit: 1,
  });
  const takenAt = latest?.[0]?.taken_at;
  if (!takenAt) throw new Error('no finalised snapshot yet');

  const [vouchRows, circleRows, protectedRows] = await Promise.all([
    select('vouch', { select: 'did,vouches', eq: { taken_at: takenAt } }),
    select('circle', { select: 'did', eq: { taken_at: takenAt } }),
    select('protected', { select: 'did,reason' }),
  ]);
  return {
    takenAt,
    ref: referenceFrom({
      vouchRows,
      circleDids: circleRows.map((r) => r.did),
      protectedRows,
    }),
  };
}

/**
 * The read-only backends the analyst's tools call.
 *
 * Built once per firing and shared across turns so a conversation does not
 * re-read the whole vouch table for every message.
 */
function makeIo({ ref, takenAt }) {
  const scorer = createScorer(ref);
  return {
    async preflight(link) {
      const target = await resolveTarget(link);
      const harvest = await harvestPost(target.uri);
      const scores = await scorer.score(harvest.participants.map((p) => p.did));
      const summary = summarise(harvest, scores, { excludeSelf: ME_DID });
      return {
        target,
        totals: summary.totals,
        truncated: summary.truncated,
        requiresReview: summary.requiresReview,
        autoEligible: summary.autoEligible.length,
      };
    },
    async lookUp(actor) {
      // Resolve first: score() keys its result by the exact string it is
      // handed, so a handle would come back as an unresolved account rather
      // than as the person it names.
      const did = await resolveActor(actor);
      const scored = await scorer.score([did]);
      return [...scored.values()][0] ?? null;
    },
    referenceStatus: () => ({
      snapshot: takenAt,
      scoredAccounts: ref.vouches.size,
      circleSize: ref.circle.size,
      protectedAccounts: ref.protectedSet.size,
    }),
  };
}

async function readCursor() {
  const rows = await select('dm_cursor', { select: 'cursor', eq: { id: 1 } });
  return rows?.[0]?.cursor ?? null;
}

async function writeCursor(cursor) {
  await upsert('dm_cursor', [
    { id: 1, cursor, updated_at: new Date().toISOString() },
  ]);
}

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;

  try {
    const { agent, via } = await botAgent({ chat: true });
    const cursor = await readCursor();
    const log = await agent.chat.bsky.convo.getLog(cursor ? { cursor } : {});

    const inbound = (log.data.logs || []).filter(
      (entry) =>
        entry.$type === 'chat.bsky.convo.defs#logCreateMessage' &&
        entry.message?.sender?.did === ME_DID &&
        typeof entry.message?.text === 'string',
    );

    // Advance regardless of what we do with the contents: a message the bot
    // will not answer must not be replayed on every firing forever.
    if (log.data.cursor) await writeCursor(log.data.cursor);

    if (!inbound.length) {
      return res
        .status(200)
        .json({ answered: 0, scanned: log.data.logs?.length ?? 0, via });
    }

    const { ref, takenAt } = await loadReference();
    const io = makeIo({ ref, takenAt });
    const model = process.env.MOD_AGENT_MODEL || DEFAULT_MODEL;

    const answered = [];
    for (const entry of inbound.slice(-MAX_TURNS)) {
      const reply = await answer({
        generate: generateText,
        message: entry.message.text,
        io,
        model,
      });

      const text = reply.text || 'No answer produced.';
      const chunks = chunkForDm(text);
      for (const chunk of chunks) {
        await agent.chat.bsky.convo.sendMessage({
          convoId: entry.convoId,
          message: { text: chunk },
        });
      }

      await upsert('llm_usage', [
        {
          kind: 'dm',
          model,
          input_tokens: reply.usage?.inputTokens ?? null,
          output_tokens: reply.usage?.outputTokens ?? null,
        },
      ]);
      answered.push({
        convoId: entry.convoId,
        chunks: chunks.length,
        steps: reply.steps,
      });
    }

    return res
      .status(200)
      .json({ answered: answered.length, turns: answered, via });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
