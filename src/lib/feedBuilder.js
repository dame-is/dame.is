// Shared, isomorphic builder for the unified home feed.
//
// Both the build-time prefetch script (`scripts/prefetch.mjs`) and the
// browser's home-page hook import this module. Keeping the shaping +
// orchestration logic in one place is the difference between "the home
// page is whatever the last build saw" and "the home page reflects the
// PDS as of right now". Records authored after the most recent build now
// fan out through the same code path, just driven by `fetch` in the user's
// browser instead of a Node process.
//
// The orchestrator is `buildUnifiedFeed`; everything below it is a small
// pure function that the prefetch script calls when it needs to write a
// per-collection JSON snapshot or a combined per-verb file.

import {
  ME_DID,
  APPVIEW,
  COLLECTIONS,
  INATURALIST_USER,
  MOTHING_OBSERVATION_NSID,
  OBSERVING_OBSERVATION_NSID,
} from '../config.js';
import {
  getAuthorFeed,
  listRecords,
} from './atproto.js';
import { VERB_REGISTRY } from './verbRegistry.js';
import { isPortfolioDoc } from './publications.js';
import { createSubjectResolver } from './subjectResolver.js';
import { fetchLiveObservationItems } from './liveObservations.js';
import { compareIsoDesc } from './time.js';

/**
 * Maps registry NSIDs to the legacy snapshot file names that the rest of
 * the codebase still reads (`fetchSnapshot('now')`, etc.). NSIDs without
 * an entry get `<nsid-with-dashes>` filenames instead.
 */
export const LEGACY_SNAPSHOT_NAME = {
  'is.dame.now': 'now',
  // The blog now lives on standard.site; its documents take the legacy
  // `blogs.json` slot so existing consumers (Blogging, BlogPost, useAtUri)
  // keep reading the same snapshot name.
  'site.standard.document': 'blogs',
  'pub.leaflet.document': 'leaflets',
  'is.dame.creating.work': 'creations',
  'fm.teal.alpha.feed.play': 'listening',
};

/**
 * Deterministic snapshot file name for a given NSID. Uses the legacy
 * name when one is pinned (so consumers like `fetchSnapshot('now')`
 * keep working), otherwise an NSID-shaped slug that won't collide when
 * a verb owns multiple lexicons under the same source.
 */
export function snapshotNameFor(verb, source, nsid) {
  if (LEGACY_SNAPSHOT_NAME[nsid]) return LEGACY_SNAPSHOT_NAME[nsid];
  return nsid.replace(/\./g, '-');
}

/**
 * Defensive backfill: every is.dame.* record carries createdAt + updatedAt.
 * Older records may have only createdAt. Mirror it onto updatedAt so the
 * footer's <RecordTimestamp /> never renders broken.
 */
export function backfillTimestamps(records) {
  for (const r of records || []) {
    const v = r.value || r;
    if (!v) continue;
    if (!v.createdAt && v.indexedAt) v.createdAt = v.indexedAt;
    if (v.createdAt && !v.updatedAt) v.updatedAt = v.createdAt;
  }
  return records;
}

/**
 * Map a record into the unified feed shape.
 *   { verb, createdAt, atUri, payload, source, subject? }
 */
export function toFeedItem(verb, record, { source, subject } = {}) {
  const value = record.value || {};
  const createdAt =
    value.createdAt ||
    value.playedTime || // fm.teal.alpha.feed.play
    value.playedAt ||
    value.publishedAt || // pub.leaflet.document
    record.indexedAt ||
    null;
  const item = {
    verb,
    createdAt,
    atUri: record.uri || null,
    cid: record.cid || null,
    source: source || null,
    payload: value,
  };
  const subj = subject || record._subject;
  if (subj) item.subject = subj;
  return item;
}

/**
 * Creative works and blog posts share the `site.standard.document` type;
 * the publication they belong to decides the surface. A standard doc in the
 * portfolio publication rides the `creating` verb; everything else keeps the
 * verb its collection declares.
 */
export function effectiveVerb(verb, nsid, value) {
  if (nsid === 'site.standard.document' && isPortfolioDoc(value)) return 'creating';
  return verb;
}

