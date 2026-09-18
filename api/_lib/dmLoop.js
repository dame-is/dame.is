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
import { rosterFromEnv } from '../../src/lib/moderation/senders.js';
import {
  resolveActor,
  extractTargets,
} from '../../src/lib/moderation/target.js';
import {
  answer,
  chunkForDm,
  historyFrom,
  readRequest,
  DEFAULT_MODEL,
} from '../../src/lib/moderation/agent.js';
import {
  parseCommand,
  parseChoice,
  isWrite,
  readOnlyReply,
  facetLinks,
  facetMentions,
  offersFrom,
  parseLookup,
  parsePostScan,
} from '../../src/lib/moderation/command.js';
import {
  renderReport,
  actionsFor,
  renderPlanReport,
  planActions,
} from '../../src/lib/moderation/report.js';
import {
  ackFor,
  nudge,
  parseOpeners,
  worthAcking,
} from '../../src/lib/moderation/phrases.js';
import { select, upsert } from './modDb.js';
import { applyCommand } from './listWrite.js';
import { runTriage, reviewTriage } from './triage.js';
import {
  proposePlan,
  findPlan,
  applyPlan,
  applyPlanToActors,
  applyPlanToTriage,
  reviewPlan,
  cancelPlan,
  undoPlan,
  lastActedPlan,
  historyFor,
  shortCode,
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

async function offerChoices(convoId, options, lastPost) {
  if (!options?.length && !lastPost) return;
  const row = { convo_id: convoId, created_at: new Date().toISOString() };
  if (options?.length) row.options = options;
  if (lastPost) {
    row.last_post = lastPost;
    row.last_post_at = new Date().toISOString();
  }
  await upsert('dm_choice', [row]).catch(() => {});
}

/**
 * The post dame last put in front of the bot here.
 *
 * "add likers" with no link should not mean "send me that post again". She
 * already sent it, and asking twice is the interface forgetting what it was
 * just told. Only ever written from her own message, so the target of a bulk
 * action still comes from her rather than from anything the analyst read.
 */
async function lastPost(convoId) {
  const rows = await select('dm_choice', {
    select: 'last_post,last_post_at',
    eq: { convo_id: convoId },
  }).catch(() => []);
  const row = rows?.[0];
  if (!row?.last_post) return null;
  if (Date.now() - Date.parse(row.last_post_at) > CHOICE_TTL_MS) return null;
  return row.last_post;
}

/**
 * Record the post dame just put in front of the bot.
 *
 * REMEMBERED ON SIGHT, not only when a scan happens to run. The only writer
 * used to be the post-scan path, so attaching a post and asking about it IN
 * WORDS -- "there are a lot of quote posts on this that are toxic" -- sent the
 * turn to the analyst and recorded nothing. "add quoters" one message later was
 * then answered with "send me the post", about a post two messages up the
 * screen. The interface forgetting what it was just told is the whole thing
 * last_post exists to prevent, and it was only doing it on the path that needed
 * it least.
 *
 * Still only ever written from dame's own message, so the target of a bulk
 * action comes from her rather than from anything the analyst read.
 */
async function rememberPost(convoId, uri) {
  if (!uri) return;
  await upsert('dm_choice', [
    {
      convo_id: convoId,
      created_at: new Date().toISOString(),
      last_post: uri,
      last_post_at: new Date().toISOString(),
    },
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
export async function runCommand(
  cmd,
  writeAgent,
  {
    template,
    reportTemplate,
    lookUp,
    canWrite = true,
    generate,
    model,
    log = () => {},
  } = {},
) {
  const say = (text, options = null) => ({ text, options });

  // The gate, before any branch that could reach a repo. Checked here rather
  // than only where the options are built, because a command can arrive as
  // typed text and never pass through a menu at all.
  if (!canWrite && isWrite(cmd)) {
    return say(readOnlyReply(cmd));
  }

  // A verb arrived with nobody and nothing to act on. Every branch here asks
  // rather than guesses, which is the rule the whole command surface turns on.
  //
  // `history` and `undo` never land here any more -- one takes an optional
  // account, the other defaults to the last plan -- except when undo was handed
  // a token that was MEANT as a code and is not one. That case gets an answer
  // naming the token, not a fallback that acts on a batch dame did not name.
  if (cmd.needsTarget) {
    if (cmd.action === 'plan') {
      return say(nudge('post'));
    }
    if (cmd.action === 'undo') {
      const token = cmd.raw.replace(/^undo\s*/i, '').trim();
      return say(
        `I do not recognise "${token}" as a plan code. Send "undo last" for the most recent one, or "history" to see the codes.`,
        [
          { label: 'Undo the last thing I did', command: 'undo last' },
          { label: 'Show me the record', command: 'history' },
        ],
      );
    }
    if (['approve', 'cancel', 'review'].includes(cmd.action)) {
      return say(nudge('plan'));
    }
    return say(nudge('actor'));
  }
  if (!writeAgent) return say('Commands are not wired up on this path.');

  if (cmd.action === 'plan') {
    const plan = await proposePlan({ link: cmd.target, kind: cmd.kind });
    const actions = planActions(plan);
    const head = cmd.remembered ? 'Using the post you sent earlier.\n\n' : '';
    return {
      text: `${head}${renderPlanReport(plan, { template })}\n\nACTIONS:\n${renderChoices(actions)}`,
      options: actions,
      lastPost: plan.uri,
    };
  }

  if (cmd.action === 'history') {
    const did = cmd.actor
      ? await resolveActor(cmd.actor).catch(() => null)
      : null;
    if (cmd.actor && !did) return say(`I could not resolve ${cmd.actor}.`);
    const h = await historyFor(did);
    if (!h.rows.length) {
      return say(
        cmd.actor ? 'Nothing recorded for them.' : 'Nothing done yet.',
      );
    }
    const lines = h.rows.map((r) => {
      const when = new Date(r.acted_at).toLocaleString();
      const note = r.plan?.note ? `, "${r.plan.note}"` : '';
      const undone = r.undone_at ? ' (undone)' : '';
      return `${when} · ${r.band} · ${r.approved_via ?? '?'} · ${r.code}${undone}${note}`;
    });
    return say(
      `${h.total} actions on record, most recent first:\n\n${lines.join('\n')}`,
    );
  }

  if (cmd.action === 'undo') {
    const plan = cmd.last ? await lastActedPlan() : await findPlan(cmd.code);
    if (!plan) {
      return say(
        cmd.last ? 'Nothing to undo.' : `No plan with code ${cmd.code}.`,
      );
    }
    const out = await undoPlan(writeAgent, plan, {
      reason: cmd.raw,
    });
    return say(out.message, [
      { label: 'Show me what changed', command: `history` },
    ]);
  }

  if (['approve', 'cancel', 'review', 'triage'].includes(cmd.action)) {
    const plan = await findPlan(cmd.code);
    if (!plan) return say(`No plan with code ${cmd.code}.`);

    // Read what they wrote and bucket it. Labels only -- nobody is added here,
    // and approving a bucket is a separate command on purpose.
    if (cmd.action === 'triage') {
      const out = await runTriage(plan, { generate, model, log });
      const { counts } = out;
      const lines = [
        `Read ${out.total - out.noText - out.remaining} of the ${out.total} accounts on ${cmd.code}.`,
        '',
        `Hostile: ${counts.hostile}  (aimed at a person)`,
        `Arguing: ${counts.arguing}  (aimed at the argument)`,
        `Neutral: ${counts.neutral}`,
        `No words: ${out.noText}  (likes and reposts carry nothing to read)`,
        ...(out.gone ? [`Deleted: ${out.gone}  (the post is gone)`] : []),
      ];
      if (out.remaining) {
        lines.push(
          '',
          `${out.remaining} left. Send "triage ${cmd.code}" again.`,
        );
      }
      lines.push(
        '',
        'This is a model reading posts, not a band. Their own words are kept next to each label, so read before you approve.',
      );
      const choices = [];
      if (counts.hostile) {
        choices.push({
          label: `Show me the ${counts.hostile} hostile ones and what they said`,
          command: `review ${cmd.code} hostile`,
        });
        choices.push({
          label: `Add the ${counts.hostile} hostile ones`,
          command: `approve ${cmd.code} hostile`,
        });
      }
      choices.push({ label: 'Do nothing', command: `cancel ${cmd.code}` });
      return say(
        `${lines.join('\n')}\n\nACTIONS:\n${renderChoices(choices)}`,
        choices,
      );
    }

    if (cmd.action === 'cancel') {
      await cancelPlan(plan);
      return say(`Cancelled ${cmd.code}. Nothing was added.`);
    }

    // A label review prints the WORDS, which is the whole point: a label
    // nobody can check is just a model's opinion with a number attached.
    if (cmd.action === 'review' && cmd.labels?.length) {
      const label = cmd.labels[0];
      const out = await reviewTriage(plan, label);
      if (!out.total)
        return say(`Nothing in ${cmd.code} was read as ${label}.`);
      const lines = out.rows.map(
        (r) =>
          `${r.band} - "${String(r.triage_quote).replace(/\s+/g, ' ').slice(0, 160)}"`,
      );
      const choices = [
        {
          label: `Add all ${out.total} of these`,
          command: `approve ${cmd.code} ${label}`,
        },
        { label: 'Do nothing', command: `cancel ${cmd.code}` },
      ];
      return say(
        `${out.total} read as ${label}. First ${out.rows.length}:\n\n${lines.join('\n\n')}\n\nACTIONS:\n${renderChoices(choices)}`,
        choices,
      );
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
    if (cmd.labels?.length) {
      const out = await applyPlanToTriage(writeAgent, plan, cmd.labels[0]);
      return say(
        out.message,
        out.added
          ? [
              { label: `Undo those ${out.added}`, command: `undo ${cmd.code}` },
              { label: 'Show me the record', command: 'history' },
            ]
          : null,
      );
    }

    if (!cmd.bands.length) {
      return say(
        `Name the bands, like "approve ${cmd.code} UNKNOWN", or name the accounts. PROTECTED is never carried.`,
      );
    }
    const out = await applyPlan(writeAgent, plan, cmd.bands);
    // Offer the way back with the receipt, while the code is still in front of
    // her. An undo you have to go and look up is one you will not use.
    return say(
      out.message,
      out.added
        ? [
            {
              label: `Undo those ${out.added}`,
              command: `undo ${shortCode(plan.id)}`,
            },
            { label: 'Show me the record', command: 'history' },
          ]
        : null,
    );
  }

  // Wording this could not read as "whoever wrote the attached post". Name the
  // author, show what the gate knows about them, and let dame say. Not a
  // refusal and not a guess: the account is right there in the message, so the
  // useful move is to put it in front of her rather than to argue about
  // phrasing.
  if (cmd.fromPost && cmd.confirm) {
    const found = lookUp ? await lookUp(cmd.actor).catch(() => null) : null;
    if (!found) {
      return say('I could not resolve the author of that post.');
    }
    const handle = `@${found.handle || found.did}`;
    const choices = [
      ...(cmd.action === 'list_add' && !found.protectedReason
        ? [
            {
              label: `Add ${handle} to the list`,
              command: `list add ${handle}`,
            },
          ]
        : []),
      ...(cmd.action === 'list_remove'
        ? [
            {
              label: `Remove ${handle} from the list`,
              command: `list remove ${handle}`,
            },
          ]
        : []),
      {
        label: `Read ${handle}'s recent posts first`,
        command: `read ${handle}`,
      },
    ];
    const body = renderReport(found, { template: reportTemplate });
    return say(
      `That post is by ${handle}, but "${cmd.raw}" might mean someone else, so I have not acted.\n\n${body}\n\nACTIONS:\n${renderChoices(choices)}`,
      choices,
    );
  }

  // An actor that came out of an attached post is a DID, and "Added
  // did:plc:2lp64i... to the list" is a receipt nobody can check. Resolve it to
  // a handle and SAY where it came from: acting on an inference without showing
  // it is how you find out later that the post on screen was a quote of
  // somebody else's.
  let actor = cmd.actor;
  let preface = '';
  if (cmd.fromPost) {
    const account = lookUp ? await lookUp(actor).catch(() => null) : null;
    if (account?.handle) actor = account.handle;
    preface = `That post is by @${String(actor).replace(/^@/, '')}.\n\n`;
  }

  const out = await applyCommand(writeAgent, cmd.action, actor, {
    raw: cmd.raw,
    lookUp,
  });

  // The way back, and the way to look closer, offered with the receipt while it
  // is still in front of her. A single block is a plan of one, so "undo last"
  // undoes exactly this and nothing else.
  const at = `@${String(actor).replace(/^@/, '')}`;
  const after =
    out.ok && cmd.action === 'list_add'
      ? [
          { label: 'Undo that', command: 'undo last' },
          { label: `Read ${at}'s recent posts`, command: `read ${at}` },
        ]
      : null;
  return say(preface + out.message, after);
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
  roster = rosterFromEnv(process.env, ME_DID),
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
      roster.answers(entry.message?.sender?.did) &&
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

    // What this sender may do, decided once per message. The roster is the
    // only thing consulted; nothing downstream re-derives it from the text.
    const canWrite = roster.writes(entry.message?.sender?.did);

    // A button that exists to be rejected is worse than no button. Same rule
    // actionsFor already follows for PROTECTED, and the filter re-parses each
    // command rather than matching on the label, so the menu and the gate in
    // runCommand cannot disagree about what counts as a write.
    const offerable = (options) =>
      canWrite
        ? options
        : (options || []).filter((o) => !isWrite(parseCommand(o.command)));

    const embedUri = sharedPostUri(entry.message);
    const msgLinks = facetLinks(entry.message);

    // Before any routing decision, because every route should leave the post
    // remembered and only one of them used to.
    await rememberPost(
      entry.convoId,
      embedUri ||
        msgLinks.find((l) => extractTargets(l).length) ||
        extractTargets(entry.message.text || '')[0] ||
        null,
    );
    let cmd = parseCommand(entry.message.text, {
      embedUri,
      links: msgLinks,
      mentions: facetMentions(entry.message),
    });

    // "add likers" with no post attached means the one she just sent.
    if (cmd?.action === 'plan' && cmd.needsTarget) {
      const remembered = await lastPost(entry.convoId);
      if (remembered) {
        cmd = {
          ...cmd,
          target: remembered,
          needsTarget: false,
          remembered: true,
        };
      }
    }

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

    // A shared post is a form too. Scanning it stores a plan, so the code is
    // already in hand when she picks an option: no re-sending the post to act
    // on it.
    if (!cmd) {
      const post = parsePostScan(entry.message.text, {
        embedUri,
        links: msgLinks,
      });
      if (post) {
        await send(ackFor({ action: 'plan' }, { openers })).catch(() => {});
        try {
          const plan = await proposePlan({ link: post, kind: 'everyone' });
          const actions = offerable(planActions(plan));
          const body = renderPlanReport(plan, { template: config?.postReport });
          await send(
            actions.length
              ? `${body}\n\nACTIONS:\n${renderChoices(actions)}`
              : body,
          );
          await offerChoices(entry.convoId, actions, plan.uri);
          log('Scanned a post', { uri: plan.uri, code: plan.code });
          turns.push({ convoId: entry.convoId, scan: plan.code });
          continue;
        } catch (err) {
          await send(
            `That scan failed: ${String(err?.message || err).slice(0, 200)}`,
          );
          turns.push({ convoId: entry.convoId, scan: 'failed' });
          continue;
        }
      }
    }

    // A lookup is a form, not a question. Rendered from what score.js already
    // computed, with no model call: instant, free, and the same shape every
    // time, which is what a report is for.
    if (!cmd) {
      const actor = parseLookup(entry.message.text, {
        links: facetLinks(entry.message),
        mentions: facetMentions(entry.message),
      });
      if (actor) {
        try {
          const io = await getIo();
          const account = await io.lookUp(actor);
          if (account) {
            const actions = offerable(actionsFor(account));
            const body = renderReport(account, { template: config?.report });
            await send(
              actions.length
                ? `${body}\n\nACTIONS:\n${renderChoices(actions)}`
                : body,
            );
            await offerChoices(entry.convoId, actions);
            log('Rendered a lookup', { actor, band: account.band });
            turns.push({ convoId: entry.convoId, lookup: actor });
            continue;
          }
          await send(`I could not resolve ${actor}.`);
          turns.push({ convoId: entry.convoId, lookup: actor });
          continue;
        } catch (err) {
          await send(
            `That lookup failed: ${String(err?.message || err).slice(0, 200)}`,
          );
          turns.push({ convoId: entry.convoId, lookup: actor });
          continue;
        }
      }
    }

    // `read @handle` is a CANNED QUESTION FOR THE ANALYST rather than a branch
    // of its own. Everything it needs already exists on that path -- the model,
    // the atmosphere tools, the untrusted fencing, the chunking, the usage row
    // -- and a second copy of all of it would be a second place for the
    // fencing to be forgotten. See readRequest in agent.js for why the wording
    // is fixed rather than taken from what dame typed.
    let reading = cmd?.action === 'read' && !cmd.needsTarget ? cmd.actor : null;
    // Resolved from an attached post, so it is a DID. The read prompt names the
    // account back to dame, and a DID in that sentence is unreadable.
    if (reading && cmd.fromPost) {
      const account = await (await getIo()).lookUp(reading).catch(() => null);
      if (account?.handle) reading = account.handle;
    }

    // Say something before the work starts. A harvest or a model call is five to
    // twenty seconds of silence, which reads as broken rather than busy.
    // Swallowed on failure: an ack that did not send is not a reason to lose the
    // answer behind it.
    // Only announce work that takes time. A rendered reply arrives instantly,
    // and announcing it means two messages for one answer.
    if (worthAcking(cmd)) {
      await send(ackFor(cmd, { openers })).catch(() => {});
    }

    if (cmd?.action === 'read' && cmd.needsTarget) {
      await send(nudge('read'));
      turns.push({ convoId: entry.convoId, command: 'read' });
      continue;
    }

    if (cmd && !reading) {
      let reply;
      try {
        reply = await runCommand(cmd, writeAgent, {
          template: config?.postReport,
          reportTemplate: config?.report,
          lookUp: async (a) => (await getIo()).lookUp(a),
          canWrite,
          generate,
          model: activeModel,
          log,
        });
      } catch (err) {
        reply = {
          text: `That failed: ${String(err?.message || err).slice(0, 300)}`,
          options: null,
        };
      }
      const options = offerable(reply.options);
      await send(reply.text);
      await offerChoices(entry.convoId, options, reply.lastPost);
      log('Ran a command', {
        action: cmd.action,
        actor: cmd.actor ?? cmd.target ?? cmd.code ?? '(none)',
        options: options?.length ?? 0,
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
        // The ASKER. With a roster this is not always dame, and labelling a
        // guest's own messages as somebody else's turns their follow-up into a
        // conversation the model thinks it was watching rather than having.
        selfDid: entry.message?.sender?.did ?? ME_DID,
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
      message: reading ? readRequest(reading) : composeMessage(entry.message),
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
    let offers = offerable(offersFrom(text));
    // After a read, the useful next step is the decision it was for. Built from
    // the scored account rather than lifted from the model's prose, and with
    // the read itself dropped -- offering to read them again having just done
    // it is the kind of menu that teaches you to stop reading menus.
    if (reading) {
      const account = await io.lookUp(reading).catch(() => null);
      if (account) {
        offers = offerable(actionsFor(account)).filter(
          (o) => parseCommand(o.command)?.action !== 'read',
        );
      }
    }
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
