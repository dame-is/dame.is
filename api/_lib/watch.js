// Watching a post: pile-ons run for hours, and the only way to keep up used to be
// sending the same post again (the same triage was asked for three times on
// 2026-09-18).
//
// A watch is a plan that keeps growing. Every few minutes the post's quotes and
// replies are harvested again; anyone new is scored, added to the watch's plan
// with what they wrote, and read by the same two-wave triage as everything else.
// Then, depending on what dame asked for:
//
//   ask   (the default) nothing is added. The hourly digest says what was found
//         and a 👍 adds the hostile ones.
//   auto  ("watch this and block the hostile ones") the accounts both waves call
//         hostile are added as they are found, and the digest says who, with the
//         way to take one back. CONNECTED and NOTABLE accounts are held for a 👍
//         even then: someone your circle follows is never blocked on a model's
//         reading alone.
//
// Likes and reposts are not read: they carry no words to judge. The first scan
// covers them, and "likers" / "unknowns" on the card are the tools for those.
//
// Also here: noticing when one of dame's own posts suddenly draws quotes and
// replies, so the bot can offer a watch before dame has to ask.

import { ME_DID, APPVIEW } from '../../src/config.js';
import { resolveTarget } from '../../src/lib/moderation/target.js';
import { harvestPost } from '../../src/lib/moderation/harvest.js';
import { summarise } from '../../src/lib/moderation/score.js';
import { postWebUrl, planLink } from '../../src/lib/moderation/links.js';
import { select, selectAll, upsert, update } from './modDb.js';
import {
  proposePlan,
  applyPlanToTriage,
  countDecisions,
  shortCode,
} from './bulkPlan.js';
import { runTriage, evidenceUriFor } from './triage.js';

/** How often a watched post is read again. */
export const WATCH_EVERY_MS = 5 * 60_000;
/** How often a watch with news reports. */
export const DIGEST_EVERY_MS = 60 * 60_000;
/** Engagement worth reading on a watched post. */
const READ_KINDS = ['quote', 'reply', 'threadReply'];
/** Bands a watch never adds without a 👍, even in auto. */
const HELD_BANDS = ['PROTECTED', 'CONNECTED', 'NOTABLE'];

const hoursLeft = (w, now) =>
  Math.max(0, Math.round((Date.parse(w.until) - now) / 3_600_000));

/** Live watches, newest first. */
export async function liveWatches({ now = Date.now() } = {}) {
  const rows = await select('watch', {
    select:
      'id,convo_id,uri,plan_id,mode,created_at,until,last_checked_at,last_digest_at,stats',
    is: { stopped_at: 'null' },
    order: 'created_at.desc',
  });
  return (rows || []).filter((w) => Date.parse(w.until) > now);
}

/**
 * Start watching, or extend and re-mode a watch already running on that post.
 *
 * @returns {Promise<{ watch, plan, extended: boolean }>}
 */
export async function startWatch({
  convoId,
  target,
  hours = 24,
  auto = false,
  now = Date.now(),
}) {
  const resolved = await resolveTarget(target);
  const until = new Date(now + hours * 3_600_000).toISOString();
  const mode = auto ? 'auto' : 'ask';
  const running = (await liveWatches({ now })).find(
    (w) => w.uri === resolved.uri,
  );
  if (running) {
    await update('watch', { eq: { id: running.id } }, { until, mode });
    const plan = running.plan_id ? await findPlanById(running.plan_id) : null;
    return { watch: { ...running, until, mode }, plan, extended: true };
  }
  // The baseline: everyone so far, scored, with what they wrote. Later checks
  // only add the new ones to this same plan.
  const plan = await proposePlan({ link: resolved.uri, kind: 'everyone' });
  const watch = {
    convo_id: convoId,
    uri: resolved.uri,
    plan_id: plan.planId,
    mode,
    until,
    stats: { baseline: plan.total, newSinceDigest: 0, checks: 0 },
  };
  await upsert('watch', [watch]);
  const [row] = await select('watch', {
    select: 'id,convo_id,uri,plan_id,mode,created_at,until,stats',
    eq: { plan_id: plan.planId },
    limit: 1,
  });
  return { watch: row || watch, plan, extended: false };
}

