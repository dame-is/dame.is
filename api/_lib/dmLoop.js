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
import {
  parseCommand,
  parseChoice,
  facetLinks,
  facetMentions,
  offersFrom,
} from '../../src/lib/moderation/command.js';
import {
  ackFor,
  nudge,
  parseOpeners,
} from '../../src/lib/moderation/phrases.js';
import { select, upsert } from './modDb.js';
import { applyCommand } from './listWrite.js';
import {
  proposePlan,
  findPlan,
  applyPlan,
  applyPlanToActors,
  reviewPlan,
  cancelPlan,
} from './bulkPlan.js';
import { loadAgentConfig, LIMITS } from './agentConfig.js';

/**
 * The post attached to a message, if it was SHARED rather than pasted.
 *
 * Sharing a post to a DM from the Bluesky app does not put a link in the text.
 * The text is whatever was typed alongside it and the post travels in
 * `embed.record.uri`, so scanning the message for a URL finds nothing and the
 * analyst answers "no link in your message" about a message with a post
 * visibly attached to it. Which is true of the text and useless to the reader.
 */
export function sharedPostUri(message) {
  const uri = message?.embed?.record?.uri;
  return typeof uri === 'string' && uri.startsWith('at://') ? uri : null;
}

/**
 * What the model is asked: what dame typed, plus the shared post if there is
 * one. The added line is derived by us from the record rather than copied from
 * anyone's writing, so it is not untrusted input.
 */
export function composeMessage(message) {
  const text = message?.text || '';
  const extra = [];

  const uri = sharedPostUri(message);
  if (uri) extra.push(`The post dame shared: ${uri}`);

  // A client truncates the visible text of a pasted link and keeps the whole
  // URI in the facet, so the analyst was reading "bsky.app/profile/free..."
  // and correctly reporting that it could not resolve it. These come from
  // dame's own message, so they are derived fact, not untrusted input.
  const links = facetLinks(message).filter((l) => !text.includes(l));
  if (links.length)
    extra.push(`Full links in that message: ${links.join(' ')}`);

  const mentions = facetMentions(message);
  if (mentions.length) extra.push(`Accounts mentioned: ${mentions.join(' ')}`);

  if (!extra.length) return text;
  return `${text}\n\n[${extra.join('. ')}]`;
}

/**
 * How long a numbered option stays live.
 *
 * Expired rather than deleted: a stale "1" falls through to the analyst as a
 * question instead of firing a command dame typed a number for an hour ago and
 * has since forgotten.
 */
const CHOICE_TTL_MS = 30 * 60_000;

async function offerChoices(convoId, options) {
  if (!options?.length) return;
  await upsert('dm_choice', [
    { convo_id: convoId, options, created_at: new Date().toISOString() },
  ]).catch(() => {});
}

/** The command behind a numbered reply, if it is still live. */
async function takeChoice(convoId, n) {
  const rows = await select('dm_choice', {
    select: 'options,created_at',
    eq: { convo_id: convoId },
  }).catch(() => []);
  const row = rows?.[0];
  if (!row) return null;
  if (Date.now() - Date.parse(row.created_at) > CHOICE_TTL_MS) return null;
  return row.options?.[n - 1]?.command ?? null;
}

/** Render options as the numbered menu dame picks from. */
function renderChoices(options) {
  return options.map((o, i) => `${i + 1}. ${o.label}`).join('\n');
}

/** A plan's band counts, as something readable in a chat bubble. */
function renderPlan(plan) {
  const lines = [
    `Plan ${plan.code}: ${plan.total} ${plan.kind} of ${plan.uri}`,
    '',
  ];
  for (const [band, n] of Object.entries(plan.byBand)) {
    if (!n) continue;
    lines.push(
      `  ${band.padEnd(11)}${String(n).padStart(5)}` +
        (band === 'PROTECTED' ? '   never carried' : ''),
    );
  }
  if (plan.truncated) {
    lines.push('', 'The harvest hit a page cap, so the tail is incomplete.');
  }
  const named = Object.entries(plan.byBand)
    .filter(([b, n]) => b !== 'UNKNOWN' && b !== 'PROTECTED' && n)
    .reduce((t, [, n]) => t + n, 0);

  const options = [];
  if (plan.byBand.UNKNOWN) {
    options.push({
      label: `Add the ${plan.byBand.UNKNOWN} UNKNOWN accounts`,
      command: `approve ${plan.code} UNKNOWN`,
    });
  }
  if (named) {
    options.push({
      label: `Show me the ${named} that need a look`,
      command: `review ${plan.code}`,
    });
  }
  options.push({ label: 'Do nothing', command: `cancel ${plan.code}` });

  lines.push('', renderChoices(options));
  return { text: lines.join('\n'), options };
}