export function blueskyPostToFeedItem(item) {
  const post = item?.post;
  if (!post?.uri) return null;
  // Reposts in the author feed are owned by the `reposting` verb, which is
  // ingested separately from `app.bsky.feed.repost` on Dame's PDS (with
  // its subject hydrated to the full original post via `getPosts`). Skip
  // them here so we don't double-count.
  if (item?.reason?.$type === 'app.bsky.feed.defs#reasonRepost') return null;
  return {
    verb: 'posting',
    source: 'bsky',
    createdAt: post.record?.createdAt || post.indexedAt || null,
    atUri: post.uri,
    cid: post.cid || null,
    payload: {
      text: post.record?.text || '',
      facets: post.record?.facets || null,
      langs: post.record?.langs || null,
      author: {
        did: post.author?.did,
        handle: post.author?.handle,
        displayName: post.author?.displayName,
        avatar: post.author?.avatar,
      },
      replyCount: post.replyCount || 0,
      repostCount: post.repostCount || 0,
      likeCount: post.likeCount || 0,
      embed: post.embed || null,
      embedRecord: post.record?.embed || null,
      indexedAt: post.indexedAt,
      reply: post.record?.reply || null,
      parent: condensePostView(item?.reply?.parent),
      root: condensePostView(item?.reply?.root),
    },
  };
}

/**
 * Reshape a raw `app.bsky.feed.repost` feed item into the same payload
 * shape that PostCard expects for an authored post. The rendered card is
 * the *original* post (with author, text, embed, etc.); a small `reason`
 * block captures who reposted it and when so PostCard can render the
 * "↻ reposted" badge.
 */
export function repostToFullPostItem(item, record) {
  const subject = record._subject;
  const view = subject?.kind === 'bsky.post' ? subject.view : null;
  const ref = subject?.ref || record.value?.subject || null;
  const repostedAt = record.value?.createdAt || record.indexedAt || null;
  if (!view) {
    return {
      ...item,
      payload: {
        ...item.payload,
        subjectRef: ref,
        subjectMissing: true,
        reason: {
          $type: 'app.bsky.feed.defs#reasonRepost',
          indexedAt: repostedAt,
        },
      },
    };
  }
  return {
    ...item,
    cid: view.cid || item.cid,
    payload: {
      text: view.record?.text || '',
      facets: view.record?.facets || null,
      langs: view.record?.langs || null,
      author: view.author
        ? {
            did: view.author.did,
            handle: view.author.handle,
            displayName: view.author.displayName,
            avatar: view.author.avatar,
          }
        : null,
      replyCount: view.replyCount || 0,
      repostCount: view.repostCount || 0,
      likeCount: view.likeCount || 0,
      embed: view.embed || null,
      embedRecord: view.record?.embed || null,
      indexedAt: view.indexedAt,
      subjectUri: view.uri,
      subjectRef: ref,
      reason: {
        $type: 'app.bsky.feed.defs#reasonRepost',
        indexedAt: repostedAt,
      },
    },
  };
}

/**
 * Strip a feed-item's parent/root post view down to just the bits we need
 * to render a reply card. Cuts ~80% of the size off the snapshot.
 */
export function condensePostView(view) {
  if (!view || view.$type === 'app.bsky.feed.defs#notFoundPost' || view.$type === 'app.bsky.feed.defs#blockedPost') {
    return view ? { $type: view.$type, uri: view.uri || null } : null;
  }
  if (!view.uri) return null;
  return {
    uri: view.uri,
    cid: view.cid || null,
    indexedAt: view.indexedAt || null,
    author: view.author
      ? {
          did: view.author.did,
          handle: view.author.handle,
          displayName: view.author.displayName,
          avatar: view.author.avatar,
        }
      : null,
    record: view.record
      ? {
          text: view.record.text || '',
          createdAt: view.record.createdAt || null,
          facets: view.record.facets || null,
          embed: view.record.embed || null,
        }
      : null,
    embed: view.embed || null,
    replyCount: view.replyCount || 0,
    repostCount: view.repostCount || 0,
    likeCount: view.likeCount || 0,
  };
}

/**
 * Walk a pub.leaflet.document value and annotate any blob refs (preview
 * images on website blocks, image blocks) with a `_url` field so the
 * client renderer can display them without resolving the PDS again.
 */
