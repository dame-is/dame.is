// How a DM turn feels, as opposed to what it does to the list.
//
// Built from how the bot was actually used (120 requests, 2026-09-16 to 10-01):
// about fifty were "block" plus a shared post, often twenty in an evening, each
// taking 8-15 seconds and leaving a receipt behind; a bare post was answered
// from a numbered menu; and agent mode turned "yes" into a second full model
// turn. So:
//
//   REACTIONS, NOT ACKS. 👀 on dame's message when it is picked up, ✅ when
//   something changed, ❌ when it failed. No "Thinking." message, and a plain
//   block needs no reply at all.
//
//   THE BURST SUMMARY. Quiet blocks are collected, and once a minute passes
//   without another, one message lists them: who, how many were already on the
//   list, how many already block dame, and how to take one back.
//
//   CONFIRMATIONS A 👍 CAN ANSWER. When the bot asks before changing something,
//   the exact change is stored with the message that asked. "yes" or a 👍 on
//   that message runs it as described, through the classic commands, with no
//   model in between; "no" or 👎 drops it. Anything else lets it lapse.
//
//   THE POST CARD. A post with no words gets one compact summary and answers to
//   words -- author, likers, unknowns, everyone, hostile -- instead of numbers.

import { select, upsert } from './modDb.js';

export const REACTION = { working: '👀', done: '✅', failed: '❌' };
/** Reactions on the bot's question that mean yes, and no. */
export const YES_REACTIONS = new Set(['👍', '✅', '👌']);
export const NO_REACTIONS = new Set(['👎', '❌']);

/** How long a stored question stays answerable. */
export const PENDING_TTL_MS = 30 * 60_000;
/** How long a burst has to go quiet before it is summarised. */
export const QUIET_MS = 60_000;

/**
 * React to a message. Never throws: a reaction that did not land is not a
 * reason to lose the answer behind it. Returns whether it landed, so a caller
 * can fall back to a text ack.
 */
export async function react(chat, convoId, messageId, value) {
  const convo = chat?.chat?.bsky?.convo;
  if (!convo?.addReaction || !messageId) return false;
  try {
    await convo.addReaction({ convoId, messageId, value });
    return true;
  } catch {
    return false;
  }
}

export async function unreact(chat, convoId, messageId, value) {
  const convo = chat?.chat?.bsky?.convo;
  if (!convo?.removeReaction || !messageId) return false;
  try {
    await convo.removeReaction({ convoId, messageId, value });
    return true;
  } catch {
    return false;
  }
}

/** Swap 👀 for how it went: ✅, ❌, or nothing for an answer without a change. */
export async function settle(chat, convoId, messageId, outcome) {
  await unreact(chat, convoId, messageId, REACTION.working);
  if (outcome === 'done') await react(chat, convoId, messageId, REACTION.done);
  if (outcome === 'failed') {
    await react(chat, convoId, messageId, REACTION.failed);
  }
}

// --- confirmations -----------------------------------------------------------

/**
 * Store a question the bot just asked.
 *
 * `commands` are classic command strings ("list add @x", "approve 1c2d3e4f
 * UNKNOWN"), so a "yes" runs exactly what parseCommand reads, through the same
 * path a typed command takes, vetoes and all. `describe` is the code-written
 * sentence dame was shown.
 */
export async function savePending(convoId, { commands, describe, messageIds }) {
  await upsert('dm_choice', [
    {
      convo_id: convoId,
      pending: {
        commands,
        describe,
        message_ids: messageIds || [],
        created_at: new Date().toISOString(),
      },
    },
  ]);
}

/** The live question for this convo, or null. */
export async function readPending(convoId, { now = Date.now() } = {}) {
  const rows = await select('dm_choice', {
    select: 'pending',
    eq: { convo_id: convoId },
  }).catch(() => []);
  const p = rows?.[0]?.pending;
  if (!p?.commands?.length) return null;
  if (now - Date.parse(p.created_at) > PENDING_TTL_MS) return null;
  return p;
}

export async function clearPending(convoId) {
  await upsert('dm_choice', [{ convo_id: convoId, pending: null }]).catch(
    () => {},
  );
}

/** The line that tells dame what a 👍 will do, written by code. */
export function confirmLine(items) {
  if (!items?.length) return '';
  if (items.length === 1) return `👍 or "yes" to: ${items[0]}`;
  return `👍 or "yes" to do all of this:\n${items.map((d, i) => `${i + 1}. ${d}`).join('\n')}`;
}

// --- the burst summary -------------------------------------------------------

const quiet = new Map();

/**
 * Remember a block that got only a ✅. `item` is { action, handle, already,
 * blocksYou }.
 */
export function noteQuiet(convoId, item, now = Date.now()) {
  const entry = quiet.get(convoId) || { items: [], firstAt: now, lastAt: now };
  entry.items.push(item);
  entry.lastAt = now;
  quiet.set(convoId, entry);
}

/**
 * Bursts that have gone quiet, taken out of the buffer. A burst of one is
 * dropped without a summary: its ✅ already said everything.
 */
export function takeDueSummaries({
  now = Date.now(),
  quietMs = QUIET_MS,
  force = false,
} = {}) {
  const out = [];
  for (const [convoId, entry] of quiet) {
    if (!force && now - entry.lastAt < quietMs) continue;
    quiet.delete(convoId);
    if (entry.items.length >= 2) out.push({ convoId, ...entry });
  }
  return out;
}

/** For tests. */
export function resetQuiet() {
  quiet.clear();
}

