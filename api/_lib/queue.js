// The review queue: everyone on the list who needs a person to look at them.
//
// TWO SOURCES, one queue, because they are one question -- "should this
// account still be blocked?" -- asked for two different reasons:
//
//   - The audit. The droplet re-scores the whole list every week, and anyone
//     who is no longer a stranger (CONNECTED, PERIPHERAL, NOTABLE, or worse,
//     PROTECTED) is somebody a sweep may have caught by accident.
//   - Disputed labels. Accounts added because triage read them as hostile,
//     whose post both second-wave readers now read as something else.
//
// DECISIONS OUTLIVE AUDITS. They used to be written on audit_item rows, which
// belong to one weekly run, so every run put back every account already
// decided on -- 565 open items and nobody had ever decided one. They live in
// mod.review now, one row per account. A KEEP holds until the account's band
// gets more severe than it was when kept, which is the one thing that makes a
// second look worth asking for. A REMOVE holds until the next audit, which will
// not see the account at all if the removal stuck.
//
// REMOVAL IS ONE LOOKUP, NOT A SCAN. Finding a listitem's record key used to
// mean paging the bot's whole repo, about 90 requests for 9,000 members, per
// removal. Constellation answers "which listitem on this list points at this
// account" in one request, under 100ms. The scan is kept as the fallback for
// the day Constellation lags or is down.

import { APPVIEW } from '../../src/config.js';
import { getManyToMany } from '../../src/lib/constellation.js';
import { select, selectAll, upsert, del } from './modDb.js';
import { listUri } from './listWrite.js';

/**
 * A plan's short code. The same one-liner bulkPlan.js exports, written out
 * here so the hub's functions do not import the plan module, and through it
 * triage and the whole AI SDK, to format eight characters.
 */
export const shortCode = (uuid) =>
  String(uuid ?? '')
    .replace(/-/g, '')
    .slice(0, 8);

/** How severe a band is, for "has this account got worse since it was kept". */
export const RANK = {
  PROTECTED: 4,
  CONNECTED: 3,
  PERIPHERAL: 2,
  NOTABLE: 1,
  UNKNOWN: 0,
};

/**
 * Why an account is in the queue, most urgent first. PROTECTED should never be
 * on the list at all. CONNECTED is the sweep's blast radius. A disputed label
 * is somebody blocked on a reading two models now disagree with.
 */
export const REASONS = [
  'PROTECTED',
  'CONNECTED',
  'disputed',
  'PERIPHERAL',
  'NOTABLE',
];
const PRIORITY = Object.fromEntries(REASONS.map((r, i) => [r, i]));

const ownerOf = (uri) => /^at:\/\/(did:[^/]+)\//.exec(String(uri ?? ''))?.[1];

/** The most recent audit of this list that actually scored something. */
export async function latestAudit(list = listUri()) {
  const rows = await select('audit', {
    select: 'id,list_uri,started_at,finished_at,total,scored',
    eq: { list_uri: list },
    where: { finished_at: 'not.is.null', total: 'gt.0' },
    order: 'started_at.desc',
    limit: 1,
  });
  return rows?.[0] ?? null;
}

/**
 * The listitem record keys for one account on one list, from Constellation.
 * Null when Constellation could not answer, which is different from "none".
 *
 * FILTERED TO THIS LIST, not read from the first page of everything. The first
 * version asked for all of an account's list memberships and looked for ours
 * in the first hundred, and a well-known account is on hundreds of lists. The
 * five most connected accounts in the queue came back "not on the list" while
 * the bot's repo held all five -- exactly the accounts the queue exists for.
 * Asking for links to this one list returns one row, or none.
 */
export async function listitemRkeys(list, did, { maxPages = 5 } = {}) {
  const owner = ownerOf(list);
  const rkeys = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await getManyToMany(
      did,
      'app.bsky.graph.listitem:subject',
      'list',
      {
        limit: 100,
        otherSubject: list,
        cursor,
      },
    );
    if (!res) return null;
    for (const i of res.items || []) {
      if (
        i?.linkRecord?.did === owner &&
        i?.linkRecord?.collection === 'app.bsky.graph.listitem' &&
        i?.otherSubject === list
      ) {
        rkeys.push(i.linkRecord.rkey);
      }
    }
    cursor = res.cursor;
    if (!cursor) return rkeys;
  }
  // Still more pages: whatever is true, it is not "none". The caller treats
  // null as unknown and falls back to reading the repo.
  return rkeys.length ? rkeys : null;
}

/** The slow way: page the owner's repo. Only when Constellation cannot say. */
async function scanRkeys(agent, list, did) {
  const owner = ownerOf(list);
  const out = [];
  let cursor;
  for (let page = 0; page < 200; page += 1) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: owner,
      collection: 'app.bsky.graph.listitem',
      limit: 100,
      cursor,
    });
    for (const rec of res.data.records || []) {
      if (rec.value?.list === list && rec.value?.subject === did) {
        out.push(rec.uri.split('/').pop());
      }
    }
    cursor = res.data.cursor;
    if (!cursor || !(res.data.records || []).length) break;
  }
  return out;
}

