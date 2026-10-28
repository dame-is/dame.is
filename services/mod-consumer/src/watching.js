// The slow loops: watched posts, and dame's own posts taking off.
//
// Both run in the consumer's one job queue like everything else, and only once
// the DMs have been quiet for a minute (see index.js), so an evening of "block"
// never waits behind a harvest. Everything they say goes to the convo it is
// about, and anything they offer is stored as a question a thumbs-up answers.

import { generateText } from 'ai';

import { chunkForDm } from '../../../src/lib/moderation/agent.js';
import { ownLinkFacets } from '../../../src/lib/moderation/links.js';
import {
  liveWatches,
  checkWatch,
  digestFor,
  endExpired,
  ownPostAlerts,
  alertText,
  WATCH_EVERY_MS,
} from '../../../api/_lib/watch.js';
import {
  savePending,
  confirmLine,
  questionOpen,
} from '../../../api/_lib/chatUx.js';

/**
 * Send one digest or alert, with its question stored when it asks one.
 * `links` are the URLs this code built and may render tappable.
 *
 * A QUESTION FROM THE CONVERSATION WINS. There is one stored question per
 * convo, and this runs on a timer while dame may be mid-answer to something the
 * agent asked. When one is open, the message still goes, without its 👍 line
 * and without replacing what a "yes" or a 👍 would run.
 */
export async function say(
  chat,
  convoId,
  { text, pending, describe, links = [] },
) {
  if (!convoId || !text) return [];
  const asks = pending?.length > 0 && !(await questionOpen(convoId));
  const body = asks ? `${text}\n\n${confirmLine([describe])}` : text;
  const ids = [];
  for (const chunk of chunkForDm(body)) {
    const facets = ownLinkFacets(chunk, { allow: links });
    const sent = await chat.chat.bsky.convo.sendMessage({
      convoId,
      message: facets.length ? { text: chunk, facets } : { text: chunk },
    });
    if (sent?.data?.id) ids.push(sent.data.id);
  }
  if (asks) {
    await savePending(convoId, {
      commands: pending,
      describe,
      messageIds: ids,
      background: true,
    });
  }
  return ids;
}

/**
 * Read every watch that is due, send the digests that are, end the expired.
 *
 * A digest waits while a question from the conversation is open in its convo:
 * the watch keeps reading, its counts keep adding up, and the update goes once
 * dame has answered or the question has lapsed. A closing digest cannot wait,
 * so say() sends that one without a question of its own.
 */
export async function tickWatches({
  chat,
  agent,
  reference,
  model,
  log = () => {},
  now = Date.now(),
}) {
  const asking = new Map();
  const busy = async (convoId) => {
    if (!asking.has(convoId)) {
      asking.set(convoId, await questionOpen(convoId, { now }));
    }
    return asking.get(convoId);
  };
  for (const w of await endExpired({ now })) {
    const d = await digestFor(w, { now, ending: true });
    if (d) await say(chat, w.convo_id, d);
  }
  for (const w of await liveWatches({ now })) {
    const due =
      !w.last_checked_at ||
      now - Date.parse(w.last_checked_at) >= WATCH_EVERY_MS - 30_000;
    if (!due) continue;
    try {
      const { io } = await reference();
      await checkWatch(
        w,
        {
          score: io.score,
          writeAgent: agent,
          generate: generateText,
          model,
          log,
        },
        { now },
      );
    } catch (err) {
      log('Watch check failed', {
        uri: w.uri,
        err: String(err?.message || err),
      });
      continue;
    }
    if (await busy(w.convo_id)) continue;
    const d = await digestFor(w, { now });
    if (d) {
      await say(chat, w.convo_id, d);
      log('Sent a watch digest', { uri: w.uri });
    }
  }
}

/**
 * Offer a watch on any of dame's posts that has suddenly taken off.
 *
 * Not while a question from the conversation is open: an alert always asks
 * something, and it is offered once, so it waits for the next tick rather than
 * going out without the 👍 that is the point of it.
 */
export async function tickAlerts({
  chat,
  convoFor,
  log = () => {},
  now = Date.now(),
}) {
  const convoId = await convoFor();
  if (convoId && (await questionOpen(convoId, { now }))) return 0;
  const alerts = await ownPostAlerts({ now });
  if (!alerts.length) return 0;
  for (const a of alerts) {
    await say(chat, convoId, alertText(a));
    log('Offered a watch on a post taking off', {
      uri: a.uri,
      growth: a.growth,
    });
  }
  return alerts.length;
}
