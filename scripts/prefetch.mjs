#!/usr/bin/env node
// Build-time data fetcher.
//
// Reads from the AppView (Bluesky) + the user's PDS (resolved via plc.directory)
// and writes JSON snapshots into public/data/. Each snapshot is also merged into
// `unifiedFeed.json` for the home page.
//
// Run with: `node scripts/prefetch.mjs`
//
// Designed to never throw fatally — a missing collection (e.g. teal.fm if the
// NSID has changed) degrades to an empty array so the rest of the build keeps
// going. Errors are logged to stderr.
//
// The set of collections that get fetched is driven by `src/lib/verbRegistry.js`.
// Adding a new record type to the home feed means adding a verb / collection
// entry there — this script auto-discovers it on the next run.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ME_DID,
  COLLECTIONS,
  APPVIEW,
} from '../src/config.js';
import {
  resolvePds,
  getProfile,
  getAuthorFeed,
  listRecords,
  getRecord,
} from '../src/lib/atproto.js';
import { VERB_REGISTRY } from '../src/lib/verbRegistry.js';
import { hydrateSubjects } from './lib/resolveSubject.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'public/data');

const log = (...args) => console.log('[prefetch]', ...args);
const warn = (...args) => console.warn('[prefetch]', ...args);

async function writeJson(name, data) {
  await mkdir(OUT, { recursive: true });
  const path = resolve(OUT, `${name}.json`);
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  const count = Array.isArray(data) ? data.length : Array.isArray(data?.records) ? data.records.length : '—';
  log(`wrote ${name}.json (${count})`);
}

async function safe(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    warn(`${label} failed:`, err?.message || err);
    return fallback;
  }
}

/**
 * Maps registry NSIDs to the legacy snapshot file names that the rest of
 * the codebase still reads (`fetchSnapshot('now')`, etc.). NSIDs without
 * an entry get `<verb>-<source>` filenames instead.
 */
const LEGACY_SNAPSHOT_NAME = {
  'is.dame.now': 'now',
  'is.dame.blogging.post': 'blogs',
  'pub.leaflet.document': 'leaflets',
  'is.dame.creating.work': 'creations',
  'fm.teal.alpha.feed.play': 'listening',
};

/**
 * Deterministic snapshot file name for a given NSID. Uses the legacy
 * name when one is pinned (so consumers like `fetchSnapshot('now')`
 * keep working), otherwise a NSID-shaped slug that won't collide when
 * a verb owns multiple lexicons under the same source (e.g.
 * `social.grain.gallery` and `social.grain.story` both fall under
 * verb=photographing/source=grain — naming by NSID keeps them distinct).
 */
function snapshotNameFor(verb, source, nsid) {
  if (LEGACY_SNAPSHOT_NAME[nsid]) return LEGACY_SNAPSHOT_NAME[nsid];
  return nsid.replace(/\./g, '-');
}

/**
 * Defensive backfill: every is.dame.* record carries createdAt + updatedAt.
 * Older records may have only createdAt. Mirror it onto updatedAt so the
 * footer's <RecordTimestamp /> never renders broken.
 */
