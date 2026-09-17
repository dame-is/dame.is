// Re-score the list against today's graph, and say what moved.
//
// The system's founding argument is that a bulk sweep knows the graph around one
// post at one moment and nothing about how those accounts relate to dame. That
// argument does not stop being true after the sweep. Someone blocked in
// September as a stranger may have three vouches now, and until this existed
// nothing checked: the audit was a thing dame ran by hand, twice ever.
//
// So this runs the audit on a timer and DMs only the DELTAS. A weekly message
// saying "6 accounts on your list are no longer strangers" is a list that
// corrects itself. A weekly message restating 8,543 unchanged rows is a message
// that stops being read, which is the same failure as a batch nobody reviews.
//
// On the droplet rather than a cron because scoring 8,500 accounts is about 600
// AppView requests, and a serverless budget is exactly what turned the
// precompute into a resumable state machine with three bugs in it.

import crypto from 'node:crypto';

import { ME_DID } from '../../../src/config.js';
import { createScorer } from '../../../src/lib/moderation/score.js';
import { loadReference } from '../../../api/_lib/reference.js';
import { listUri } from '../../../api/_lib/listWrite.js';
import { select, selectAll, upsert } from '../../../api/_lib/modDb.js';
import { chunkForDm } from '../../../src/lib/moderation/agent.js';
import { config } from './config.js';
import { logger } from './logger.js';

/** "1 are gone" is the sort of thing that makes a machine sound like a machine. */
const plural = (n, one, many) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Bands that mean "this one is not a stranger any more". */
const NOT_A_STRANGER = new Set([
  'PROTECTED',
  'CONNECTED',
  'PERIPHERAL',
  'NOTABLE',
]);

/** Every subject currently on the list, read from the repo that owns it. */
async function listMembers(agent) {
  const uri = listUri();
  const owner = /^at:\/\/(did:[^/]+)\//.exec(uri)?.[1];
  const subjects = [];
  let cursor;
  for (let page = 0; page < 400; page += 1) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: owner,
      collection: 'app.bsky.graph.listitem',
      limit: 100,
      cursor,
    });
    for (const rec of res.data.records || []) {
      if (rec.value?.list === uri && rec.value?.subject) {
        subjects.push(rec.value.subject);
      }
    }
    cursor = res.data.cursor;
    if (!cursor || !(res.data.records || []).length) break;
  }
  return [...new Set(subjects)];
}

/** The band each account had at the last audit. */
async function previousBands() {
  const audits = await select('audit', {
    select: 'id,started_at,total',
    order: 'started_at.desc',
    limit: 5,
  });
  // Skip runs that scored nothing. One of those shadowed a real queue of 495
  // for hours because everything keyed off "latest".
  const last = (audits || []).find((a) => a.total > 0);
  if (!last) return { auditId: null, bands: new Map() };
  const items = await selectAll('audit_item', {
    select: 'did,band',
    eq: { audit_id: last.id },
    order: 'did.asc',
  });
  return {
    auditId: last.id,
    bands: new Map(items.map((i) => [i.did, i.band])),
  };
}

/**
 * Score the list, store the audit, and return what changed.
 *
 * @returns {Promise<{scored:number, drifted:Array, gone:Array, added:number, auditId:string}>}
 */