async function findPlanById(id) {
  const rows = await select('plan', {
    select: 'id,created_at,approved_at,approved_bands,totals,note',
    eq: { id },
    limit: 1,
  });
  return rows?.[0] ?? null;
}

/** Stop the watch on this post, or the newest one if no post was named. */
export async function stopWatch({ target = null, now = Date.now() } = {}) {
  const live = await liveWatches({ now });
  let watch = live[0] ?? null;
  if (target) {
    const uri = (await resolveTarget(target).catch(() => null))?.uri;
    watch = live.find((w) => w.uri === uri) ?? null;
  }
  if (!watch) return null;
  await update(
    'watch',
    { eq: { id: watch.id } },
    { stopped_at: new Date(now).toISOString() },
  );
  return watch;
}

/** The reply to "what are you watching". */
export function watchesText(watches, { now = Date.now() } = {}) {
  if (!watches.length) {
    return 'Not watching anything. Send a post with "watch this" to start.';
  }
  return [
    `Watching ${watches.length === 1 ? 'one post' : `${watches.length} posts`}:`,
    ...watches.map(
      (w) =>
        `- ${postWebUrl(w.uri) || w.uri} (${hoursLeft(w, now)}h left, ${w.mode === 'auto' ? 'blocking the hostile ones' : 'asking before adding'})`,
    ),
    '',
    '"stop watching" ends the newest; send the post with it to end that one.',
  ].join('\n');
}

/**
 * Read a watched post again: new quote-posters and repliers join the plan with
 * what they wrote, the triage reads them, and an auto watch adds the hostile.
 *
 * @param {object} deps { score(dids) -> Map, writeAgent, generate, model, log }
 * @returns {Promise<{ fresh: number, hostile: number, added: number, held: number }>}
 */
export async function checkWatch(watch, deps, { now = Date.now() } = {}) {
  const { score, writeAgent, generate, model, log = () => {} } = deps;
  const plan = await findPlanById(watch.plan_id);
  if (!plan) return { fresh: 0, hostile: 0, added: 0, held: 0 };

  const harvest = await harvestPost(watch.uri, {
    only: READ_KINDS,
    maxPages: 20,
  });
  const known = new Set(
    (
      await selectAll('decision', {
        select: 'did',
        eq: { plan_id: plan.id },
        order: 'did.asc',
      })
    ).map((r) => r.did),
  );
  const newcomers = harvest.participants.filter(
    (p) => !known.has(p.did) && p.did !== ME_DID,
  );

  if (newcomers.length) {
    const scores = await score(newcomers.map((p) => p.did));
    const { rows } = summarise(
      { ...harvest, participants: newcomers },
      scores,
      { excludeSelf: ME_DID },
    );
    await upsert(
      'decision',
      rows.map((r) => ({
        plan_id: plan.id,
        did: r.did,
        band: r.band,
        trust: r.trust ?? null,
        distance: r.distance ?? null,
        vouches: r.vouches ?? null,
        action: null,
        evidence_uri: evidenceUriFor(r),
        engaged: Object.keys(r.engagements || {}),
        already_listed: Boolean(r.alreadyListed),
        blocks_me: Boolean(r.blocksYou),
      })),
    );
  }

  // Reads whatever on the plan has words and no label yet: the newcomers.
  const hostileBefore = await countDecisions(plan, { label: 'hostile' });
  if (newcomers.length) {
    await runTriage(plan, { generate, model, log }).catch((err) =>
      log('Watch triage failed', {
        uri: watch.uri,
        err: String(err?.message || err),
      }),
    );
  }
  const hostileNow = await countDecisions(plan, { label: 'hostile' });
  const hostile = Math.max(0, hostileNow - hostileBefore);

  let added = 0;
  if (watch.mode === 'auto' && hostileNow && writeAgent) {
    const out = await applyPlanToTriage(writeAgent, plan, 'hostile', {
      by: 'watch',
      skipBands: HELD_BANDS,
    });
    added = out.added || 0;
  }
  const held =
    watch.mode === 'auto'
      ? await countDecisions(plan, {
          label: 'hostile',
          bands: ['CONNECTED', 'NOTABLE'],
        })
      : hostileNow;

  const stats = watch.stats || {};
  const next = {
    ...stats,
    checks: (stats.checks || 0) + 1,
    newSinceDigest: (stats.newSinceDigest || 0) + newcomers.length,
    hostileSinceDigest: (stats.hostileSinceDigest || 0) + hostile,
    addedSinceDigest: (stats.addedSinceDigest || 0) + added,
    addedTotal: (stats.addedTotal || 0) + added,
    newTotal: (stats.newTotal || 0) + newcomers.length,
    held,
  };
  await update(
    'watch',
    { eq: { id: watch.id } },
    { last_checked_at: new Date(now).toISOString(), stats: next },
  );
  watch.stats = next;
  log('Checked a watched post', {
    uri: watch.uri,
    fresh: newcomers.length,
    hostile,
    added,
    held,
  });
  return { fresh: newcomers.length, hostile, added, held };
}