/** The named accounts in a plan, and what dame can do about them. */
function renderReview(plan, review) {
  const lines = [`Plan ${plan.code}: ${review.total} need a look:`, ''];
  for (const r of review.rows) {
    const reach =
      r.followers != null ? `, ${r.followers.toLocaleString()} followers` : '';
    lines.push(`  @${r.handle}: ${r.band}, ${r.vouches ?? 0} vouches${reach}`);
  }
  if (review.total > review.shown) {
    lines.push('', `(${review.total - review.shown} more)`);
  }
  const bands = [...new Set(review.rows.map((r) => r.band))].filter(
    (b) => b !== 'PROTECTED',
  );
  const options = [];
  if (bands.length) {
    options.push({
      label: `Add all ${review.total} of these`,
      command: `approve ${plan.code} ${bands.join(',')}`,
    });
  }
  options.push({ label: 'Do nothing', command: `cancel ${plan.code}` });
  lines.push(
    '',
    renderChoices(options),
    '',
    `Or name them: approve ${plan.code} @handle @handle`,
  );
  return { text: lines.join('\n'), options };
}

/**
 * Run one typed command and return what to say back.
 *
 * Every branch is deterministic. Nothing here consults the model, and the only
 * inputs are dame's literal text and what Constellation and score.js returned.
 */