const names = (items, max = 6) => {
  const handles = items.map((i) => `@${i.handle}`);
  return handles.length > max
    ? `${handles.slice(0, max).join(', ')} and ${handles.length - max} more`
    : handles.join(', ');
};

/** One message for a burst of quiet blocks. */
export function summaryText({ items, firstAt, lastAt }) {
  const added = items.filter((i) => i.action === 'list_add' && !i.already);
  const again = items.filter((i) => i.action === 'list_add' && i.already);
  const removed = items.filter((i) => i.action === 'list_remove' && !i.already);
  const minutes = Math.max(1, Math.round((lastAt - firstAt) / 60_000));
  const lines = [];
  if (added.length) {
    lines.push(
      `Blocked ${added.length} in the last ${minutes} min: ${names(added)}.`,
    );
  }
  if (again.length) {
    lines.push(
      `${again.length === 1 ? '1 was' : `${again.length} were`} already on the list: ${names(again, 4)}.`,
    );
  }
  if (removed.length)
    lines.push(`Unblocked ${removed.length}: ${names(removed, 4)}.`);
  const blockers = added.filter((i) => i.blocksYou).length;
  if (blockers) {
    lines.push(
      `${blockers === 1 ? '1 of them already blocks' : `${blockers} of them already block`} you, so they can't reply to or quote you; the list still covers your subscribers.`,
    );
  }
  if (added.length) lines.push('"unblock @handle" takes one back.');
  return lines.join('\n');
}

// --- the post card -----------------------------------------------------------

const nf = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;

/**
 * What a bare post gets instead of the agent or a numbered menu.
 *
 * Counts only; no handles but the author's, so nothing a stranger wrote can
 * shape it. Built from proposePlan's return.
 */
export function renderCard(plan, { choices = cardChoices(plan) } = {}) {
  const a = plan.author;
  const lines = [];
  if (a) {
    const facts = [a.band];
    if (a.followers != null) facts.push(`${nf(a.followers)} followers`);
    if (a.blocksYou) facts.push('blocks you');
    if (a.alreadyListed) facts.push('already on the list');
    if (a.protectedReason) facts.push(`PROTECTED: ${a.protectedReason}`);
    lines.push(`@${a.handle || a.did} (${facts.join(', ')}) wrote this.`);
  }
  const e = plan.engagements || {};
  const parts = [
    e.like && plural(e.like, 'like', 'likes'),
    e.repost && plural(e.repost, 'repost', 'reposts'),
    e.quote && plural(e.quote, 'quote', 'quotes'),
    (e.reply || e.threadReply) &&
      plural((e.reply || 0) + (e.threadReply || 0), 'reply', 'replies'),
  ].filter(Boolean);
  if (plan.total) {
    lines.push(
      `${plural(plan.total, 'account', 'accounts')} engaged${parts.length ? `: ${parts.join(', ')}` : ''}.`,
    );
    const b = plan.byBand || {};
    const bands = ['UNKNOWN', 'PERIPHERAL', 'NOTABLE', 'CONNECTED', 'PROTECTED']
      .filter((k) => b[k])
      .map((k) => `${nf(b[k])} ${k.toLowerCase()}`);
    if (bands.length) lines.push(`By band: ${bands.join(', ')}.`);
    const known = [
      plan.alreadyListed && `${nf(plan.alreadyListed)} already on the list`,
      plan.blocksYou && `${nf(plan.blocksYou)} already block you`,
    ].filter(Boolean);
    if (known.length) lines.push(`${known.join(', ')}.`);
  } else {
    lines.push('Nobody has engaged with it yet.');
  }
  const keys = choices.map((o) => o.key);
  if (keys.length) lines.push('', `Reply with: ${keys.join(' · ')}`);
  return lines.join('\n');
}

/**
 * The words the card answers to, each with the classic command it runs.
 * Only words that would do something: no "likers" on a post nobody liked.
 */
export function cardChoices(plan) {
  const out = [];
  const a = plan.author;
  // Counts of who an approval could still ADD, when the scan knows them: an
  // engager already on the list is not a reason to offer "everyone".
  const b = plan.fresh?.byBand || plan.byBand || {};
  const e = plan.fresh
    ? { ...plan.engagements, like: plan.fresh.likers }
    : plan.engagements || {};
  if (a && !a.protectedReason && !a.alreadyListed) {
    out.push({
      key: 'author',
      label: `Add the author @${a.handle || a.did}`,
      command: `list add @${a.handle || a.did}`,
    });
  }
  if (e.like) {
    out.push({
      key: 'likers',
      label: 'Add everyone who liked it',
      command: `approve ${plan.code} likers`,
    });
  }
  if (b.UNKNOWN) {
    out.push({
      key: 'unknowns',
      label: `Add the ${b.UNKNOWN} UNKNOWN accounts`,
      command: `approve ${plan.code} UNKNOWN`,
    });
  }
  const bands = ['UNKNOWN', 'PERIPHERAL', 'NOTABLE', 'CONNECTED'].filter(
    (k) => b[k],
  );
  if (bands.length > 1 || (bands.length === 1 && bands[0] !== 'UNKNOWN')) {
    out.push({
      key: 'everyone',
      label: 'Add everyone, every band but PROTECTED',
      command: `approve ${plan.code} ${bands.join(',')}`,
    });
  }
  if (plan.withText) {
    out.push({
      key: 'hostile',
      label: 'Read the replies and quotes, add the hostile ones',
      command: `hostile ${plan.code}`,
    });
  }
  return out;
}