/**
 * The hourly digest for a watch, or null when there is nothing to say. Also
 * resets the per-digest counters. `pending` is the classic command a 👍 runs.
 *
 * @returns {Promise<null | { text: string, pending: string[]|null, describe: string|null }>}
 */
export async function digestFor(
  watch,
  { now = Date.now(), ending = false } = {},
) {
  const s = watch.stats || {};
  const due =
    ending ||
    !watch.last_digest_at ||
    now - Date.parse(watch.last_digest_at) >= DIGEST_EVERY_MS;
  if (!due) return null;
  const news = s.newSinceDigest || s.hostileSinceDigest || s.addedSinceDigest;
  if (!news && !ending) return null;

  const code = shortCode(watch.plan_id);
  const link = postWebUrl(watch.uri) || watch.uri;
  const lines = [];
  if (ending) {
    lines.push(
      `Stopped watching ${link}: ${s.newTotal || 0} new quotes and replies, ${s.addedTotal || 0} added.`,
    );
  } else {
    lines.push(
      `Watching ${link} (${hoursLeft(watch, now)}h left): ${s.newSinceDigest || 0} new quotes and replies since the last update, ${s.hostileSinceDigest || 0} read as hostile.`,
    );
  }
  let pending = null;
  let describe = null;
  if (watch.mode === 'auto' && s.addedSinceDigest) {
    lines.push(
      `Added ${s.addedSinceDigest}. Who: ${planLink(code, { label: 'hostile', state: 'added' })}`,
    );
  }
  if (s.held) {
    lines.push(
      watch.mode === 'auto'
        ? `${s.held} hostile ${s.held === 1 ? 'one is' : 'ones are'} CONNECTED or NOTABLE, so I held ${s.held === 1 ? 'it' : 'them'}: ${planLink(code, { label: 'hostile', state: 'pending' })}`
        : `Read them: ${planLink(code, { label: 'hostile', state: 'pending' })}`,
    );
    pending = [`approve ${code} hostile`];
    describe = `add the ${s.held} read as hostile on the watched post (plan ${code})`;
  }
  await update(
    'watch',
    { eq: { id: watch.id } },
    {
      last_digest_at: new Date(now).toISOString(),
      stats: {
        ...s,
        newSinceDigest: 0,
        hostileSinceDigest: 0,
        addedSinceDigest: 0,
      },
    },
  );
  return {
    text: lines.join('\n'),
    pending,
    describe,
    links: [postWebUrl(watch.uri)],
  };
}

