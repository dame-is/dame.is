#!/usr/bin/env node
// Build-time data fetcher.
//
// Reads from the AppView (Bluesky) + the user's PDS (resolved via plc.directory)
// and writes JSON snapshots into public/data/. Each snapshot is also merged
// into `unifiedFeed.json` for the home page.
//
// Run with: `node scripts/prefetch.mjs`
//
// The actual feed shaping + orchestration logic now lives in
// `src/lib/feedBuilder.js`, which is shared with the browser so the home
// page can re-run the same fetch on mount and surface records authored
// after the most recent build.
//
// Designed to never throw fatally — `buildUnifiedFeed` swallows
// per-collection errors so a missing or renamed lexicon (e.g. teal.fm)
// degrades to an empty array.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ME_DID, COLLECTIONS, APPVIEW } from '../src/config.js';
import {
  resolvePds,
  getProfile,
  listRecords,
  getRecord,
} from '../src/lib/atproto.js';
import { VERB_REGISTRY } from '../src/lib/verbRegistry.js';
import {
  buildUnifiedFeed,
  backfillTimestamps,
  shouldWriteCombinedVerbFile,
} from '../src/lib/feedBuilder.js';

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
  const extendedProfile = await safe(
    'extendedProfile',
    async () =>
      getRecord(pds, {
        repo: ME_DID,
        collection: COLLECTIONS.profile,
        rkey: 'self',
      }),
    null,
  );
  if (extendedProfile?.value) {
    const v = extendedProfile.value;
    if (!v.updatedAt && v.createdAt) v.updatedAt = v.createdAt;
  }
  await writeJson('extendedProfile', extendedProfile || {});

  // --- is.dame.page (pages keyed by rkey) -----------------------------------
  const pageRecords = backfillTimestamps(
    await safe(
      'listRecords:page',
      () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.page, max: 100 }),
      [],
    ),
  );
  const pages = {};
  for (const r of pageRecords) {
    const m = String(r.uri || '').match(/\/([^/]+)$/);
    if (m) pages[m[1]] = r;
  }
  await writeJson('pages', pages);

  // --- Registry-driven ingest (delegated to the shared builder) -------------
  const { unified, perCollection, perVerb, authorFeed, counts } = await buildUnifiedFeed({
    pds,
    me: ME_DID,
    appview: APPVIEW,
    options: { log, warn },
  });

  await writeJson('posts', authorFeed);

  for (const [name, records] of Object.entries(perCollection)) {
    await writeJson(name, records);
  }

  // Multi-collection verbs also write a combined `<verb>.json` for
  // page-level consumers that want everything at once.
  for (const verbConfig of VERB_REGISTRY) {
    if (!shouldWriteCombinedVerbFile(verbConfig)) continue;
    const items = perVerb[verbConfig.verb] || [];
    await writeJson(verbConfig.verb, items);
  }

  await writeJson('unifiedFeed', unified);

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