function backfillTimestamps(records) {
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
function toFeedItem(verb, record, { source, subject } = {}) {
  const value = record.value || {};
  const createdAt =
    value.createdAt ||
    value.playedTime ||  // fm.teal.alpha.feed.play
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

function blueskyPostToFeedItem(item) {
  const post = item?.post;
  if (!post?.uri) return null;
  // Bluesky's getAuthorFeed mixes authored posts and reposts in one stream.
  // A repost is signalled by `reason.$type === ...#reasonRepost`, where
  // `post` is still the *original* post (different DID + rkey from anything
  // on Dame's PDS). Surface those as a separate `reposting` verb so the
  // home feed badge and styling can distinguish them from authored posts.
  const isRepost = item?.reason?.$type === 'app.bsky.feed.defs#reasonRepost';
  const reason = isRepost ? condenseReason(item.reason) : null;
  return {
    verb: isRepost ? 'reposting' : 'posting',
    source: 'bsky',
    // Sort reposts by *when Dame reposted*, not the original post's
    // createdAt — otherwise reposting an older post would bury it deep in
    // the timeline.
    createdAt: isRepost
      ? (reason?.indexedAt || post.indexedAt || post.record?.createdAt || null)
      : (post.record?.createdAt || post.indexedAt || null),
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
      // Two embed shapes are kept side-by-side. `embed` is the resolved
      // AppView "view" form with CDN URLs (preferred for rendering).
      // `embedRecord` is the raw record-level embed (blob refs only) so we
      // still have something to render if we ever lose the AppView view.
      embed: post.embed || null,
      embedRecord: post.record?.embed || null,
      indexedAt: post.indexedAt,
      reason,
      // Reply context — pulled from the AppView feed item. The `reply`
      // field on the underlying record carries the parent/root URIs; the
      // surrounding `item.reply` carries the resolved post views (one level
      // up) so we can render a parent card without an extra round-trip.
      reply: post.record?.reply || null,
      parent: condensePostView(item?.reply?.parent),
      root: condensePostView(item?.reply?.root),
    },
  };
}

/**
 * Strip a feed-item `reason` down to a small, render-ready shape. Today
 * we only care about reposts; future reasons (pinned, etc.) can land here
 * too.
 */
function condenseReason(reason) {
  if (!reason || reason.$type !== 'app.bsky.feed.defs#reasonRepost') return null;
  const by = reason.by || {};
  return {
    $type: reason.$type,
    indexedAt: reason.indexedAt || null,
    by: {
      did: by.did,
      handle: by.handle,
      displayName: by.displayName,
      avatar: by.avatar,
    },
  };
}

/**
 * Strip a feed-item's parent/root post view down to just the bits we need
 * to render a reply card. Cuts ~80% of the size off the snapshot.
 */
function condensePostView(view) {
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
 *
 * Leaflet doc blobs live on the author's PDS. The standard atproto blob
 * fetch endpoint is `com.atproto.sync.getBlob?did&cid`.
 */
function annotateLeafletBlobs(docValue, pds) {
  const pages = Array.isArray(docValue?.pages) ? docValue.pages : [];
  for (const page of pages) {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const wrap of blocks) {
      const block = wrap?.block;
      if (!block) continue;
      const cid = pickBlobCid(block.previewImage) || pickBlobCid(block.image);
      if (!cid) continue;
      const url = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(ME_DID)}&cid=${encodeURIComponent(cid)}`;
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
function leafletSynopsis(docValue) {
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
function transformRecords(records, nsid, pds) {
  if (!records?.length) return records;
  for (const r of records) {
    const v = r?.value;
    if (!v) continue;

    // Cross-NSID timestamp backfill.
    if (!v.createdAt && v.publishedAt) v.createdAt = v.publishedAt;
    if (!v.createdAt && v.playedTime) v.createdAt = v.playedTime;
    if (!v.createdAt && r.indexedAt) v.createdAt = r.indexedAt;
    if (v.createdAt && !v.updatedAt) v.updatedAt = v.createdAt;
  }

  if (nsid === 'pub.leaflet.document') {
    for (const r of records) {
      const v = r?.value;
      if (!v) continue;
      annotateLeafletBlobs(v, pds);
      if (!v.summary) v.summary = leafletSynopsis(v);
    }
  }

  return records;
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

function dedupeVerbAggregate(verb, items) {
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
function applyAgeCutoff(records, maxAgeDays) {
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
 * Fetch every `app.bsky.graph.listitem` record and bucket them under their
 * parent list URI. Each list record gets a `_members` array of `{ did }`
 * entries (later resolved to handles via the bsky AppView).
 */
async function aggregateListItems(lists, pds) {
  if (!lists?.length) return;
  const items = await safe(
    'listRecords:listitem',
    () => listRecords(pds, { repo: ME_DID, collection: 'app.bsky.graph.listitem', max: 1000 }),
    [],
  );
  const byList = new Map();
  for (const it of items) {
    const v = it?.value;
    if (!v?.list || !v?.subject) continue;
    if (!byList.has(v.list)) byList.set(v.list, []);
    byList.get(v.list).push({ did: v.subject, addedAt: v.createdAt || null });
  }
  for (const list of lists) {
    const members = byList.get(list.uri) || [];
    list._members = members;
  }
}

async function main() {
  log(`me=${ME_DID}`);
  const pds = await safe('resolvePds', () => resolvePds(ME_DID), null);
  if (!pds) {
    warn('No PDS resolved — exiting with empty snapshots so the site still builds.');
    await writeJson('snapshot-meta', {
      builtAt: new Date().toISOString(),
      pds: null,
      did: ME_DID,
      ok: false,
    });
    return;
  }
  log(`pds=${pds}`);

  // --- Profile (AppView) ----------------------------------------------------
  const profile = await safe('getProfile', () => getProfile(ME_DID), null);
  await writeJson('profile', profile || {});

  // --- Extended profile (is.dame.profile/self on PDS) -----------------------
  const extendedProfile = await safe('extendedProfile', async () => {
    const rec = await getRecord(pds, {
      repo: ME_DID,
      collection: COLLECTIONS.profile,
      rkey: 'self',
    });
    return rec;
  }, null);
  if (extendedProfile?.value) {
    const v = extendedProfile.value;
    if (!v.updatedAt && v.createdAt) v.updatedAt = v.createdAt;
  }
  await writeJson('extendedProfile', extendedProfile || {});

  // --- is.dame.page (pages keyed by rkey) -----------------------------------
  const pageRecords = backfillTimestamps(
    await safe('listRecords:page', () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.page, max: 100 }), []),
  );
  const pages = {};
  for (const r of pageRecords) {
    const m = String(r.uri || '').match(/\/([^/]+)$/);
    if (m) pages[m[1]] = r;
  }
  await writeJson('pages', pages);

  // --- Registry-driven ingest -----------------------------------------------
  const unified = [];
  const counts = {};

  // Bluesky author feed — special-cased because the AppView gives us reply
  // context, counts, and embed views that listRecords can't.
  const authorFeed = await safe(
    'getAuthorFeed',
    () => getAuthorFeed(ME_DID, { max: 200 }),
    [],
  );
  await writeJson('posts', authorFeed);
  counts.posts = authorFeed.length;
  for (const item of authorFeed) {
    const f = blueskyPostToFeedItem(item);
    if (f) unified.push(f);
  }

  for (const verbConfig of VERB_REGISTRY) {
    // Group collections by snapshot file so verbs that span multiple sources
    // can still produce one merged file per source.
    const verbAggregate = [];

    for (const c of verbConfig.collections) {
      if (c.kind === 'appviewFeed') continue; // handled above (posts)

      const label = `listRecords:${c.nsid}`;
      let records = await safe(
        label,
        () => listRecords(pds, { repo: ME_DID, collection: c.nsid, max: c.max || 200 }),
        [],
      );
      transformRecords(records, c.nsid, pds);

      if (c.kind === 'reference') {
        await safe(`hydrateSubjects:${c.nsid}`, () => hydrateSubjects(records, c), null);
      }

      if (c.withMembers && c.withMembers === 'app.bsky.graph.listitem') {
        await aggregateListItems(records, pds);
      }

      // Per-source / legacy snapshot.
      const snapName = snapshotNameFor(verbConfig.verb, c.source, c.nsid);
      await writeJson(snapName, records);
      counts[snapName] = records.length;

      // Reposts are also surfaced — and *better* surfaced — via the
      // Bluesky author feed (where `item.reason === reasonRepost` carries
      // the full original post view). Skip the raw `app.bsky.feed.repost`
      // listRecords result from the unified feed so we don't show two
      // copies (one rich, one empty pointer record). The per-source snapshot
      // is still written above for anything that wants the raw repost log.
      if (verbConfig.verb === 'reposting' && c.nsid === 'app.bsky.feed.repost') {
        continue;
      }

      // Apply age cutoff before pushing into the unified feed; keep the full
      // set in per-verb snapshots so per-page views can scroll back further.
      const trimmed = applyAgeCutoff(records, c.maxAgeDays);
      verbAggregate.push(...trimmed.map((r) => toFeedItem(verbConfig.verb, r, {
        source: c.source,
        subject: r._subject || null,
      })));
    }

    // Cross-source dedupe. Some verbs span multiple publishing tools
    // that write the same logical record to multiple lexicons (e.g.
    // standard.site and leaflet.pub both ingest the same blog post via
    // atproto). For these, collapse duplicates by title so the home
    // feed doesn't show the same article twice.
    const deduped = dedupeVerbAggregate(verbConfig.verb, verbAggregate);

    // Multi-collection verbs also write a combined `<verb>.json` for
    // page-level consumers that want everything at once.
    if (verbConfig.collections.filter((c) => c.kind !== 'appviewFeed').length > 1) {
      // The combined file already lives on disk under the legacy / per-source
      // names; emit a merged unified-feed-shape file too for convenience.
      await writeJson(verbConfig.verb, deduped);
    }

    unified.push(...deduped);
  }

  unified.sort((a, b) => {
    const ax = a.createdAt || '';
    const bx = b.createdAt || '';
    if (!ax && !bx) return 0;
    if (!ax) return 1;
    if (!bx) return -1;
    return ax < bx ? 1 : -1;
  });
  await writeJson('unifiedFeed', unified);
  counts.unified = unified.length;

  // --- Snapshot meta --------------------------------------------------------
  await writeJson('snapshot-meta', {
    builtAt: new Date().toISOString(),
    pds,
    appview: APPVIEW,
    did: ME_DID,
    counts,
    ok: true,
  });

  log('done');
}

main().catch((err) => {
  console.error('[prefetch] fatal', err);
  process.exitCode = 1;
});
