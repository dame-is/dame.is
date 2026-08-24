// The Analytics studio's network sweeps — the code that walks paginated APIs
// and hands compact rows back for the archive. Pure fetch loops: no React, no
// IndexedDB. The studio orchestrates (and persists) what these gather.
//
// Where each fact comes from, and why:
//
//   followers   app.bsky.graph.getFollowers through the OWNER'S OAUTH AGENT.
//               Auth is the point: only an authenticated call carries
//               `viewer.followedBy` — the at-uri of each follower's own
//               follow record — and that record's rkey is a TID, so the key
//               alone dates the follow. There is no history API for follower
//               counts; this reconstruction from present followers is the
//               honest substitute, and its known blind spot (people who
//               unfollowed or deleted are invisible) is stated in the UI.
//
//   posts       app.bsky.feed.getAuthorFeed on the PUBLIC AppView. Public
//               data through the public host, exactly like the rest of
//               src/lib — and the sweep is ~250 pages for this account, a
//               load the PDS proxy shouldn't carry. Carries engagement
//               counts (likes/reposts/replies/quotes) the raw repo doesn't.
//
//   inbound     app.bsky.notification.listNotifications through the agent
//               (owner-only data). Who liked/reposted/replied/quoted/
//               mentioned, with a timestamp — the only per-actor inbound
//               record there is. Retention is the AppView's, not ours, so
//               each sweep banks events into the archive and coverage GROWS
//               from first sync onward.
//
//   outbound    the owner's own app.bsky.feed.like / repost records via
//               listRecords on the PDS (newest-first; verified against the
//               live PDS — descending rkey, cursor pages backward). Replies
//               and quotes need no sweep at all: the post archive already
//               knows their targets.
//
// Every sweep is resumable and abort-aware. Pages are handed to `onPage` as
// they land so the caller can persist incrementally — a sweep that dies at
// page 200 has still banked 200 pages — and the return says honestly whether
// the sweep completed, was aborted, or failed partway (with the cursor to
// resume from where that is meaningful).

import { APPVIEW } from '../config.js';
import { rkeyFromAtUri, tidToTimestamp, resolveProfiles } from './atproto.js';
import { compactPostFromFeedItem, inboundFromNotification, outboundFromRecord } from './analytics.js';

/** Page size everywhere — the API maximum for all four endpoints. */
const PAGE = 100;

/**
 * Hard page caps, so no sweep can run unbounded against a surprise (an
 * account with 80k followers, a notification firehose). Each is far above
 * this account's measured size; hitting one sets `truncated` rather than
 * lying by omission.
 */
const CAPS = { followers: 200, posts: 500, inbound: 80, outboundPerKind: 120 };

/** One polite second ask, then the truth. Mirrors resolveProfiles' retry. */
async function withRetry(fn, signal) {
  try {
    return await fn();
  } catch (err) {
    if (signal?.aborted) throw err;
    await new Promise((r) => setTimeout(r, 800));
    return fn();
  }
}

const aborted = (signal) => Boolean(signal?.aborted);

/* ------------------------------------------------------------------ */
/* Followers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Sweep every current follower. Always a full sweep: an incremental one
 * cannot see unfollows, so topping up would only ever let the list grow
 * stale in the one direction nobody notices.
 *
 * @returns {Promise<{followers:Array, complete:boolean, aborted:boolean, error:string|null}>}
 */
export async function sweepFollowers(agent, did, { onProgress, signal } = {}) {
  const followers = [];
  let cursor;
  let error = null;
  let complete = false;
  for (let page = 0; page < CAPS.followers; page++) {
    if (aborted(signal)) return { followers, complete: false, aborted: true, error: null };
    let res;
    try {
      res = await withRetry(
        () => agent.app.bsky.graph.getFollowers({ actor: did, limit: PAGE, cursor }),
        signal,
      );
    } catch (err) {
      error = err?.message || String(err);
      break;
    }
    const batch = res?.data?.followers || [];
    for (const f of batch) {
      if (!f?.did) continue;
      followers.push({
        did: f.did,
        handle: f.handle || '',
        displayName: f.displayName || '',
        avatar: f.avatar || '',
        // Their follow record's TID. Null for the rare non-TID rkey — the
        // account still counts toward the total, just not toward the curve.
        followedAt: tidToTimestamp(rkeyFromAtUri(f.viewer?.followedBy)),
      });
    }
    onProgress?.({ fetched: followers.length });
    cursor = res?.data?.cursor;
    if (!cursor || batch.length === 0) {
      complete = true;
      break;
    }
  }
  return { followers, complete, aborted: false, error };
}

/* ------------------------------------------------------------------ */
/* Posts                                                                */
/* ------------------------------------------------------------------ */

