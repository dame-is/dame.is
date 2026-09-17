// The moderation analyst, on a droplet.
//
// Two loops feeding one answering path:
//
//   1. Jetstream — dame's own app.bsky.feed.post creates, filtered at the
//      transport to her DID. Sub-second. Answers in the public thread.
//   2. chat.bsky.convo.getLog on a 2s poll — the ONLY option for DMs. There is
//      no push: the three protocol subscriptions are subscribeRepos,
//      subscribeLabels and chat.bsky.moderation.subscribeModEvents (private,
//      Ozone-only), and chat.bsky.* conversations are not repository records at
//      all. They live in the chat service (did:web:api.bsky.chat) with separate
//      storage, so they never enter a repo, never hit the firehose, and never
//      hit Jetstream. This is settled; it is not worth re-investigating.
//
// Both call `answer()` from src/lib/moderation/agent.js. The DM pass is the
// same module api/mod-agent.js runs, so the droplet and the fallback cannot
// drift apart.
//
// ONE JOB AT A TIME. Every answer is a 5-20s model call that holds a ~73k-row
// reference in memory, and this box has 512 MB with three other services on it.
// Serialising also means a burst of triggers cannot open eight concurrent
// harvests against the AppView.

import { generateText } from 'ai';

import { classify } from '../../../src/lib/moderation/trigger.js';
import {
  answer,
  chunkForPost,
  ancestorsOf,
  threadHistoryFrom,
  DEFAULT_MODEL,
} from '../../../src/lib/moderation/agent.js';
import {
  createAtmosphereClient,
  loadAtmosphereTools,
} from '../../../src/lib/moderation/mcp.js';
import { loadReference, makeIo } from '../../../api/_lib/reference.js';
import { loadAgentConfig } from '../../../api/_lib/agentConfig.js';
import { runDmPass } from '../../../api/_lib/dmLoop.js';
import { botAgent, chatView } from '../../../api/_lib/botAgent.js';
import { upsert } from '../../../api/_lib/modDb.js';

import { config, assertConfig } from './config.js';
import { logger } from './logger.js';
import { loadState, setCursor, hasAnswered, markAnswered } from './state.js';
import { connectJetstream } from './jetstream.js';
import { replyInThread } from './publicReply.js';
import { maybeRunDrift, ownerConvo } from './drift.js';

const model = process.env.MOD_AGENT_MODEL || DEFAULT_MODEL;

let agent = null;
let chat = null;
let botDid = null;

// --- counters ----------------------------------------------------------------
const stats = {
  events: 0,
  triggers: 0,
  publicAnswers: 0,
  dmAnswers: 0,
  errors: 0,
};

// --- the reference, held only while it is being used -------------------------
// 73k vouch rows is the largest thing this process ever holds. Keeping it
// forever to answer a question every few days is the wrong trade on a 512 MB
// box; reloading it is ~74 paged requests, which is seconds, once.
let cached = null;
let idleTimer = null;

function releaseLater() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!cached) return;
    cached = null;
    logger.info('Released the reference snapshot', {
      heap_mb: (process.memoryUsage().heapUsed / 1048576).toFixed(1),
    });
  }, config.referenceIdleMs);
  if (idleTimer.unref) idleTimer.unref();
}

async function reference() {
  if (cached && Date.now() - cached.loadedAt < config.referenceTtlMs) {
    releaseLater();
    return cached;
  }
  const started = Date.now();
  const { ref, takenAt } = await loadReference();
  cached = {
    ref,
    takenAt,
    io: makeIo({ ref, takenAt }),
    loadedAt: Date.now(),
  };
  logger.info('Loaded the reference snapshot', {
    snapshot: takenAt,
    scored: ref.vouches.size,
    circle: ref.circle.size,
    ms: Date.now() - started,
  });
  releaseLater();
  return cached;
}

// --- the Atmosphere toolset, refreshed on a long TTL -------------------------
// Unlike the reference this is small — 38 schemas, no rows — so it is held
// rather than released, and refetched only in case aturi.to publishes something
// new. A failure here is not fatal: the gate's own tools answer every scoring
// question on their own.
let atmoTools = {};
let atmoLoadedAt = 0;

async function atmosphereTools() {
  if (!config.atmosphere) return {};
  if (
    Object.keys(atmoTools).length &&
    Date.now() - atmoLoadedAt < config.atmosphereTtlMs
  ) {
    return atmoTools;
  }
  atmoTools = await loadAtmosphereTools({
    client: createAtmosphereClient({ url: config.atmosphereUrl }),
    log: (msg, fields) => logger.info(msg, fields),
  });
  atmoLoadedAt = Date.now();
  return atmoTools;
}

// --- one job at a time -------------------------------------------------------
let chain = Promise.resolve();
let pending = 0;

