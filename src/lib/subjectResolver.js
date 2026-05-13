// Subject resolution for reference-style records.
//
// Records like `app.bsky.feed.like` carry a `subject.uri` (and, for likes,
// reposts, etc., a `subject.cid`). To render a useful preview in the home
// feed, we have to fetch the actual record being referenced. This module
// centralises that work and minimises the number of round-trips:
//
//   * Bluesky posts are resolved in batches of 25 via
//     `app.bsky.feed.getPosts` on the public AppView.
//   * Bluesky profiles are resolved in batches of 25 via
//     `app.bsky.actor.getProfiles`.
//   * Anything else (a Grain gallery, a Tangled repo, a Leaflet doc) goes
//     through the universal atproto path: parse the DID → resolve its PDS
//     via PLC → `com.atproto.repo.getRecord`.
//
// The module is isomorphic — it uses only `fetch` and the lightweight
// helpers in `atproto.js`, so both the build-time prefetch script (Node
// 18+) and the browser hooks can share it.
//
// A single `SubjectResolver` instance carries its own caches, which means
// the home page's live refresh can be invoked repeatedly without
// re-fetching records it has already resolved during the session, while a
// fresh prefetch run starts from a clean slate.

import { APPVIEW } from '../config.js';
import { resolvePds, getRecord } from './atproto.js';

const POSTS_BATCH = 25;
const PROFILES_BATCH = 25;
const CONCURRENCY = 8;

export function createSubjectResolver({ appview = APPVIEW, concurrency = CONCURRENCY, warn } = {}) {
  const postCache = new Map();
  const profileCache = new Map();
  const recordCache = new Map();
  const pdsCache = new Map();
  const log = warn || ((..._args) => {});

  async function resolveBskyPosts(uris) {
    const want = Array.from(new Set((uris || []).filter(Boolean))).filter(
      (u) => !postCache.has(u),
    );
    for (let i = 0; i < want.length; i += POSTS_BATCH) {
      const chunk = want.slice(i, i + POSTS_BATCH);
      try {
        const url = new URL(`${appview}/xrpc/app.bsky.feed.getPosts`);
        for (const u of chunk) url.searchParams.append('uris', u);
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`getPosts ${res.status}`);
        const json = await res.json();
        const found = new Map((json?.posts || []).map((p) => [p.uri, p]));
        for (const u of chunk) postCache.set(u, found.get(u) || null);
      } catch (err) {
        log('[subjectResolver] getPosts failed:', err?.message || err);
        for (const u of chunk) if (!postCache.has(u)) postCache.set(u, null);
      }
    }
    const out = new Map();
    for (const u of uris || []) out.set(u, postCache.get(u) ?? null);
    return out;
  }

  async function resolveBskyProfiles(dids) {
    const want = Array.from(new Set((dids || []).filter(Boolean))).filter(
      (d) => !profileCache.has(d),
    );
    for (let i = 0; i < want.length; i += PROFILES_BATCH) {
      const chunk = want.slice(i, i + PROFILES_BATCH);
      try {
        const url = new URL(`${appview}/xrpc/app.bsky.actor.getProfiles`);
        for (const a of chunk) url.searchParams.append('actors', a);
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`getProfiles ${res.status}`);
        const json = await res.json();
        const found = new Map((json?.profiles || []).map((p) => [p.did, p]));
        for (const d of chunk) profileCache.set(d, found.get(d) || null);
      } catch (err) {
        log('[subjectResolver] getProfiles failed:', err?.message || err);
        for (const d of chunk) if (!profileCache.has(d)) profileCache.set(d, null);
      }
    }
    const out = new Map();
    for (const d of dids || []) out.set(d, profileCache.get(d) ?? null);
    return out;
  }

  async function resolveAtUris(uris) {
    const want = Array.from(new Set((uris || []).filter(Boolean))).filter(
      (u) => !recordCache.has(u),
    );
    await runWithConcurrency(want, concurrency, async (uri) => {
      const parsed = parseAtUri(uri);
      if (!parsed) {
        recordCache.set(uri, null);
        return;
      }
      const { did, collection, rkey } = parsed;
      const pds = await resolvePdsCached(did);
      if (!pds) {
        recordCache.set(uri, null);
        return;
      }
      try {
        const rec = await getRecord(pds, { repo: did, collection, rkey });
        recordCache.set(uri, rec || null);
      } catch (err) {
        recordCache.set(uri, null);
      }
    });
    const out = new Map();
    for (const u of uris || []) out.set(u, recordCache.get(u) ?? null);
    return out;
  }

  async function resolvePdsCached(did) {
    if (pdsCache.has(did)) return pdsCache.get(did);
    try {
      const pds = await resolvePds(did);
      pdsCache.set(did, pds);
      return pds;
    } catch {
      pdsCache.set(did, null);
      return null;
    }
  }

  /**
   * Apply the relevant resolver(s) to a set of records and attach a
   * `_subject` field to each one. Mutates in place. Records whose subject
   * couldn't be resolved get `_subject = { missing: true, ref: <subjectRef> }`.
   *
   * @param {object[]} records  PDS listRecords output (each `{ uri, cid, value }`).
   * @param {object} collection registry collection config (provides `subject` tag).
   */
  async function hydrateSubjects(records, collection) {
    if (!records?.length) return;
    const subjectKind = collection?.subject;
    const refs = records.map((r) => extractSubjectRef(r, collection));

    if (subjectKind === 'bsky.post') {
      const uris = refs.map((r) => r?.uri).filter(Boolean);
      const map = await resolveBskyPosts(uris);
      refs.forEach((ref, i) => {
        const post = ref?.uri ? map.get(ref.uri) : null;
        records[i]._subject = post
          ? { kind: 'bsky.post', view: condensePostView(post), ref }
          : { kind: 'bsky.post', missing: true, ref };
      });
      return;
    }

    if (subjectKind === 'bsky.profile') {
      const dids = refs.map((r) => r?.did).filter(Boolean);
      const map = await resolveBskyProfiles(dids);
      refs.forEach((ref, i) => {
        const prof = ref?.did ? map.get(ref.did) : null;
        records[i]._subject = prof
          ? { kind: 'bsky.profile', view: condenseProfileView(prof), ref }
          : { kind: 'bsky.profile', missing: true, ref };
      });
      return;
    }

    if (subjectKind === 'atproto') {
      const uris = refs.map((r) => r?.uri).filter(Boolean);
      const map = await resolveAtUris(uris);
      refs.forEach((ref, i) => {
        const rec = ref?.uri ? map.get(ref.uri) : null;
        records[i]._subject = rec
          ? { kind: 'atproto', record: rec, ref }
          : { kind: 'atproto', missing: true, ref };
      });
    }
  }

  return {
    resolveBskyPosts,
    resolveBskyProfiles,
    resolveAtUris,
    hydrateSubjects,
  };
}