/**
 * Sweep the author feed into compact archive rows, newest first.
 *
 * Two modes fall out of the parameters rather than a flag:
 *
 *   full         knownUris empty (or rehydrateSinceMs = Infinity): pages to
 *                exhaustion. ~250 pages here — the one expensive sweep, run
 *                once and checkpointed via `resumeCursor` so an interruption
 *                resumes instead of restarting.
 *   incremental  stops at the first page where every item is already known
 *                AND already older than `rehydrateSinceMs`. Known-but-recent
 *                rows are re-emitted on purpose: engagement keeps landing on
 *                recent posts after they're archived, so the recent window
 *                gets its counts refreshed on every sync.
 *
 * @returns {Promise<{fetched:number, complete:boolean, aborted:boolean,
 *                    cursor:string|null, error:string|null}>}
 */
export async function sweepPosts({
  did,
  knownUris = null,
  rehydrateSinceMs = Infinity,
  resumeCursor = null,
  onPage,
  onProgress,
  signal,
} = {}) {
  let cursor = resumeCursor || null;
  let fetched = 0;
  for (let page = 0; page < CAPS.posts; page++) {
    if (aborted(signal)) return { fetched, complete: false, aborted: true, cursor, error: null };
    const params = new URLSearchParams({
      actor: did,
      limit: String(PAGE),
      filter: 'posts_with_replies',
    });
    if (cursor) params.set('cursor', cursor);
    let res;
    try {
      res = await withRetry(async () => {
        const r = await fetch(`${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?${params}`, { signal });
        if (!r.ok) throw new Error(`HTTP ${r.status} from getAuthorFeed`);
        return r.json();
      }, signal);
    } catch (err) {
      if (aborted(signal)) return { fetched, complete: false, aborted: true, cursor, error: null };
      return { fetched, complete: false, aborted: false, cursor, error: err?.message || String(err) };
    }

    const feed = res?.feed || [];
    const rows = [];
    // "Nothing new here" must only consider the owner's own posts: a repost
    // resurfacing an ancient post of someone else lands mid-feed and would
    // otherwise read as an unknown item, un-stopping every incremental sweep.
    let sawNew = false;
    let oldestOwnMs = Infinity;
    for (const item of feed) {
      const row = compactPostFromFeedItem(item);
      if (!row) continue;
      rows.push(row);
      const at = Date.parse(row.at);
      if (Number.isFinite(at) && at < oldestOwnMs) oldestOwnMs = at;
      if (!knownUris?.has(row.uri)) sawNew = true;
    }
    fetched += rows.length;
    if (rows.length) await onPage?.(rows);
    onProgress?.({ fetched });

    const done =
      !res?.cursor ||
      feed.length === 0 ||
      (!sawNew && rows.length > 0 && oldestOwnMs < rehydrateSinceMs);
    if (done) return { fetched, complete: true, aborted: false, cursor: null, error: null };
    cursor = res.cursor;
  }
  // Cap reached — everything gathered is real, but the sweep isn't finished.
  return { fetched, complete: false, aborted: false, cursor, error: null };
}

/* ------------------------------------------------------------------ */
/* Inbound engagement (notifications)                                   */
/* ------------------------------------------------------------------ */

/**
 * Sweep notifications back to `cutoffMs`, banking engagement events.
 *
 * `coveredToMs` is how deep a PREVIOUS sweep already reached: a page of
 * already-known events only ends the sweep when this sweep isn't being asked
 * to dig deeper than any before it — otherwise known events are pages we
 * page THROUGH on the way down to the new cutoff.
 *
 * `reachedMs` in the result is the oldest event time seen (known or new) —
 * with the previous coverage, the studio's honest "coverage since" caption.
 *
 * @returns {Promise<{events:Array, fetched:number, reachedMs:number|null,
 *                    complete:boolean, truncated:boolean, aborted:boolean, error:string|null}>}
 */