function enqueue(label, job) {
  pending += 1;
  chain = chain
    .then(async () => {
      try {
        await job();
      } catch (err) {
        stats.errors += 1;
        logger.error('Job failed', { label, err });
      } finally {
        pending -= 1;
      }
    })
    .catch(() => {
      pending -= 1;
    });
  return chain;
}

// --- the public path ---------------------------------------------------------

/**
 * What the model is asked.
 *
 * dame's own text, plus the subject when it came from the thread rather than
 * from a pasted link — otherwise "check this" names nothing the analyst can
 * look up. The added line is derived by us from the record, not copied from
 * anyone's writing, so it is not untrusted input.
 */
function composeMessage(t) {
  if (!t.target || t.targetSource === 'link') return t.text;
  const verb = t.targetSource === 'quote' ? 'quoting' : 'replying to';
  // "they", not "dame". The asker is whoever is on the roster, and naming the
  // wrong person in the one line the model is told to trust is a cheap way to
  // get a confidently wrong answer about whose post this is.
  return `${t.text}\n\n[The post they are ${verb}: ${t.target}]`;
}

async function readThreadHistory(t) {
  if (!t.isFollowUp) return [];
  try {
    const res = await agent.app.bsky.feed.getPostThread({
      uri: t.uri,
      depth: 0,
      parentHeight: 20,
    });
    return threadHistoryFrom(ancestorsOf(res.data.thread), {
      // The ASKER, not the owner. With a roster these differ, and labelling a
      // guest's own posts as somebody else's turns their follow-up into a
      // conversation the model thinks it was watching rather than having.
      selfDid: t.author ?? config.ownerDid,
      botDid,
    });
  } catch (err) {
    // A thread we cannot read is still a question we can answer, just without
    // context. Better a reply that misses the reference than silence.
    logger.warn('Could not read the thread for history', { err: err.message });
    return [];
  }
}

async function answerPublicly(t) {
  const { io } = await reference();
  const [history, extraTools, config] = await Promise.all([
    readThreadHistory(t),
    atmosphereTools(),
    loadAgentConfig(),
  ]);

  const activeModel = config?.model || model;
  const limits = config?.limits || {};
  const reply = await answer({
    generate: generateText,
    message: composeMessage(t),
    io,
    history,
    model: activeModel,
    surface: 'post',
    extraTools,
    voice: config?.style,
    guidance: config?.guidance,
    maxSteps: limits.maxSteps,
    reviewRows: limits.reviewRows,
  });

  const text = reply.text || 'No answer produced.';
  const chunks = chunkForPost(text);
  const posted = await replyInThread(agent, t.reply, chunks);

  await upsert('llm_usage', [
    {
      kind: 'post',
      model: activeModel,
      input_tokens: reply.usage?.inputTokens ?? null,
      output_tokens: reply.usage?.outputTokens ?? null,
    },
  ]).catch((err) => logger.warn('Could not record llm usage', { err }));

  stats.publicAnswers += 1;
  logger.info('Answered publicly', {
    trigger: t.uri,
    target: t.target ?? '(follow-up)',
    posts: posted.length || chunks.length,
    steps: reply.steps,
  });
}

function onEvent(event) {
  stats.events += 1;
  if (event.time_us) setCursor(event.time_us);

  const t = classify(event, {
    ownerDid: config.ownerDid,
    botDid,
    answers: config.roster.answers,
  });
  if (!t.trigger) {
    logger.trace('Not a trigger', { reason: t.reason });
    return;
  }
  if (!config.publicReplies) {
    logger.info('Public replies are off; ignoring a mention', { uri: t.uri });
    return;
  }
  // Marked BEFORE the answer, not after. Jetstream replays from a cursor and
  // this consumer recycles its connection on a timer, so the same trigger
  // arrives again as a matter of course. One duplicate public reply under
  // someone else's thread is worse than one missed answer dame can see is
  // missing and simply ask again.
  if (hasAnswered(t.uri)) {
    logger.debug('Already answered', { uri: t.uri });
    return;
  }
  // Not in a dry run: a rehearsal must not leave a real trigger marked as
  // handled, or turning DRY_RUN off would skip the very posts it just showed
  // you. A dry run re-logging the same trigger on reconnect is the cheaper
  // annoyance.
  if (!config.dryRun) markAnswered(t.uri);

  stats.triggers += 1;
  logger.info('Trigger', {
    uri: t.uri,
    target: t.target ?? '(none)',
    source: t.targetSource ?? '-',
    followUp: t.isFollowUp,
  });
  enqueue('public', () => answerPublicly(t));
}

// --- the DM path -------------------------------------------------------------
let dmTimer = null;

async function pollDms() {
  const res = await runDmPass({
    chat,
    writeAgent: agent,
    // Lazy on purpose. A poll that finds nothing is almost every poll, and
    // loading the snapshot on each one would both waste the read and keep the
    // idle timer below from ever firing — so the memory this is all arranged
    // to release would never be released.
    getIo: async () => (await reference()).io,
    extraTools: await atmosphereTools(),
    model,
    botDid,
    log: (msg, fields) => logger.info(msg, fields),
  });
  if (res.answered) stats.dmAnswers += res.answered;
}

