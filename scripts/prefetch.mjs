#!/usr/bin/env node
// Build-time data fetcher.
//
// Reads from the AppView (Bluesky) + the user's PDS (resolved via plc.directory)
// and writes JSON snapshots into public/data/. Triggered on every deploy
// (`npm run build`) and on a 6-hour Vercel cron via `api/rebuild.js`.
//
// Run with: `node scripts/prefetch.mjs`
//
// What the snapshots are for: a fast-first-paint cache and a network-
// failure fallback — NOT the runtime source of truth. Every PDS-backed
// page in `src/pages/` refreshes live in the browser via `useLiveFeed`
// (or `useAtUri`) and overlays / replaces the snapshot data once the
// live fetch resolves. The cron keeps the snapshot baseline within
// ~6 hours of the PDS so first paint is never wildly stale.
//
// Two strategies live on top of these snapshots:
//   - Feeds (Home, Posting, Logging) use 'live-first': skeleton during
//     fetch, snapshot only as a fallback when the live fetch errors.
//   - Static-ish surfaces (About, Sharing, Blogging, Creating, etc.)
//     use 'snapshot-first': instant paint from the snapshot, live
//     overlay swaps in within a beat.
//
// The actual feed shaping + orchestration logic lives in
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

import { ME_DID, COLLECTIONS, APPVIEW, INATURALIST_USER } from '../src/config.js';
import {
  resolvePds,
  getProfile,
  listRecords,
  getRecord,
} from '../src/lib/atproto.js';
import { fetchMothData } from '../src/lib/inaturalist.js';
import { VERB_REGISTRY } from '../src/lib/verbRegistry.js';
import {
  fetchChannelMeta,
  fetchAllBlocks,
  arenaAccessToken,
  pickCoverThumb,
  arenaText,
} from '../src/lib/arena.js';
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

  // --- Hero phrases (is.dame.hero.phrase) -----------------------------------
  const heroPhrases = await safe(
    'listRecords:heroPhrase',
    () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.heroPhrase, max: 200 }),
    [],
  );
  await writeJson('hero', heroPhrases);

  // --- Resume (is.dame.resume + backlinked jobs + education) ----------------
  // One combined snapshot so /resume paints instantly; the page re-fetches
  // all three collections live and resolves the backlinks in the browser.
  const [resumes, resumeJobs, resumeEducation] = await Promise.all([
    safe('listRecords:resume', () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.resume, max: 50 }), []),
    safe('listRecords:resumeJob', () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.resumeJob, max: 200 }), []),
    safe('listRecords:resumeEducation', () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.resumeEducation, max: 100 }), []),
  ]);
  await writeJson('resume', {
    builtAt: new Date().toISOString(),
    resumes,
    jobs: resumeJobs,
    education: resumeEducation,
  });

  // --- Curating (is.dame.arena.channel → are.na gallery snapshots) ----------
  // Guest tier is 30 req/min; an ARENA_ACCESS_TOKEN (read-only personal
  // token, set in the Vercel env) unlocks the account tier, so the
  // inter-request spacing adapts to whichever budget we have.
  const arenaAuthed = Boolean(arenaAccessToken());
  const arenaDelayMs = arenaAuthed ? 250 : 2100;
  const arenaChannelRecords = await safe(
    'listRecords:arenaChannel',
    () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.arenaChannel, max: 100 }),
    [],
  );
  const enabledGalleries = arenaChannelRecords
    .map((r) => ({ rkey: String(r.uri || '').split('/').pop(), value: r.value || {} }))
    .filter((g) => g.rkey && g.value.arenaSlug && g.value.enabled !== false)
    .sort((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0));
  log(`arena: ${enabledGalleries.length} enabled channel(s), auth=${arenaAuthed}`);

  const galleries = [];
  for (const g of enabledGalleries) {
    const snap = await safe(
      `arena:${g.value.arenaSlug}`,
      async () => {
        const meta = await fetchChannelMeta(g.value.arenaSlug);
        const { blocks, truncated } = await fetchAllBlocks(g.value.arenaSlug, {
          delayMs: arenaDelayMs,
        });
        return { meta, blocks, truncated };
      },
      null,
    );
    if (!snap) continue; // channel fetch failed → skip it; the build proceeds

    const gallery = {
      slug: g.rkey,
      arenaSlug: g.value.arenaSlug,
      title: g.value.title || arenaText(snap.meta?.title) || g.rkey,
      description: g.value.description || arenaText(snap.meta?.description) || '',
      blockCount: snap.blocks.length,
      cover: pickCoverThumb(snap.blocks, g.value.coverBlockId),
      order: g.value.order ?? 0,
      // Channel-level change marker: lets the client skip re-paginating
      // contents when the channel hasn't changed since this snapshot.
      updatedAt: snap.meta?.updated_at || null,
    };
    galleries.push(gallery);
    await writeJson(`curating-${g.rkey}`, {
      builtAt: new Date().toISOString(),
      gallery,
      truncated: snap.truncated,
      blocks: snap.blocks,
    });
  }
  // Written even when empty so the index page's snapshot never 404s.
  await writeJson('curating', { builtAt: new Date().toISOString(), galleries });

  // --- Mothing (iNaturalist) ------------------------------------------------
  // External API, not the PDS — but snapshotted the same way so /mothing
  // paints instantly and has a fallback if iNaturalist is unreachable at
  // runtime. Location data is stripped by `fetchMothData`.
  const mothing = await safe(
    'fetchMothData',
    () => fetchMothData({ user: INATURALIST_USER }),
    { user: INATURALIST_USER, stats: null, observations: [] },
  );
  await writeJson('mothing', { builtAt: new Date().toISOString(), ...mothing });

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