export async function sweepInbound(
  agent,
  { cutoffMs, knownUris = null, coveredToMs = null, onPage, onProgress, signal } = {},
) {
  const events = [];
  let cursor;
  let reachedMs = null;
  const covered = coveredToMs != null && coveredToMs <= cutoffMs;
  for (let page = 0; page < CAPS.inbound; page++) {
    if (aborted(signal)) return result({ aborted: true });
    let res;
    try {
      res = await withRetry(
        () => agent.app.bsky.notification.listNotifications({ limit: PAGE, cursor }),
        signal,
      );
    } catch (err) {
      return result({ error: err?.message || String(err) });
    }
    const batch = res?.data?.notifications || [];
    const rows = [];
    let sawNew = false;
    let pageOldest = Infinity;
    for (const n of batch) {
      // The STOP test reads indexedAt on every notification, engagement or
      // not: it is the feed's own position, so a page of old follows still
      // ends the walk, and a backdated createdAt cannot end it early.
      const idx = Date.parse(n?.indexedAt || '');
      if (Number.isFinite(idx) && idx < pageOldest) pageOldest = idx;
      const ev = inboundFromNotification(n);
      if (!ev) continue;
      const at = Date.parse(ev.at);
      if (Number.isFinite(at) && (reachedMs == null || at < reachedMs)) reachedMs = at;
      if (!Number.isFinite(at) || at < cutoffMs) continue; // older than asked for — not banked
      if (!knownUris?.has(ev.uri)) sawNew = true;
      rows.push(ev);
    }
    events.push(...rows);
    if (rows.length) await onPage?.(rows);
    onProgress?.({ fetched: events.length });

    if (!res?.data?.cursor || batch.length === 0) return result({ complete: true });
    if (pageOldest < cutoffMs) return result({ complete: true });
    if (!sawNew && rows.length > 0 && covered) return result({ complete: true });
    cursor = res.data.cursor;
  }
  return result({ truncated: true });

  function result(flags = {}) {
    return {
      events,
      fetched: events.length,
      reachedMs,
      complete: false,
      truncated: false,
      aborted: false,
      error: null,
      ...flags,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Outbound engagement (own likes + reposts)                            */
/* ------------------------------------------------------------------ */

const OUTBOUND_COLLECTIONS = [
  { collection: 'app.bsky.feed.like', kind: 'like' },
  { collection: 'app.bsky.feed.repost', kind: 'repost' },
];

/**
 * Sweep the owner's like and repost records back to `cutoffMs`. Same
 * coverage contract as sweepInbound. Records are dated by their own
 * createdAt (outboundFromRecord), but the STOP test reads the rkey TID —
 * the feed pages in rkey order, so a backdated createdAt must not end the
 * sweep early.
 */
export async function sweepOutbound(
  agent,
  did,
  { cutoffMs, knownUris = null, coveredToMs = null, onPage, onProgress, signal } = {},
) {
  const events = [];
  let reachedMs = null;
  let error = null;
  let truncated = false;
  let complete = true;
  const covered = coveredToMs != null && coveredToMs <= cutoffMs;

  for (const { collection, kind } of OUTBOUND_COLLECTIONS) {
    let cursor;
    let finished = false;
    for (let page = 0; page < CAPS.outboundPerKind; page++) {
      if (aborted(signal)) {
        return { events, fetched: events.length, reachedMs, complete: false, truncated, aborted: true, error };
      }
      let res;
      try {
        res = await withRetry(
          () => agent.com.atproto.repo.listRecords({ repo: did, collection, limit: PAGE, cursor }),
          signal,
        );
      } catch (err) {
        // A missing collection is an empty archive, not a failure — a repo
        // that has never reposted 400s here on some PDS implementations.
        if (/could not locate|not found/i.test(err?.message || '')) {
          finished = true;
          break;
        }
        error = err?.message || String(err);
        break;
      }
      const batch = res?.data?.records || [];
      const rows = [];
      let sawNew = false;
      let pageOldestTid = Infinity;
      for (const record of batch) {
        const tid = Date.parse(tidToTimestamp(rkeyFromAtUri(record?.uri)) || '');
        if (Number.isFinite(tid) && tid < pageOldestTid) pageOldestTid = tid;
        const ev = outboundFromRecord(kind, record);
        if (!ev) continue;
        const at = Date.parse(ev.at);
        if (Number.isFinite(at) && (reachedMs == null || at < reachedMs)) reachedMs = at;
        if (Number.isFinite(at) && at < cutoffMs) continue;
        if (!knownUris?.has(ev.uri)) sawNew = true;
        rows.push(ev);
      }
      events.push(...rows);
      if (rows.length) await onPage?.(rows);
      onProgress?.({ fetched: events.length });

      if (!res?.data?.cursor || batch.length === 0) {
        finished = true;
        break;
      }
      if (pageOldestTid < cutoffMs) {
        finished = true;
        break;
      }
      if (!sawNew && rows.length > 0 && covered) {
        finished = true;
        break;
      }
      cursor = res.data.cursor;
    }
    if (!finished) {
      if (error) break;
      truncated = true;
    }
    complete = complete && finished;
  }
  return { events, fetched: events.length, reachedMs, complete, truncated, aborted: false, error };
}

/* ------------------------------------------------------------------ */
/* Atmosphere — the whole repo, not just Bluesky                        */
/* ------------------------------------------------------------------ */

/** Per-collection page caps for the atmosphere scan. */
const ATMOSPHERE_TID_PAGES = 30; // a TID-keyed collection pages back in time
const ATMOSPHERE_PLAIN_PAGES = 3; // a name-keyed one has no time order to chase

/**
 * Scan EVERY collection on the repo — is.dame.*, teal plays, arena channels,
 * the Bluesky graph records, all of it — and count records created inside
 * the window. This is the "atmosphere" half of the studio: the PDS is the
 * database of the whole site, and this is its pulse.
 *
 * Records are dated by rkey TID first (minted at creation, immune to a
 * backdated createdAt) and createdAt second. Collections keyed by TIDs page
 * newest-first, so each stops as soon as a page has fallen wholly past the
 * cutoff; a collection keyed by names (is.dame.page, singletons) has no time
 * order to chase, so it gets a few pages and whatever dates they hold. A
 * collection that hits its cap is flagged `truncated` and its count rendered
 * as a floor — never a bare number that undercounts silently.
 *
 * @returns {Promise<{collections:Array<{collection:string, times:number[],
 *                    count:number, truncated:boolean}>, aborted:boolean, error:string|null}>}
 */
export async function sweepAtmosphere(agent, did, { cutoffMs, onProgress, signal } = {}) {
  let names = [];
  try {
    const desc = await withRetry(() => agent.com.atproto.repo.describeRepo({ repo: did }), signal);
    names = desc?.data?.collections || [];
  } catch (err) {
    return { collections: [], aborted: false, error: err?.message || String(err) };
  }

  const collections = [];
  for (let i = 0; i < names.length; i++) {
    const collection = names[i];
    if (aborted(signal)) return { collections, aborted: true, error: null };
    onProgress?.({ scanned: i, total: names.length, collection });

    const times = [];
    let cursor;
    let truncated = false;
    let tidKeyed = true; // assume time-ordered until a page proves otherwise
    for (let page = 0; page < (tidKeyed ? ATMOSPHERE_TID_PAGES : ATMOSPHERE_PLAIN_PAGES); page++) {
      if (aborted(signal)) return { collections, aborted: true, error: null };
      let res;
      try {
        res = await withRetry(
          () => agent.com.atproto.repo.listRecords({ repo: did, collection, limit: PAGE, cursor }),
          signal,
        );
      } catch {
        break; // one unreadable collection must not sink the scan
      }
      const batch = res?.data?.records || [];
      let pageOldest = Infinity;
      let tids = 0;
      for (const record of batch) {
        const fromTid = tidToTimestamp(rkeyFromAtUri(record?.uri));
        if (fromTid) tids++;
        const at = Date.parse(fromTid || record?.value?.createdAt || '');
        if (!Number.isFinite(at)) continue;
        if (at < pageOldest) pageOldest = at;
        if (at >= cutoffMs) times.push(at);
      }
      tidKeyed = tids >= batch.length / 2;
      if (!res?.data?.cursor || batch.length === 0) break;
      if (tidKeyed && pageOldest < cutoffMs) break;
      cursor = res.data.cursor;
      if (page === (tidKeyed ? ATMOSPHERE_TID_PAGES : ATMOSPHERE_PLAIN_PAGES) - 1) truncated = true;
    }
    collections.push({ collection, times, count: times.length, truncated });
  }
  onProgress?.({ scanned: names.length, total: names.length, collection: null });
  return { collections, aborted: false, error: null };
}

/* ------------------------------------------------------------------ */
/* Actor cards                                                          */
/* ------------------------------------------------------------------ */

/** Actor cards older than this get re-resolved — handles and avatars drift. */
const ACTOR_TTL_MS = 7 * 86_400_000;

/**
 * Make sure an actor card exists (and is reasonably fresh) for each DID.
 * Resolution goes through resolveProfiles — public AppView, chunked, its own
 * retry — and unresolved DIDs are simply absent, exactly as that helper
 * leaves them: a deactivated account renders as its DID, never invented.
 *
 * @param {Array<string>} dids
 * @param {Map<string,object>} cache  did → card, mutated in place.
 * @returns {Promise<Array<object>>} Only the newly resolved cards (for persisting).
 */
export async function hydrateActors(dids, cache) {
  const now = Date.now();
  const missing = Array.from(new Set(dids || [])).filter((did) => {
    const hit = cache.get(did);
    return !hit || !hit.handle || now - (hit.at || 0) > ACTOR_TTL_MS;
  });
  if (missing.length === 0) return [];
  const profiles = await resolveProfiles(missing);
  const fresh = [];
  for (const [did, p] of Object.entries(profiles)) {
    const card = { did, handle: p.handle, displayName: p.displayName, avatar: p.avatar, at: now };
    cache.set(did, card);
    fresh.push(card);
  }
  return fresh;
}
