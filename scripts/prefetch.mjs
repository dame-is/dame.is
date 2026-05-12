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
      author: {
        did: post.author?.did,
        handle: post.author?.handle,
        displayName: post.author?.displayName,
        avatar: post.author?.avatar,
      },
      replyCount: post.replyCount || 0,
      repostCount: post.repostCount || 0,
      likeCount: post.likeCount || 0,
      embed: post.record?.embed || post.embed || null,
      indexedAt: post.indexedAt,
      reason: item.reason || null,
    },
  };
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