function scheduleDmPoll() {
  dmTimer = setInterval(() => {
    // Skipped while anything is queued or in flight. The poll exists to notice
    // a new message quickly, and noticing it 2s into a 15s answer changes
    // nothing — while stacking 8 polls behind that answer would then fire them
    // back to back against the chat service.
    if (pending > 0 || shuttingDown) return;
    enqueue('dm', pollDms);
  }, config.dmPollMs);
  if (dmTimer.unref) dmTimer.unref();
}

// --- the weekly re-score -----------------------------------------------------
let driftTimer = null;

function scheduleDrift() {
  if (!config.driftEveryHours) {
    logger.info('Drift audits are off');
    return;
  }
  const tick = () => {
    // Queued like everything else, so a re-score of 8,500 accounts cannot run
    // alongside a model call on a 512 MB box.
    if (pending > 0 || shuttingDown) return;
    enqueue('drift', async () => {
      const convoId = await ownerConvo(chat);
      const body = await maybeRunDrift(agent, chat, convoId);
      if (body) logger.info('Sent a drift brief');
    });
  };
  driftTimer = setInterval(tick, config.driftCheckMs);
  if (driftTimer.unref) driftTimer.unref();
}

// --- stats -------------------------------------------------------------------
function logStats() {
  logger.info('stats', {
    ...stats,
    reference: cached ? 'held' : 'released',
    queued: pending,
    rss_mb: (process.memoryUsage().rss / 1048576).toFixed(1),
    heap_mb: (process.memoryUsage().heapUsed / 1048576).toFixed(1),
  });
}

// --- start -------------------------------------------------------------------
let stream = null;
let statsTimer = null;
let shuttingDown = false;

async function start() {
  // Inside start(), not at module scope, so a missing environment variable is
  // one readable line in the journal instead of an ESM stack trace.
  assertConfig();
  loadState();

  const session = await botAgent();
  agent = session.agent;
  chat = chatView(agent);
  botDid = agent.session?.did;
  logger.info('Moderator session ready', {
    did: botDid,
    handle: agent.session?.handle,
    via: session.via,
  });

  if (botDid === config.ownerDid) {
    // The bot answering itself is a loop with a credit card attached.
    throw new Error(
      'MOD_IDENTIFIER and MOD_OWNER_DID are the same account — the bot would answer its own posts',
    );
  }

  // Probe the chat service once at boot rather than discovering at 3am that the
  // app password was created without "Allow access to your direct messages".
  // That failure is silent by design: a plain app password is simply excluded
  // from chat.bsky.*, so the loop finds nothing and reports success forever.
  try {
    await chat.chat.bsky.convo.getLog({});
    logger.info('Chat access confirmed');
  } catch (err) {
    logger.error(
      'Chat access FAILED — the app password is probably missing DM access. ' +
        'Bluesky: Settings -> Privacy and Security -> App Passwords, with ' +
        '"Allow access to your direct messages" ticked. The DM loop will find nothing.',
      { err: err.message },
    );
  }

  scheduleDmPoll();
  scheduleDrift();
  stream = connectJetstream({ onEvent });

  if (config.statsIntervalMs > 0) {
    statsTimer = setInterval(logStats, config.statsIntervalMs);
    if (statsTimer.unref) statsTimer.unref();
  }

  // Warm the tool list at boot so the first question does not pay for it, and
  // so a misconfigured URL shows up now rather than mid-answer.
  await atmosphereTools();

  logger.info('Consumer started', {
    owner: config.ownerDid,
    answering: config.roster.all.length,
    writers: config.roster.allWriters.length,
    atmosphere: config.atmosphere ? Object.keys(atmoTools).length : 'off',
    dmPollMs: config.dmPollMs,
    publicReplies: config.publicReplies,
    driftEveryHours: config.driftEveryHours,
    dryRun: config.dryRun,
    model,
    logLevel: logger.level,
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down', { signal });
  if (dmTimer) clearInterval(dmTimer);
  if (driftTimer) clearInterval(driftTimer);
  if (statsTimer) clearInterval(statsTimer);
  stream?.close();
  // Let an in-flight answer finish rather than killing it mid-thread and
  // leaving half a reply posted. systemd gives 60s (TimeoutStopSec).
  await Promise.race([chain, new Promise((r) => setTimeout(r, 45_000))]);
  logStats();
  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  stats.errors += 1;
  logger.error('uncaughtException', { err });
});
process.on('unhandledRejection', (err) => {
  stats.errors += 1;
  logger.error('unhandledRejection', { err });
});

start().catch((err) => {
  logger.error('Failed to start', { err });
  process.exit(1);
});