export async function runDrift(agent) {
  const started = Date.now();
  const members = await listMembers(agent);
  if (!members.length) return { scored: 0, drifted: [], gone: [], added: 0 };

  const { ref, thresholds, takenAt } = await loadReference();
  const scorer = createScorer({ ...ref, thresholds });
  const { bands: before } = await previousBands();

  const auditId = crypto.randomUUID();
  await upsert('audit', [
    {
      id: auditId,
      list_uri: listUri(),
      started_at: new Date().toISOString(),
      total: members.length,
      scored: 0,
    },
  ]);

  const drifted = [];
  const gone = [];
  let added = 0;
  let scored = 0;

  for (let i = 0; i < members.length; i += 200) {
    const batch = members.slice(i, i + 200);
    const scores = await scorer.score(batch);
    const rows = [];
    for (const did of batch) {
      const a = scores.get(did);
      if (!a) continue;
      rows.push({
        audit_id: auditId,
        did,
        handle: a.handle ?? null,
        band: a.band,
        trust: a.trust ?? null,
        vouches: a.vouches ?? null,
        followers: a.followers ?? null,
        protected_reason: a.protectedReason ?? null,
      });

      const was = before.get(did);
      if (was === undefined) added += 1;
      else if (
        was !== a.band &&
        NOT_A_STRANGER.has(a.band) &&
        was === 'UNKNOWN'
      ) {
        // The one that matters: a stranger who is not one any more.
        drifted.push({
          did,
          handle: a.handle,
          was,
          now: a.band,
          vouches: a.vouches,
        });
      }
      // `missing` means the AppView has no profile: deactivated, taken down, or
      // deleted. Dead weight on a list, and worth saying so.
      if (a.missing) gone.push({ did, handle: a.handle });
    }
    await upsert('audit_item', rows);
    scored += rows.length;
  }

  await upsert('audit', [
    {
      id: auditId,
      list_uri: listUri(),
      total: members.length,
      scored,
      finished_at: new Date().toISOString(),
    },
  ]);

  logger.info('Drift audit complete', {
    scored,
    drifted: drifted.length,
    gone: gone.length,
    added,
    snapshot: takenAt,
    ms: Date.now() - started,
  });
  return { scored, drifted, gone, added, auditId };
}

/** The brief, or null when there is nothing worth saying. */
export function renderBrief({ scored, drifted, gone, added }) {
  if (!drifted.length && !gone.length) return null;

  const lines = [
    `Re-scored ${scored.toLocaleString()} accounts on the list.`,
    '',
  ];
  if (drifted.length) {
    lines.push(
      `${plural(drifted.length, 'account is', 'accounts are')} no longer a stranger:`,
      ...drifted
        .sort((a, b) => (b.vouches ?? 0) - (a.vouches ?? 0))
        .slice(0, 12)
        .map(
          (d) =>
            `  @${d.handle ?? d.did} is now ${d.now}, ${plural(d.vouches ?? 0, 'vouch', 'vouches')}`,
        ),
    );
    if (drifted.length > 12) lines.push(`  and ${drifted.length - 12} more`);
    lines.push('');
  }
  if (gone.length) {
    lines.push(
      `${plural(gone.length, 'account is', 'accounts are')} gone: deactivated, taken down, or deleted.`,
      '',
    );
  }
  if (added) {
    lines.push(
      `${plural(added, 'account', 'accounts')} added since the last audit.`,
      '',
    );
  }
  lines.push('Open the Audit tab to work through them.');
  return lines.join('\n');
}

/**
 * Run if it is due, and tell dame if anything moved.
 *
 * Silence is the correct output most weeks. A brief that arrives every week
 * saying nothing changed is one that stops being read.
 */
export async function maybeRunDrift(agent, chat, convoId) {
  const rows = await select('brief', {
    select: 'for_date,sent_at',
    order: 'for_date.desc',
    limit: 1,
  }).catch(() => []);
  const last = rows?.[0]?.for_date ? Date.parse(rows[0].for_date) : 0;
  const dueAfter = config.driftEveryHours * 3600_000;
  if (Date.now() - last < dueAfter) return null;

  const result = await runDrift(agent);
  const body = renderBrief(result);

  await upsert('brief', [
    {
      id: crypto.randomUUID(),
      for_date: new Date().toISOString().slice(0, 10),
      body: body ?? 'No drift.',
      sent_at: body ? new Date().toISOString() : null,
    },
  ]).catch(() => {});

  if (body && chat && convoId) {
    for (const chunk of chunkForDm(body)) {
      await chat.chat.bsky.convo.sendMessage({
        convoId,
        message: { text: chunk },
      });
    }
  }
  return body;
}

/** The conversation to send a brief into: dame's, or none. */
export async function ownerConvo(chat) {
  try {
    const res = await chat.chat.bsky.convo.getConvoForMembers({
      members: [ME_DID],
    });
    return res.data.convo?.id ?? null;
  } catch {
    return null;
  }
}
