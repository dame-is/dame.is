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
  toAtUri,
} from '../src/lib/atproto.js';

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
 *   { verb, createdAt, atUri, payload }
 */
function toFeedItem(verb, record, { fallbackCreatedAt } = {}) {
  const value = record.value || {};
  const createdAt =
    value.createdAt ||
    value.publishedAt ||  // pub.leaflet.document
    value.playedTime ||  // fm.teal.alpha.feed.play
    value.playedAt ||
    record.indexedAt ||
    fallbackCreatedAt ||
    null;
  return {
    verb,
    createdAt,
    atUri: record.uri || null,
    cid: record.cid || null,
    payload: value,
  };
}

function blueskyPostToFeedItem(item) {
  const post = item?.post;
  if (!post?.uri) return null;
  return {
    verb: 'posting',
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
      // Two embed shapes are kept side-by-side. `embed` is the resolved
      // AppView "view" form with CDN URLs (preferred for rendering).
      // `embedRecord` is the raw record-level embed (blob refs only) so we
      // still have something to render if we ever lose the AppView view.
      embed: post.embed || null,
      embedRecord: post.record?.embed || null,
      indexedAt: post.indexedAt,
      reason: item.reason || null,
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

  // --- Bluesky author feed --------------------------------------------------
  const authorFeed = await safe(
    'getAuthorFeed',
    () => getAuthorFeed(ME_DID, { max: 200 }),
    [],
  );
  await writeJson('posts', authorFeed);

  // --- is.dame.now (status updates) -----------------------------------------
  const nowRecords = backfillTimestamps(
    await safe('listRecords:now', () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.now, max: 500 }), []),
  );
  await writeJson('now', nowRecords);

  // --- is.dame.blogging.post ------------------------------------------------
  const blogRecords = backfillTimestamps(
    await safe('listRecords:blogging', () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.blogging, max: 200 }), []),
  );
  await writeJson('blogs', blogRecords);

  // --- pub.leaflet.document -------------------------------------------------
  // Long-form documents authored on leaflet.pub. We mirror them onto
  // /blogging alongside our own is.dame.blogging.post records.
  const leafletRecords = await safe(
    'listRecords:leaflet',
    () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.leaflet, max: 200 }),
    [],
  );
  for (const r of leafletRecords) {
    const v = r?.value;
    if (!v) continue;
    // Leaflet docs don't carry createdAt/updatedAt — they have publishedAt.
    // Mirror it onto createdAt so existing snapshot helpers keep working.
    if (!v.createdAt && v.publishedAt) v.createdAt = v.publishedAt;
    if (!v.updatedAt) v.updatedAt = v.createdAt;
    // Bake blob URLs into block previews / images so the renderer doesn't
    // need to know about the PDS endpoint.
    annotateLeafletBlobs(v, pds);
    // Lift a plaintext synopsis out of the first non-empty text block so
    // the index page and unified feed have something to show.
    if (!v.summary) v.summary = leafletSynopsis(v);
  }
  await writeJson('leaflets', leafletRecords);

  // --- is.dame.creating.work ------------------------------------------------
  const creatingRecords = backfillTimestamps(
    await safe('listRecords:creating', () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 }), []),
  );
  await writeJson('creations', creatingRecords);

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

  // --- fm.teal.* listening (best effort) ------------------------------------
  const listening = await safe(
    'listRecords:listening',
    () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.listen, max: 100 }),
    [],
  );
  await writeJson('listening', listening);

  // --- Unified feed ---------------------------------------------------------
  const unified = [];
  for (const r of nowRecords) unified.push(toFeedItem('logging', r));
  for (const r of blogRecords) unified.push(toFeedItem('blogging', r));
  for (const r of leafletRecords) unified.push(toFeedItem('blogging', r));
  for (const r of creatingRecords) unified.push(toFeedItem('creating', r));
  for (const r of listening) unified.push(toFeedItem('listening', r));
  for (const item of authorFeed) {
    const f = blueskyPostToFeedItem(item);
    if (f) unified.push(f);
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

  // --- Snapshot meta --------------------------------------------------------
  await writeJson('snapshot-meta', {
    builtAt: new Date().toISOString(),
    pds,
    appview: APPVIEW,
    did: ME_DID,
    counts: {
      posts: authorFeed.length,
      now: nowRecords.length,
      blogs: blogRecords.length,
      leaflets: leafletRecords.length,
      creations: creatingRecords.length,
      pages: Object.keys(pages).length,
      listening: listening.length,
      unified: unified.length,
    },
    ok: true,
  });

  log('done');
}

main().catch((err) => {
  console.error('[prefetch] fatal', err);
  process.exitCode = 1;
});