export function annotateLeafletBlobs(docValue, pds, did = ME_DID) {
  const pages = Array.isArray(docValue?.pages) ? docValue.pages : [];
  for (const page of pages) {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const wrap of blocks) {
      const block = wrap?.block;
      if (!block) continue;
      const cid = pickBlobCid(block.previewImage) || pickBlobCid(block.image);
      if (!cid) continue;
      const url = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
      if (block.previewImage && pickBlobCid(block.previewImage) === cid) {
        block.previewImage._url = url;
      }
      if (block.image && pickBlobCid(block.image) === cid) {
        block.image._url = url;
      }
    }
  }
}

function pickBlobCid(blob) {
  if (!blob) return null;
  return blob.ref?.$link || blob.cid || null;
}

/**
 * Pull a short plaintext synopsis from a leaflet doc — first ~280 chars
 * across the leading text blocks. Used as a summary on the blog index
 * and home feed when the doc has no `description`.
 */
export function leafletSynopsis(docValue) {
  const pages = Array.isArray(docValue?.pages) ? docValue.pages : [];
  const parts = [];
  let len = 0;
  outer: for (const page of pages) {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const wrap of blocks) {
      const block = wrap?.block;
      if (block?.$type !== 'pub.leaflet.blocks.text') continue;
      const text = (block.plaintext || '').trim();
      if (!text) continue;
      parts.push(text);
      len += text.length;
      if (len > 280) break outer;
    }
  }
  if (parts.length === 0) return '';
  const joined = parts.join(' ');
  if (joined.length <= 280) return joined;
  return joined.slice(0, 277).trimEnd() + '…';
}

/**
 * Apply per-collection transforms based on NSID. Mutates the records in
 * place. Anything we can do in one pass to make rendering easier — slug
 * mirrors, blob URL bake-ins, etc. — lives here.
 */
export function transformRecords(records, nsid, pds, did = ME_DID, opts = {}) {
  if (!records?.length) return records;
  for (const r of records) {
    const v = r?.value;
    if (!v) continue;

    if (!v.createdAt && v.publishedAt) v.createdAt = v.publishedAt;
    if (!v.createdAt && v.playedTime) v.createdAt = v.playedTime;
    if (!v.createdAt && r.indexedAt) v.createdAt = r.indexedAt;
    if (v.createdAt && !v.updatedAt) v.updatedAt = v.createdAt;
  }

  if (nsid === 'pub.leaflet.document') {
    for (const r of records) {
      const v = r?.value;
      if (!v) continue;
      annotateLeafletBlobs(v, pds, did);
      if (!v.summary) v.summary = leafletSynopsis(v);
    }
  }

  if (nsid === 'site.standard.document') {
    for (const r of records) {
      const v = r?.value;
      if (!v) continue;
      // A standard doc carries an optional top-level coverImage blob.
      annotateBlobUrl(v.coverImage, pds, did);
      if (!v?.content) continue;
      // site.standard.document wraps a pub.leaflet.content under `content`.
      annotateLeafletBlobs(v.content, pds, did);
      if (!v.summary) v.summary = leafletSynopsis(v.content);
    }
  }

  if (nsid === COLLECTIONS.creating) {
    for (const r of records) {
      const v = r?.value;
      if (!v) continue;
      annotateBlobUrl(v.coverImage, pds, did);
      if (!v?.content) continue;
      annotateLeafletBlobs(v.content, pds, did);
    }
  }

  // Anisota Lab pieces carry bulky reproduction data (gouge paths, synth event
  // grids, reaction-diffusion recipes, sigil core paths…) that never renders —
  // AnisotaLabCard only needs the finished text / tiles / figure / print. Drop
  // the reopen-the-studio payloads so they don't bloat the unified feed. What
  // the card renders (name, text, tiles+board, redacted+original, image, svg,
  // description, tempo/steps/scale) is kept.
  if (ANISOTA_LAB_HEAVY_FIELDS[nsid]) {
    for (const r of records) {
      const v = r?.value;
      if (!v) continue;
      for (const key of ANISOTA_LAB_HEAVY_FIELDS[nsid]) delete v[key];
      // For the static build-time snapshot, also drop the big inline media
      // data-URLs (a rendered PNG is ≤200 KB; a sigil SVG ≤60 KB) so the
      // snapshot JSON stays small. The in-memory live feed keeps them (it
      // never touches storage), and the record page re-fetches the full
      // record, so the piece still renders everywhere it's shown.
      if (opts.leanMedia) {
        delete v.image;
        delete v.svg;
      }
    }
  }

  return records;
}