export async function runCommand(cmd, writeAgent) {
  const say = (text, options = null) => ({ text, options });

  if (cmd.needsTarget) {
    if (cmd.action === 'plan') {
      return say(nudge('post'));
    }
    if (['approve', 'cancel', 'review'].includes(cmd.action)) {
      return say(nudge('plan'));
    }
    return say(nudge('actor'));
  }
  if (!writeAgent) return say('Commands are not wired up on this path.');

  if (cmd.action === 'plan') {
    const plan = await proposePlan({ link: cmd.target, kind: cmd.kind });
    return renderPlan(plan);
  }

  if (['approve', 'cancel', 'review'].includes(cmd.action)) {
    const plan = await findPlan(cmd.code);
    if (!plan) return say(`No plan with code ${cmd.code}.`);

    if (cmd.action === 'cancel') {
      await cancelPlan(plan);
      return say(`Cancelled ${cmd.code}. Nothing was added.`);
    }

    if (cmd.action === 'review') {
      const review = await reviewPlan(plan, { bands: cmd.bands });
      if (!review.total)
        return say('Nothing in this plan needs a look. It is all UNKNOWN.');
      return renderReview(plan, review);
    }

    // The personal path: named accounts dame read and decided on.
    if (cmd.actors?.length) {
      const out = await applyPlanToActors(writeAgent, plan, cmd.actors);
      return say(out.message);
    }
    if (!cmd.bands.length) {
      return say(
        `Name the bands, like "approve ${cmd.code} UNKNOWN", or name the accounts. PROTECTED is never carried.`,
      );
    }
    const out = await applyPlan(writeAgent, plan, cmd.bands);
    return say(out.message);
  }

  const out = await applyCommand(writeAgent, cmd.action, cmd.actor, {
    raw: cmd.raw,
  });
  return say(out.message);
}

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
 * @param {object} [opts.writeAgent] the UNPROXIED agent, for list commands.
 *   Repo writes must not go through the chat proxy, and without this commands
 *   are simply unavailable rather than silently misrouted.
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
  writeAgent,
  getIo,
  model = process.env.MOD_AGENT_MODEL || DEFAULT_MODEL,
  botDid,
  generate = generateText,
  extraTools = {},
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

  // Only now is any of this worth loading. The config is read per pass rather
  // than cached in process, so publishing a new record is felt on the next
  // message instead of whenever a cache happened to expire — it is one request
  // against a model call that takes five to twenty seconds.
  const [io, config] = await Promise.all([getIo(), loadAgentConfig()]);
  const openers = parseOpeners(config?.openers);
  // The record can move these within a range someone chose; it cannot set
  // maxSteps to 400. See LIMITS in agentConfig.js.
  const limits = config?.limits || {
    maxTurns: LIMITS.maxTurns.def,
    maxSteps: LIMITS.maxSteps.def,
    historyHours: LIMITS.historyHours.def,
    reviewRows: LIMITS.reviewRows.def,
  };
  const activeModel = config?.model || model;

  const turns = [];
  for (const entry of inbound.slice(-MAX_TURNS)) {
    // COMMANDS NEVER REACH THE MODEL. Matched on dame's literal text, executed
    // directly, replied to with a receipt. This is what makes "only acts on
    // commands from me" true in the presence of tools that read strangers'
    // posts: there is no path from the tool loop to a write, so a captured turn
    // has nothing to capture. See src/lib/moderation/command.js.
    const send = async (text) => {
      for (const chunk of chunkForDm(text)) {
        await chat.chat.bsky.convo.sendMessage({
          convoId: entry.convoId,
          message: { text: chunk },
        });
      }
    };

    const embedUri = sharedPostUri(entry.message);
    let cmd = parseCommand(entry.message.text, {
      embedUri,
      links: facetLinks(entry.message),
      mentions: facetMentions(entry.message),
    });

    // A bare "2" resolves against the options the LAST DETERMINISTIC REPLY
    // offered, and only those. The analyst's prose never stores options, so a
    // number can never execute something a model composed while reading a
    // stranger's posts — the menu is as parsed as the commands behind it.
    if (!cmd) {
      const choice = parseChoice(entry.message.text);
      if (choice) {
        const chosen = await takeChoice(entry.convoId, choice);
        if (chosen) cmd = parseCommand(chosen, { embedUri });
      }
    }

    // Say something before the work starts. A harvest or a model call is five to
    // twenty seconds of silence, which reads as broken rather than busy.
    // Swallowed on failure: an ack that did not send is not a reason to lose the
    // answer behind it.
    await send(ackFor(cmd, { openers })).catch(() => {});

    if (cmd) {
      let reply;
      try {
        reply = await runCommand(cmd, writeAgent);
      } catch (err) {
        reply = {
          text: `That failed: ${String(err?.message || err).slice(0, 300)}`,
          options: null,
        };
      }
      await send(reply.text);
      await offerChoices(entry.convoId, reply.options);
      log('Ran a command', {
        action: cmd.action,
        actor: cmd.actor ?? cmd.target ?? cmd.code ?? '(none)',
        options: reply.options?.length ?? 0,
      });
      turns.push({ convoId: entry.convoId, command: cmd.action });
      continue;
    }

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
        maxTurns: limits.maxTurns,
        maxAgeMs: limits.historyHours ? limits.historyHours * 3600_000 : null,
      });
    } catch {
      // A conversation we cannot read is still a question we can answer, just
      // without context. Better a reply that misses the reference than silence.
      history = [];
    }

    const reply = await answer({
      generate,
      message: composeMessage(entry.message),
      io,
      history,
      model: activeModel,
      surface: 'dm',
      extraTools,
      voice: config?.style,
      guidance: config?.guidance,
      maxSteps: limits.maxSteps,
      reviewRows: limits.reviewRows,
    });

    let text = reply.text || 'No answer produced.';
    // The analyst quotes commands in backticks. Lift them into a menu so dame
    // can answer "2" instead of retyping one. Parsed, not copied: see
    // offersFrom for what that does and does not guarantee.
    const offers = offersFrom(text);
    if (offers.length) text += `\n\n${renderChoices(offers)}`;
    const chunks = chunkForDm(text);
    await send(text);
    await offerChoices(entry.convoId, offers);

    // The reply is already sent and the cursor already advanced, so a failure
    // to record the spend must not throw away the rest of the pass.
    await upsert('llm_usage', [
      {
        kind: 'dm',
        model: activeModel,
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