/**
 * Pull the subject reference out of a record. Tolerates the shapes used
 * by every reference lexicon in the registry:
 *   - bsky like / repost / vote: `subject = { uri, cid }`
 *   - bsky follow / grain follow / tangled follow: `subject = <did string>`
 *   - grain favorite, tangled star: `subject = { uri, cid }` (most likely)
 */
function extractSubjectRef(record /*, _collection */) {
  const v = record?.value || {};
  const subject = v.subject;
  if (!subject) return null;
  if (typeof subject === 'string') {
    if (subject.startsWith('did:')) return { did: subject };
    if (subject.startsWith('at://')) {
      const m = subject.match(/^at:\/\/([^/]+)/);
      return { uri: subject, did: m ? m[1] : null };
    }
    return null;
  }
  if (typeof subject === 'object') {
    if (subject.uri) {
      const m = String(subject.uri).match(/^at:\/\/([^/]+)/);
      return { uri: subject.uri, cid: subject.cid || null, did: m ? m[1] : null };
    }
    if (subject.did) return { did: subject.did };
  }
  return null;
}

function condensePostView(post) {
  if (!post?.uri) return null;
  return {
    $type: 'app.bsky.feed.defs#postView',
    uri: post.uri,
    cid: post.cid || null,
    indexedAt: post.indexedAt || null,
    author: post.author
      ? {
          did: post.author.did,
          handle: post.author.handle,
          displayName: post.author.displayName,
          avatar: post.author.avatar,
        }
      : null,
    record: post.record
      ? {
          text: post.record.text || '',
          createdAt: post.record.createdAt || null,
          facets: post.record.facets || null,
          embed: post.record.embed || null,
        }
      : null,
    embed: post.embed || null,
    replyCount: post.replyCount || 0,
    repostCount: post.repostCount || 0,
    likeCount: post.likeCount || 0,
  };
}

function condenseProfileView(profile) {
  if (!profile?.did) return null;
  return {
    did: profile.did,
    handle: profile.handle,
    displayName: profile.displayName || null,
    avatar: profile.avatar || null,
    description: profile.description || null,
    followersCount: profile.followersCount || 0,
    followsCount: profile.followsCount || 0,
    postsCount: profile.postsCount || 0,
  };
}

function parseAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  return { did: m[1], collection: m[2], rkey: m[3] };
}

async function runWithConcurrency(items, limit, worker) {
  if (!items.length) return;
  const queue = items.slice();
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch (err) {
        // Swallow per-item failures so a single bad URI doesn't sink the run.
        // Caller already sees the resulting `null` cache entry.
      }
    }
  });
  await Promise.all(runners);
}

/**
 * Module-level convenience matching the legacy
 * `scripts/lib/resolveSubject.mjs` API. Uses a process-global resolver
 * with shared caches so the build-time prefetch script's behaviour stays
 * identical (one cache per `node` invocation).
 */
const sharedResolver = createSubjectResolver({
  warn: (...args) => console.warn(...args),
});

export const resolveBskyPosts = sharedResolver.resolveBskyPosts;
export const resolveBskyProfiles = sharedResolver.resolveBskyProfiles;
export const resolveAtUris = sharedResolver.resolveAtUris;
export const hydrateSubjects = sharedResolver.hydrateSubjects;