/**
 * Per-collection lists of reproduction-only fields stripped from every Anisota
 * Lab record before it enters the feed (see transformRecords). Redaction keeps
 * `original` + `redacted` (the erasure render needs them); poetry keeps
 * `tiles` + `board` (the tile re-lay needs them).
 */
const ANISOTA_LAB_HEAVY_FIELDS = {
  'net.anisota.lab.poetry': ['sources'],
  'net.anisota.lab.sigil': ['points', 'meta'],
  'net.anisota.lab.carving': ['strokes'],
  'net.anisota.lab.inkblot': ['params'],
  'net.anisota.lab.synth': ['tracks', 'fx'],
  'net.anisota.lab.petri': ['drops', 'params'],
  'net.anisota.spell.custom': ['conditions', 'effects', 'source', 'trigger'],
};

/**
 * Bake a `_url` onto a single top-level blob ref (e.g. a document's
 * `coverImage`) so the client can render it without re-resolving the PDS.
 * Mirrors the blob handling inside `annotateLeafletBlobs`.
 */
export function annotateBlobUrl(blob, pds, did = ME_DID) {
  const cid = pickBlobCid(blob);
  if (!cid || !blob) return;
  blob._url = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
}

/**
 * When a verb spans multiple publishing tools that mirror the same
 * record (currently: standard.site + pub.leaflet for blogging), collapse
 * duplicates by normalized title. Source priority resolves ties — the
 * first source listed wins.
 *
 * Records authored under `is.dame.*` lexicons are never deduped against
 * external tools: those are first-party originals and should always
 * surface, even if a syndication tool happens to share their title.
 */
const DEDUPE_PRIORITY = {
  blogging: ['standard', 'leaflet'],
};

export function dedupeVerbAggregate(verb, items) {
  const priority = DEDUPE_PRIORITY[verb];
  if (!priority) return items;
  const rank = (s) => {
    const idx = priority.indexOf(s);
    return idx === -1 ? Number.POSITIVE_INFINITY : idx;
  };
  const isDedupable = (item) => priority.includes(item.source);

  const winnerByTitle = new Map();
  for (const item of items) {
    if (!isDedupable(item)) continue;
    const key = normalizeTitle(item.payload?.title);
    if (!key) continue;
    const current = winnerByTitle.get(key);
    if (!current || rank(item.source) < rank(current.source)) {
      winnerByTitle.set(key, item);
    }
  }

  return items.filter((item) => {
    if (!isDedupable(item)) return true;
    const key = normalizeTitle(item.payload?.title);
    if (!key) return true;
    const winner = winnerByTitle.get(key);
    return !winner || winner === item;
  });
}