/** Watches whose time is up, stopped, each with a closing digest. */
export async function endExpired({ now = Date.now() } = {}) {
  const rows = await select('watch', {
    select: 'id,convo_id,uri,plan_id,mode,until,last_digest_at,stats',
    is: { stopped_at: 'null' },
  });
  const ended = [];
  for (const w of rows || []) {
    if (Date.parse(w.until) > now) continue;
    await update(
      'watch',
      { eq: { id: w.id } },
      { stopped_at: new Date(now).toISOString() },
    );
    ended.push(w);
  }
  return ended;
}

// --- dame's own posts ----------------------------------------------------------

/** New quotes and replies in an hour, on one of dame's posts, worth a message. */
export const ALERT_THRESHOLD = Number(process.env.MOD_ALERT_THRESHOLD) || 15;
const ALERT_AGAIN_MS = 6 * 3_600_000;
const BASELINE_MS = 60 * 60_000;

/**
 * dame's recent posts that are suddenly drawing quotes and replies.
 *
 * Each post's count is kept with when it was taken. A count at least an hour
 * old becomes the new baseline; growth past the threshold since a baseline
 * under an hour old is an alert, at most once every six hours per post, and
 * never for a post already being watched.
 *
 * @returns {Promise<Array<{ uri: string, growth: number, count: number }>>}
 */
export async function ownPostAlerts({
  fetchImpl = fetch,
  now = Date.now(),
  threshold = ALERT_THRESHOLD,
} = {}) {
  const res = await fetchImpl(
    `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(ME_DID)}&limit=30&filter=posts_no_replies`,
  );
  if (!res.ok) return [];
  const body = await res.json();
  const recent = (body.feed || [])
    .map((f) => f.post)
    .filter(
      (p) =>
        p?.author?.did === ME_DID &&
        now - Date.parse(p.indexedAt || p.record?.createdAt || 0) <
          48 * 3_600_000,
    );
  if (!recent.length) return [];

  const uris = recent.map((p) => p.uri);
  const known = new Map(
    (
      (await select('post_alert', {
        select: 'uri,last_count,last_seen_at,alerted_at',
        where: { uri: `in.(${uris.map((u) => `"${u}"`).join(',')})` },
      }).catch(() => [])) || []
    ).map((r) => [r.uri, r]),
  );
  const watched = new Set((await liveWatches({ now })).map((w) => w.uri));

  const alerts = [];
  const writes = [];
  for (const p of recent) {
    const count = (p.quoteCount || 0) + (p.replyCount || 0);
    const row = known.get(p.uri);
    const age = row?.last_seen_at
      ? now - Date.parse(row.last_seen_at)
      : Infinity;
    if (!row || age >= BASELINE_MS) {
      writes.push({
        uri: p.uri,
        last_count: count,
        last_seen_at: new Date(now).toISOString(),
        alerted_at: row?.alerted_at ?? null,
      });
      continue;
    }
    const growth = count - (row.last_count || 0);
    const quietSince = row.alerted_at
      ? now - Date.parse(row.alerted_at) >= ALERT_AGAIN_MS
      : true;
    if (growth >= threshold && quietSince && !watched.has(p.uri)) {
      alerts.push({ uri: p.uri, growth, count });
      writes.push({
        uri: p.uri,
        last_count: row.last_count,
        last_seen_at: row.last_seen_at,
        alerted_at: new Date(now).toISOString(),
      });
    }
  }
  if (writes.length) await upsert('post_alert', writes).catch(() => {});
  return alerts;
}

/** The message for one alert, and what a 👍 does. */
export function alertText({ uri, growth }) {
  return {
    text: `Your post ${postWebUrl(uri) || uri} picked up ${growth} quotes and replies in the last hour.`,
    pending: [`watch ${uri}`],
    describe: 'watch it for 24 hours and hold anything hostile for your OK',
    links: [postWebUrl(uri)],
  };
}