/**
 * Take one account off the list, and close every decision that put them on.
 *
 * The decision rows are stamped undone rather than deleted, as everywhere else:
 * "was I ever on this list" stays answerable.
 */
export async function removeMember(
  agent,
  did,
  { list = listUri(), reason } = {},
) {
  const owner = ownerOf(list);
  if (agent.session?.did !== owner) {
    throw new Error(`the moderator account does not own ${list}`);
  }
  let rkeys = await listitemRkeys(list, did);
  if (rkeys === null) rkeys = await scanRkeys(agent, list, did);
  if (!rkeys.length) return { ok: true, removed: 0, notOnList: true };

  let removed = 0;
  for (const rkey of rkeys) {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: owner,
        collection: 'app.bsky.graph.listitem',
        rkey,
      });
      removed += 1;
    } catch (err) {
      // Constellation can lag a deletion by a moment. A record that is already
      // gone is the outcome being asked for, not a failure.
      if (!/not ?found|could not locate/i.test(String(err?.message || err))) {
        throw err;
      }
    }
  }

  const now = new Date().toISOString();
  const live = await selectAll('decision', {
    select: 'plan_id,did,band,action,acted_at',
    eq: { did, action: 'list_add' },
    where: { acted_at: 'not.is.null', undone_at: 'is.null' },
    order: 'plan_id.asc',
  });
  if (live.length) {
    await upsert(
      'decision',
      live.map((r) => ({
        plan_id: r.plan_id,
        did,
        band: r.band,
        action: 'list_add',
        acted_at: r.acted_at,
        undone_at: now,
        undo_reason: reason || 'removed from the moderation queue',
      })),
    );
  }
  return { ok: true, removed };
}