function normalizeTitle(title) {
  if (!title) return '';
  return String(title).toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Drop records older than `maxAgeDays`. Used to keep noisy reference
 * verbs (likes, follows) from drowning the timeline.
 */
export function applyAgeCutoff(records, maxAgeDays) {
  if (!maxAgeDays) return records;
  const cutoff = Date.now() - maxAgeDays * 86400 * 1000;
  return records.filter((r) => {
    const v = r?.value || {};
    const ts = v.createdAt || v.playedTime || r.indexedAt;
    if (!ts) return true;
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t >= cutoff : true;
  });
}

/**
 * The highest iNaturalist id already mirrored, across both observation
 * collections' fetched records (each keyed by its iNat id). Observation
 * records list newest-first, so even a capped first-paint fetch still holds
 * the true maximum. Returns null when no observations were fetched.
 */
function newestMirroredObservationId(perCollection) {
  let max = 0;
  for (const nsid of [MOTHING_OBSERVATION_NSID, OBSERVING_OBSERVATION_NSID]) {
    const records = perCollection[nsid.replace(/\./g, '-')] || [];
    for (const r of records) {
      const n = Number(String(r?.uri || '').split('/').pop());
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max || null;
}

/**
 * Fetch every `app.bsky.graph.listitem` record and bucket them under their
 * parent list URI. Each list record gets a `_members` array of `{ did }`
 * entries (later resolved to handles via the bsky AppView).
 */
export async function aggregateListItems(lists, pds, did = ME_DID) {
  if (!lists?.length) return;
  const items = await listRecords(pds, {
    repo: did,
    collection: 'app.bsky.graph.listitem',
    max: 1000,
  });
  const byList = new Map();
  for (const it of items) {
    const v = it?.value;
    if (!v?.list || !v?.subject) continue;
    if (!byList.has(v.list)) byList.set(v.list, []);
    byList.get(v.list).push({ did: v.subject, addedAt: v.createdAt || null });
  }
  for (const list of lists) {
    list._members = byList.get(list.uri) || [];
  }
}

/**
 * Sort a unified feed in-place by `createdAt` descending. Records
 * without a timestamp sink to the bottom in stable input order.
 */
export function sortUnifiedFeed(unified) {
  unified.sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt));
  return unified;
}

/**
 * Orchestrator: fetch the registry-driven home feed for `me` from the
 * public AppView + their PDS, normalize records, hydrate reference
 * subjects, and return:
 *
 *   {
 *     unified,        // unified feed array, sorted newest-first
 *     perCollection,  // { snapshotName -> raw records[] } for per-verb files
 *     perVerb,        // { verb -> deduped feed items[] } for combined files
 *     authorFeed,     // raw bsky author-feed result (used for posts.json)
 *     counts,         // counts keyed by snapshot/per-verb name (debug)
 *   }
 *
 * `pds` is required; resolve it via `resolvePds(ME_DID)` before calling.
 *
 * Errors per-collection are swallowed (logged via `options.warn`) so a
 * single bad NSID can't take down the whole home feed.
 */
export async function buildUnifiedFeed({
  pds,
  me = ME_DID,
  appview = APPVIEW,
  options = {},
} = {}) {
  if (!pds) throw new Error('buildUnifiedFeed: `pds` is required');

  const log = options.log || (() => {});
  const warn = options.warn || ((..._args) => {});
  const authorFeedMax = options.authorFeedMax ?? 200;
  // When set, every collection's listRecords cap is reduced to at most
  // this value. Lets the browser request a small "first paint" payload
  // (faster TTFP, smaller subject hydration fan-out) while the prefetch
  // script keeps its full caps for the static snapshot.
  const initialMax = options.initialMax ?? null;
  const capFor = (c) => (initialMax ? Math.min(c.max || 200, initialMax) : c.max || 200);
  // Snapshot builds (the prefetch script) drop the big inline media data-URLs
  // from Anisota Lab records to keep public/data JSON small; the browser's
  // in-memory live feed leaves `leanMedia` off so it renders the real media.
  const leanMedia = options.leanMedia === true;
  // Skipping list-item aggregation on the first fetch shaves a 1000-row
  // listRecords call; lists still render, just without `_members`.
  const skipListMembers = options.skipListMembers === true;
  // When provided, restrict the ingest to these verb names (registry
  // `verb` values). The browser passes only the verbs the active filter
  // set will actually render, so first paint doesn't pay to fetch +
  // hydrate high-cost reference verbs (likes, votes — resolved one
  // getRecord at a time through the PLC) that are hidden by default.
  // Omitted (e.g. the prefetch script) → every verb is fetched.
  const wantVerbs = Array.isArray(options.verbs) ? new Set(options.verbs) : null;
  const includeVerb = (verb) => !wantVerbs || wantVerbs.has(verb);

  const resolver = options.subjectResolver || createSubjectResolver({ appview, warn });

  const safe = async (label, fn, fallback) => {
    try {
      return await fn();
    } catch (err) {
      warn(`${label} failed:`, err?.message || err);
      return fallback;
    }
  };

  const unified = [];
  const counts = {};
  const perCollection = {};
  const perVerb = {};

  // --- Bluesky author feed (special-cased: gives reply context + counts) ----
  // `posting` owns the author feed; skip the call entirely when posts
  // aren't in the requested verb set.
  const authorFeed = includeVerb('posting')
    ? await safe(
        'getAuthorFeed',
        () => getAuthorFeed(me, { appview, max: authorFeedMax }),
        [],
      )
    : [];
  counts.posts = authorFeed.length;
  for (const item of authorFeed) {
    const f = blueskyPostToFeedItem(item);
    if (f) unified.push(f);
  }

  // --- Registry-driven ingest, fanned out in parallel by verb -------------
  const verbResults = await Promise.all(
    VERB_REGISTRY.filter((vc) => includeVerb(vc.verb)).map(async (verbConfig) => {
      const collectionResults = await Promise.all(
        verbConfig.collections.map(async (c) => {
          if (c.kind === 'appviewFeed') return { c, records: [] };

          const fetched = await safe(
            `listRecords:${c.nsid}`,
            () => listRecords(pds, { repo: me, collection: c.nsid, max: capFor(c) }),
            [],
          );
          transformRecords(fetched, c.nsid, pds, me, { leanMedia });
          // Drafts must never reach public surfaces — the snapshots written
          // from these records are world-readable. The admin reads the PDS
          // live (authenticated), so it still sees drafts.
          const records =
            c.kind === 'content'
              ? fetched.filter((r) => r?.value?.draft !== true)
              : fetched;

          if (c.kind === 'reference') {
            await safe(
              `hydrateSubjects:${c.nsid}`,
              () => resolver.hydrateSubjects(records, c),
              null,
            );
          }

          if (c.withMembers === 'app.bsky.graph.listitem' && !skipListMembers) {
            await safe(
              `aggregateListItems:${c.nsid}`,
              () => aggregateListItems(records, pds, me),
              null,
            );
          }

          return { c, records };
        }),
      );

      const verbAggregate = [];
      for (const { c, records } of collectionResults) {
        if (c.kind === 'appviewFeed') continue;

        const snapName = snapshotNameFor(verbConfig.verb, c.source, c.nsid);
        perCollection[snapName] = records;
        counts[snapName] = records.length;

        const trimmed = applyAgeCutoff(records, c.maxAgeDays);
        verbAggregate.push(
          ...trimmed.map((r) => {
            const verb = effectiveVerb(verbConfig.verb, c.nsid, r.value);
            const item = toFeedItem(verb, r, {
              source: c.source,
              subject: r._subject || null,
            });
            // Reposts render as full posts using PostCard, not as terse
            // "a post by …" reference lines. Reshape the payload to mirror
            // the bsky author-feed shape so PostCard can read it directly.
            if (verbConfig.verb === 'reposting' && c.nsid === 'app.bsky.feed.repost') {
              return repostToFullPostItem(item, r);
            }
            return item;
          }),
        );
      }

      const deduped = dedupeVerbAggregate(verbConfig.verb, verbAggregate);
      return { verbConfig, deduped };
    }),
  );

  // Group by each item's *effective* verb (not the collection's declared
  // verb) so portfolio standard-docs land under `creating`, not `blogging`.
  for (const { deduped } of verbResults) {
    for (const item of deduped) {
      (perVerb[item.verb] ||= []).push(item);
      unified.push(item);
    }
  }

  // Live-augment observations from iNaturalist: surface sightings newer than
  // the newest mirrored record so they appear before the mirror cron writes
  // them. Opt-in (`options.liveObservations`) — the browser turns it on; the
  // static snapshot build leaves it off since the cron keeps that fresh. Each
  // item borrows the deterministic at:// URI the mirror will assign (keyed by
  // the iNat id), so it merges with — never duplicates — the record once
  // mirrored.
  if (options.liveObservations && (includeVerb('mothing') || includeVerb('observing'))) {
    await safe('liveObservations', async () => {
      const newestId = newestMirroredObservationId(perCollection);
      const live = await fetchLiveObservationItems({
        me,
        newestMirroredId: newestId,
        user: options.inaturalistUser || INATURALIST_USER,
        wantMothing: includeVerb('mothing'),
        wantObserving: includeVerb('observing'),
        warn,
      });
      const seen = new Set(unified.map((i) => i.atUri));
      let added = 0;
      for (const item of live) {
        if (!item.atUri || seen.has(item.atUri)) continue;
        seen.add(item.atUri);
        unified.push(item);
        (perVerb[item.verb] ||= []).push(item);
        added += 1;
      }
      counts.liveObservations = added;
    }, null);
  }

  sortUnifiedFeed(unified);
  counts.unified = unified.length;

  log('built unified feed', { unified: unified.length });
  return { unified, perCollection, perVerb, authorFeed, counts };
}

/**
 * For a given verb, return `true` if its combined `<verb>.json` file
 * should be written by the prefetch script — i.e. the verb spans more
 * than one non-AppView collection. Single-collection verbs already have
 * their data on disk under the legacy / per-source name.
 */
export function shouldWriteCombinedVerbFile(verbConfig) {
  return verbConfig.collections.filter((c) => c.kind !== 'appviewFeed').length > 1;
}