/** Profiles for up to 25 DIDs at a time, from the public AppView. */
export async function profilesFor(dids, { fetchImpl = fetch } = {}) {
  const out = new Map();
  const unique = [...new Set(dids.filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < unique.length; i += 25)
    chunks.push(unique.slice(i, i + 25));
  await Promise.all(
    chunks.map(async (chunk) => {
      const q = chunk.map((d) => `actors=${encodeURIComponent(d)}`).join('&');
      try {
        const res = await fetchImpl(
          `${APPVIEW}/xrpc/app.bsky.actor.getProfiles?${q}`,
        );
        if (!res.ok) return;
        const body = await res.json();
        for (const p of body?.profiles || []) out.set(p.did, profileCard(p));
      } catch {
        // A profile we cannot fetch still has a DID and the reason it is here.
      }
    }),
  );
  return out;
}

/** The part of a profile a review card shows. */
export function profileCard(p) {
  return {
    did: p.did,
    handle: p.handle ?? null,
    displayName: p.displayName || null,
    avatar: p.avatar ?? null,
    description: p.description ? String(p.description).slice(0, 280) : null,
    followers: p.followersCount ?? null,
    posts: p.postsCount ?? null,
    createdAt: p.createdAt ?? null,
  };
}

/**
 * Every open item, merged, filtered and sorted. Rows only; profiles are added
 * to the one page that is shown, not to all six hundred.
 */
export async function openItems({ list = listUri() } = {}) {
  const audit = await latestAudit(list);
  const [auditRows, disputedRows, reviews] = await Promise.all([
    audit
      ? selectAll('audit_item', {
          select: 'did,handle,band,trust,vouches,followers,protected_reason',
          eq: { audit_id: audit.id },
          // Not filtered on audit_item.decision: decisions live in mod.review,
          // and one place deciding what is open beats two that can disagree.
          where: { band: 'neq.UNKNOWN' },
          order: 'trust.desc,did.asc',
        })
      : [],
    selectAll('decision', {
      select:
        'plan_id,did,band,trust,vouches,triage,triage_quote,triage_model,triage_at,acted_at',
      where: {
        approved_via: 'like.*triage:hostile*',
        triage: 'in.(arguing,neutral)',
        acted_at: 'not.is.null',
        undone_at: 'is.null',
      },
      order: 'plan_id.asc,did.asc',
    }),
    selectAll('review', {
      select: 'did,decision,reason,band,decided_at',
      order: 'did.asc',
    }),
  ]);

  const byDid = new Map();
  for (const d of disputedRows) {
    byDid.set(d.did, {
      did: d.did,
      reasons: ['disputed'],
      band: d.band,
      trust: d.trust ?? 0,
      vouches: d.vouches ?? null,
      followers: null,
      label: d.triage,
      quote: d.triage_quote,
      readBy: d.triage_model,
      plan: shortCode(d.plan_id),
      addedAt: d.acted_at,
      handle: null,
    });
  }
  for (const a of auditRows) {
    const reason = a.protected_reason ? 'PROTECTED' : a.band;
    const item = byDid.get(a.did) || {
      did: a.did,
      reasons: [],
      trust: 0,
      handle: null,
    };
    item.reasons = [reason, ...item.reasons.filter((r) => r !== reason)];
    item.band = a.band;
    item.trust = a.trust ?? item.trust;
    item.vouches = a.vouches ?? item.vouches ?? null;
    item.followers = a.followers ?? null;
    item.protectedReason = a.protected_reason ?? null;
    item.handle = a.handle ?? item.handle;
    byDid.set(a.did, item);
  }

  const review = new Map(reviews.map((r) => [r.did, r]));
  const auditStarted = audit ? Date.parse(audit.started_at) : 0;
  const open = [];
  for (const item of byDid.values()) {
    const r = review.get(item.did);
    if (
      r?.decision === 'keep' &&
      (RANK[r.band] ?? 0) >= (RANK[item.band] ?? 0)
    ) {
      continue;
    }
    // A removal holds until an audit newer than it: that audit will not see
    // the account at all if the removal stuck, and will if it did not.
    if (r?.decision === 'remove' && Date.parse(r.decided_at) > auditStarted) {
      continue;
    }
    item.reason = item.reasons.reduce((best, x) =>
      (PRIORITY[x] ?? 9) < (PRIORITY[best] ?? 9) ? x : best,
    );
    open.push(item);
  }
  open.sort(
    (a, b) =>
      (PRIORITY[a.reason] ?? 9) - (PRIORITY[b.reason] ?? 9) ||
      (b.trust ?? 0) - (a.trust ?? 0) ||
      a.did.localeCompare(b.did),
  );

  const counts = Object.fromEntries(REASONS.map((r) => [r, 0]));
  for (const item of open) counts[item.reason] = (counts[item.reason] || 0) + 1;
  const decided = {
    keep: reviews.filter((r) => r.decision === 'keep').length,
    remove: reviews.filter((r) => r.decision === 'remove').length,
  };
  return { audit, open, counts, total: open.length, decided };
}

/**
 * One page of the queue, with profiles, and with anyone no longer on the list
 * dropped and recorded so they stop coming back.
 */
export async function queuePage({
  reason = 'all',
  offset = 0,
  limit = 20,
  list = listUri(),
} = {}) {
  const { audit, open, counts, total, decided } = await openItems({ list });
  const wanted =
    reason && reason !== 'all' ? open.filter((i) => i.reason === reason) : open;
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  const slice = wanted.slice(start, start + size);

  const [profiles, membership] = await Promise.all([
    profilesFor(slice.map((i) => i.did)),
    Promise.all(slice.map((i) => listitemRkeys(list, i.did).catch(() => null))),
  ]);

  const gone = [];
  const items = [];
  slice.forEach((item, n) => {
    const rkeys = membership[n];
    // Null is "Constellation could not say", which is not "not on the list".
    if (Array.isArray(rkeys) && !rkeys.length) {
      gone.push(item);
      return;
    }
    const p = profiles.get(item.did);
    items.push({
      ...item,
      handle: p?.handle ?? item.handle ?? null,
      profile: p ?? null,
    });
  });
  if (gone.length) {
    const now = new Date().toISOString();
    await upsert(
      'review',
      gone.map((g) => ({
        did: g.did,
        decision: 'remove',
        reason: g.reason,
        band: g.band ?? null,
        decided_at: now,
        note: 'already off the list',
      })),
    ).catch(() => {});
  }

  return {
    audit: audit
      ? {
          id: audit.id,
          at: audit.finished_at || audit.started_at,
          total: audit.total,
        }
      : null,
    counts,
    total,
    matched: wanted.length - gone.length,
    offset: start,
    limit: size,
    decided,
    items,
    skipped: gone.length,
  };
}

/**
 * Keep, remove, restore (undo a removal) or reopen (undo a keep).
 *
 * @param {object} agent  the moderator session, for remove and restore
 * @param {object} input
 * @param {Function} [deps.addToList]  applyCommand, injected so the PROTECTED
 *   veto applies to a restore exactly as it does to every other add
 */
export async function decide(agent, input, { addToList } = {}) {
  const { did, decision, reason = 'review', band = null } = input || {};
  const list = input?.list || listUri();
  if (!did || !/^did:[a-z]+:/.test(did)) throw new Error('pass a did');
  const now = new Date().toISOString();
  const row = (d, note = null) => ({
    did,
    decision: d,
    reason,
    band,
    decided_at: now,
    note,
  });

  if (decision === 'keep') {
    await upsert('review', [row('keep', input.note || null)]);
    return { ok: true, decision: 'keep' };
  }
  if (decision === 'reopen') {
    await del('review', { eq: { did } });
    return { ok: true, decision: 'reopen' };
  }
  if (decision === 'remove') {
    const out = await removeMember(agent, did, { list });
    await upsert('review', [
      row('remove', out.notOnList ? 'already off the list' : null),
    ]);
    return { ...out, decision: 'remove' };
  }
  if (decision === 'restore') {
    if (!addToList) throw new Error('restore needs addToList');
    const out = await addToList(agent, 'list_add', did, {
      raw: 'restored from the moderation queue',
      via: 'portal',
    });
    if (out.ok)
      await upsert('review', [row('keep', 'restored after a removal')]);
    return { ...out, decision: 'restore' };
  }
  throw new Error(`unknown decision ${decision}`);
}
