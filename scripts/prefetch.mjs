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

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ME_DID, COLLECTIONS, APPVIEW, INATURALIST_USER, RATIOED_PATH } from '../src/config.js';
import {
  resolvePds,
  getProfile,
  listRecords,
  getRecord,
  rkeyFromAtUri,
} from '../src/lib/atproto.js';
import { fetchMothData } from '../src/lib/inaturalist.js';
import { fetchGuestbookEntries } from '../src/lib/guestbook.js';
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
import { compareIsoDesc } from '../src/lib/time.js';
import { selfThreadMembers } from '../src/lib/threadGrouping.js';
import { isDraft, showOnBlog, showOnCreating, workSlug } from '../src/lib/publications.js';
import { rosterFromEvents, mergeRoster } from '../src/lib/ratioedRoster.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'public/data');
const PUBLIC = resolve(ROOT, 'public');

// Canonical origin — the base for sitemap / feed URLs, and the fallback source
// for the empty-snapshot guard on CI (where public/data is gitignored).
const SITE_ORIGIN = 'https://dame.is';

// §6.1: the Home page paints ≤100 items and refreshes live, so the static seed
// only needs the most-recent slice — not the full per-collection caps (which
// ballooned unifiedFeed.json to ~6 MB).
const HOME_SNAPSHOT_MAX = 150;

const log = (...args) => console.log('[prefetch]', ...args);
const warn = (...args) => console.warn('[prefetch]', ...args);

// §8.3: snapshots we refused to overwrite with a suspiciously-empty fetch
// (prior data was carried forward instead). Non-empty ⇒ this build is degraded,
// which is surfaced as `ok:false` in snapshot-meta.
const preservedSnapshots = [];

function snapshotCount(data) {
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.records)) return data.records.length;
  if (Array.isArray(data?.entries)) return data.entries.length;
  return null;
}

// The last-known-good snapshot for `name`: the local file if present (an
// incremental local run), otherwise the currently-deployed copy (on CI the
// public/data dir is gitignored, so the local file won't exist and we fall back
// to production so the new build can carry good data forward). Returns null when
// neither is available.
async function previousSnapshotData(name, path) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    /* no local file — try the deployed copy below */
  }
  try {
    const init =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? { signal: AbortSignal.timeout(10_000) }
        : undefined;
    const res = await fetch(`${SITE_ORIGIN}/data/${name}.json`, init);
    if (res.ok) return await res.json();
  } catch {
    /* deployed fetch failed — treat as no prior data */
  }
  return null;
}

/**
 * Write a snapshot, and RETURN WHAT WAS WRITTEN.
 *
 * The return value matters: the guard below can decide to keep the previous
 * snapshot instead of the new one, and callers that go on to build something
 * else out of the same array — sitemap.xml, feed.xml — were using their own
 * copy, the one the guard had just rejected. So a failed read preserved
 * blogs.json and still shipped an Atom feed with no entries in it.
 *
 * `minRatio` is the second half of the guard. Zero is not the only bad answer:
 * the ratioed roster is written from a bundle when a live read fails, which is
 * 135 entries against 275 — a number that passes any is-it-empty test while
 * silently dropping every participant of the last six pieces.
 */
async function writeJson(name, data, { guardEmpty = false, minRatio = 0 } = {}) {
  await mkdir(OUT, { recursive: true });
  const path = resolve(OUT, `${name}.json`);
  const newCount = snapshotCount(data);

  // §8.3: never overwrite a healthy snapshot with a suspiciously-empty one. A
  // transient upstream failure can yield 0 items; if the previous snapshot had
  // many, carry the prior data forward and flag the build as degraded rather
  // than shipping thin content for up to 6h.
  if (guardEmpty || minRatio > 0) {
    const prev = await previousSnapshotData(name, path);
    const prevCount = snapshotCount(prev);
    const floor = minRatio > 0 ? Math.floor((prevCount || 0) * minRatio) : 0;
    const tooSmall = newCount === 0 || (minRatio > 0 && newCount < floor);
    if (prevCount > 0 && tooSmall) {
      warn(
        `refusing to overwrite ${name}.json with ${newCount} items — previous snapshot had ` +
          `${prevCount}. Carrying prior data forward and marking meta ok:false.`,
      );
      await writeFile(path, JSON.stringify(prev, null, 2) + '\n', 'utf-8');
      preservedSnapshots.push({ name, prevCount, rejected: newCount });
      return prev;
    }
  }

  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  log(`wrote ${name}.json (${newCount == null ? '—' : newCount})`);
  return data;
}

async function writePublicFile(name, content) {
  await mkdir(PUBLIC, { recursive: true });
  await writeFile(resolve(PUBLIC, name), content, 'utf-8');
  log(`wrote ${name}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry only transient failures — a network error/timeout (no HTTP status) or a
// 5xx/429. A definitive 4xx (e.g. the 404 getRecord returns until a singleton
// record exists) is a real answer, so we don't waste attempts on it.
function isRetryable(err) {
  const status = err?.status;
  if (typeof status === 'number') return status >= 500 || status === 429;
  return true;
}

// §8.3: wrap each network read in a short retry-with-backoff so a single
// transient blip doesn't degrade the snapshot. Still swallows the final failure
// (returns `fallback`) so one bad endpoint never fails the whole build.
async function safe(label, fn, fallback, { attempts = 3, baseDelayMs = 400 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts && isRetryable(err)) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        warn(`${label} failed (attempt ${attempt}/${attempts}): ${err?.message || err} — retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      break;
    }
  }
  warn(`${label} failed:`, lastErr?.message || lastErr);
  return fallback;
}

// --- Per-filter chip counts (mirrors FeedFilters.feedFilterCounts) ----------
// Kept in sync with src/components/FeedFilters.jsx; replicated here (rather than
// imported) because that module is JSX and can't load in this plain-Node build.
// Preserved into snapshot-meta so trimming unifiedFeed.json (§6.1) doesn't cost
// the client its estimated per-verb counts.
function feedFilterCounts(items, myDid = null) {
  const continuing = myDid ? selfThreadMembers(items, myDid) : null;
  const out = {};
  for (const item of items || []) {
    if (item?.verb === 'posting') {
      const isStandaloneReply =
        Boolean(item.payload?.reply?.parent?.uri) && !continuing?.has(item.atUri);
      const k = isStandaloneReply ? 'replying' : 'posting';
      out[k] = (out[k] || 0) + 1;
    } else if (item?.verb) {
      out[item.verb] = (out[item.verb] || 0) + 1;
    }
  }
  return out;
}

/**
 * Regenerate the Ratioed participant roster from the pieces on the PDS.
 *
 * The bundled roster covers the pieces that were harvested offline and stays
 * authoritative for them. A piece measured in the admin panel carries its own
 * event log, so the people in it can be folded in here — otherwise a new piece
 * shows its own chart correctly while nobody who took part appears in the list
 * of participants until someone re-runs the harvest by hand.
 *
 * Display names aren't in an event log, so new people are looked up once. A
 * failed lookup just leaves the name blank; the handle is what the table leads
 * with anyway.
 */
async function writeRatioedRoster(records) {
  // Read rather than import: an import attribute (`with { type: 'json' }`) is
  // fine for Node but the lint parser can't see past it.
  const bundled = JSON.parse(
    await readFile(resolve(ROOT, 'src/data/ratioedPeople.json'), 'utf8'),
  );
  // The raw record values: rosterFromEvents reads only the fields an event log
  // carries verbatim, so there's nothing to normalize first.
  const derived = rosterFromEvents((records || []).map((r) => r?.value).filter(Boolean));
  if (derived.length === 0) {
    // Guarded, because "the bundle" is a real answer of 135 entries and the
    // deployed roster is 275. A failed piece read landed here, wrote the
    // bundle over the snapshot, and dropped every participant of takes 12–17 —
    // and `guardEmpty` alone could never catch it, since 135 is not zero.
    log('ratioed roster: no recorded event logs; keeping the bundled roster');
    await writeJson('ratioedPeople', bundled, { minRatio: 0.9 });
    return;
  }
  const merged = mergeRoster(bundled, derived);

  // Names the last build already resolved, carried forward before anything is
  // fetched. Two things follow from this. A getProfiles failure now costs a
  // name nobody had yet rather than every name on the roster — nothing here
  // carried a name forward, so a single 429 blanked up to 25 of them. And the
  // fetch below asks only about people with no name at all, where it used to
  // re-ask about every DID outside the bundle on every single build.
  const prior = await previousSnapshotData('ratioedPeople', resolve(OUT, 'ratioedPeople.json'));
  const priorNames = new Map(
    (Array.isArray(prior) ? prior : []).filter((p) => p?.did && p.dn).map((p) => [p.did, p.dn]),
  );
  for (const p of merged) if (!p.dn && priorNames.has(p.did)) p.dn = priorNames.get(p.did);

  const unnamed = merged.filter((p) => !p.dn && p.did?.startsWith('did:'));
  if (unnamed.length) {
    const names = await safe(
      'getProfiles:ratioedRoster',
      () => fetchDisplayNames(unnamed.map((p) => p.did)),
      {},
    );
    for (const p of unnamed) if (names[p.did]) p.dn = names[p.did];
  }
  log(
    `ratioed roster: ${bundled.length} bundled + ${merged.length - bundled.length} new = ${merged.length}` +
      ` · ${unnamed.length} name${unnamed.length === 1 ? '' : 's'} to look up`,
  );
  // Same guard on the happy path: a partial read that yields a few pieces
  // still produces a merged roster, just a much smaller one.
  await writeJson('ratioedPeople', merged, { minRatio: 0.9 });
}

/** DID → display name, 25 at a time (the appview's limit). */
async function fetchDisplayNames(dids) {
  const out = {};
  const real = dids.filter((d) => d && d.startsWith('did:'));
  for (let i = 0; i < real.length; i += 25) {
    const params = new URLSearchParams();
    for (const did of real.slice(i, i + 25)) params.append('actors', did);
    const res = await fetch(`${APPVIEW}/xrpc/app.bsky.actor.getProfiles?${params}`);
    // Thrown rather than skipped: `continue` meant the `safe()` wrapper around
    // this never saw a failure and its backoff never fired, so one 429 blanked
    // up to 25 display names and the build log read clean.
    if (!res.ok) throw new Error(`getProfiles HTTP ${res.status}`);
    const body = await res.json();
    for (const p of body?.profiles || []) if (p?.did && p?.displayName) out[p.did] = p.displayName;
  }
  return out;
}

// --- Discoverability: sitemap.xml + Atom feed -------------------------------
const SITEMAP_SURFACES = [
  '/',
  '/themself',
  '/available',
  '/blogging',
  '/creating',
  '/curating',
  '/posting',
  '/logging',
  '/listening',
  '/mothing',
  '/sharing',
  '/welcoming',
];

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoOrNull(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function sitemapUrl(path, lastmod) {
  const loc = xmlEscape(`${SITE_ORIGIN}${path}`);
  const mod = isoOrNull(lastmod);
  return `  <url>\n    <loc>${loc}</loc>${mod ? `\n    <lastmod>${mod}</lastmod>` : ''}\n  </url>`;
}

// Robust by design: any missing snapshot just contributes fewer <url>s.
function buildSitemap({ blogRecords, creatingRecords, curatingChannels, ratioedPieces, builtAt }) {
  const entries = [];
  const seen = new Set();
  const push = (path, lastmod) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    entries.push(sitemapUrl(path, lastmod));
  };

  for (const path of SITEMAP_SURFACES) push(path, path === '/' ? builtAt : null);

  for (const r of blogRecords || []) {
    const v = r?.value;
    if (!v || isDraft(v) || !showOnBlog(v)) continue;
    const rkey = rkeyFromAtUri(r.uri);
    if (!rkey) continue;
    push(`/blogging/${encodeURIComponent(rkey)}`, v.publishedAt || v.updatedAt || v.createdAt);
  }

  for (const r of creatingRecords || []) {
    const v = r?.value;
    if (!v || isDraft(v)) continue;
    const slug = workSlug(v) || rkeyFromAtUri(r.uri);
    if (!slug) continue;
    push(`/creating/${encodeURIComponent(slug)}`, v.updatedAt || v.createdAt);
  }

  // Each Ratioed piece has a page of its own, addressed by take number — the
  // form the site links to and the one the middleware calls canonical, so the
  // sitemap must agree or the two send crawlers to different addresses for the
  // same piece.
  for (const r of ratioedPieces || []) {
    const take = r?.value?.take;
    if (!take) continue;
    push(
      `/creating/${RATIOED_PATH}/${String(take).padStart(2, '0')}`,
      r.value.measuredAt || r.value.sealedAt || null,
    );
  }

  for (const g of curatingChannels || []) {
    if (!g?.slug) continue;
    push(`/curating/${encodeURIComponent(g.slug)}`, g.updatedAt || null);
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.join('\n') +
    `\n</urlset>\n`
  );
}

// Atom 1.0 blog feed. Drafts / non-blog docs are filtered exactly as the blog
// index does (isDraft + showOnBlog); newest first.
function buildAtomFeed({ blogRecords, builtAt }) {
  const posts = (blogRecords || [])
    .filter((r) => r?.value && !isDraft(r.value) && showOnBlog(r.value))
    .map((r) => {
      const v = r.value;
      const rkey = rkeyFromAtUri(r.uri);
      return {
        rkey,
        title: v.title || rkey || 'Untitled',
        summary: v.description || v.summary || '',
        published: v.publishedAt || v.createdAt || null,
        updated: v.updatedAt || v.publishedAt || v.createdAt || null,
      };
    })
    .filter((p) => p.rkey)
    .sort((a, b) => compareIsoDesc(a.published || a.updated, b.published || b.updated));

  const feedUpdated =
    isoOrNull(posts[0]?.updated) || isoOrNull(builtAt) || new Date().toISOString();

  const entries = posts.map((p) => {
    const url = `${SITE_ORIGIN}/blogging/${encodeURIComponent(p.rkey)}`;
    const updated = isoOrNull(p.updated) || isoOrNull(p.published) || feedUpdated;
    const published = isoOrNull(p.published);
    return (
      `  <entry>\n` +
      `    <title>${xmlEscape(p.title)}</title>\n` +
      `    <link rel="alternate" type="text/html" href="${xmlEscape(url)}"/>\n` +
      `    <id>${xmlEscape(url)}</id>\n` +
      `    <updated>${updated}</updated>\n` +
      (published ? `    <published>${published}</published>\n` : '') +
      (p.summary ? `    <summary>${xmlEscape(p.summary)}</summary>\n` : '') +
      `  </entry>`
    );
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `  <title>dame.is — blogging</title>\n` +
    `  <subtitle>Blog posts from dame.is</subtitle>\n` +
    `  <link rel="alternate" type="text/html" href="${SITE_ORIGIN}/blogging"/>\n` +
    `  <link rel="self" type="application/atom+xml" href="${SITE_ORIGIN}/feed.xml"/>\n` +
    `  <id>${SITE_ORIGIN}/</id>\n` +
    `  <updated>${feedUpdated}</updated>\n` +
    `  <author><name>dame</name></author>\n` +
    (entries.length ? entries.join('\n') + '\n' : '') +
    `</feed>\n`
  );
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

  // --- Live state (is.dame.state append log) --------------------------------
  // Newest-first snapshot of the vitals log. The atmosphere-bar vitals panel
  // paints from the latest record (index 0) then refreshes live; the rest is
  // recent history, on hand for a future charts view without a rebuild. Capped
  // so the snapshot stays small (the PDS keeps the full series). Empty until
  // the first push exists — `safe` keeps the build going.
  const stateLog = backfillTimestamps(
    await safe(
      'listRecords:state',
      () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.state, max: 200 }),
      [],
    ),
  );
  await writeJson('state', stateLog);

  // --- Nav menu override (is.dame.nav/self) ---------------------------------
  // Optional PDS override for the dock-sheet route list; snapshotted so the
  // menu paints the right routes on first load. getRecord 404s until one
  // exists — `safe` degrades it to {} and the site uses its hardcoded routes.
  const navRecord = await safe(
    'getRecord:nav',
    () => getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.nav, rkey: 'self' }),
    null,
  );
  await writeJson('nav', navRecord || {});

  // --- Sky theme override (is.dame.sky/self) --------------------------------
  // Optional PDS override for the hour-tracking sky palette; snapshotted so the
  // first paint picks up the tuning without waiting on the live record. getRecord
  // 404s until one exists — `safe` degrades it to {} and the built-in palette stands.
  const skyRecord = await safe(
    'getRecord:sky',
    () => getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.sky, rkey: 'self' }),
    null,
  );
  await writeJson('sky', skyRecord || {});

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

  // --- Ratioed (is.dame.creating.ratioed.piece) -----------------------------
  // Per-piece measurements embedded in the Ratioed essay. The charts ship with
  // a bundled seed and fall back to it, so an empty snapshot is harmless — this
  // only saves the round-trip on first paint.
  const ratioedPieces = await safe(
    'listRecords:ratioedPiece',
    () => listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.ratioedPiece, max: 100 }),
    [],
  );
  // Guarded like every other snapshot, and the guarded value is what the
  // sitemap is built from below: without this, a failed read dropped all
  // seventeen /creating/ratioed/NN URLs while snapshot-meta still said ok.
  const ratioedWritten = await writeJson('ratioed', ratioedPieces, { guardEmpty: true });
  await writeRatioedRoster(ratioedPieces);

  // The prose on a piece's page, edited in the studio and read here so the page
  // paints the artist's wording rather than the build's built-ins and then
  // swapping. Absent is the ordinary state until something is rewritten, and it
  // costs nothing: every field falls back to the sentence the site ships with.
  const ratioedCopy = await safe(
    'getRecord:ratioedCopy',
    () => getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.ratioedCopy, rkey: 'self' }),
    null,
  );
  await writeJson('ratioedCopy', ratioedCopy || { value: {} });

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

  // --- Guestbook (Constellation backlinks → signatures) ---------------------
  // Not from my PDS: every signature lives on the SIGNER's own repo, and the
  // book is reassembled at read time (backlink index → record hydration →
  // profiles — see src/lib/guestbook.js). That's several round-trips deep, so
  // /welcoming opened on a skeleton every time. Snapshotting the first page
  // here lets the page paint at once; the browser re-runs the same walk on
  // visit and slides in anything signed since this build.
  //
  // The page written here is exactly what `fetchGuestbookEntries()` returns —
  // including the entries the host has hidden and the ones the language filter
  // flags, both marked as such. That's the same payload the browser already
  // downloads on every visit (the curating happens at render), so the snapshot
  // discloses nothing the live page doesn't.
  const guestbookPage = await safe(
    'fetchGuestbookEntries',
    async () => {
      const page = await fetchGuestbookEntries();
      // `null` means the backlink index is unreachable — a transient failure,
      // not an empty book, so throw and let `safe` retry it.
      if (!page) throw new Error('backlink index unreachable');
      return page;
    },
    null,
  );
  if (guestbookPage) {
    // Signer profiles come from the AppView, which can rate-limit a build box.
    // Losing them isn't fatal — those rows paint by DID until the live read
    // fills the names in — but it's worth seeing in the build log.
    const named = guestbookPage.entries.filter((e) => e.profile).length;
    log(`guestbook: ${guestbookPage.entries.length} signature(s), ${named} with profiles`);
    // A profileViewDetailed is mostly fields a signature row never shows
    // (banner, counts, viewer state, description) — three quarters of the
    // snapshot's weight. Keep the three a row reads; the live read carries the
    // full thing for anything that ever wants it. Same spirit as `leanMedia`.
    guestbookPage.entries = guestbookPage.entries.map((entry) => ({
      ...entry,
      profile: entry.profile
        ? {
            did: entry.profile.did,
            handle: entry.profile.handle,
            displayName: entry.profile.displayName,
            avatar: entry.profile.avatar,
          }
        : null,
    }));
  }
  await writeJson(
    'guestbook',
    { builtAt: new Date().toISOString(), ...(guestbookPage || { entries: [] }) },
    { guardEmpty: true },
  );

  // --- Registry-driven ingest (delegated to the shared builder) -------------
  const { unified, perCollection, perVerb, authorFeed, counts } = await buildUnifiedFeed({
    pds,
    me: ME_DID,
    appview: APPVIEW,
    // leanMedia: keep the big inline PNG/SVG data-URLs out of the static
    // snapshot JSON (the live in-memory feed and the record page still show
    // the real media).
    options: { log, warn, leanMedia: true },
  });

  await writeJson('posts', authorFeed, { guardEmpty: true });

  // What landed on disk, which is not always what was fetched: the guard can
  // decide to keep the previous snapshot. The XML below is built from these
  // rather than from the fetched arrays — it has no bundled seed and nothing
  // corrects it at runtime, so a failed read used to preserve blogs.json and
  // still ship an Atom feed with zero entries to every subscriber.
  const written = {};
  for (const [name, records] of Object.entries(perCollection)) {
    written[name] = await writeJson(name, records, { guardEmpty: true });
  }

  // Multi-collection verbs also write a combined `<verb>.json` for
  // page-level consumers that want everything at once.
  for (const verbConfig of VERB_REGISTRY) {
    if (!shouldWriteCombinedVerbFile(verbConfig)) continue;
    const items = perVerb[verbConfig.verb] || [];
    await writeJson(verbConfig.verb, items, { guardEmpty: true });
  }

  // §6.1: Home paints ≤100 items and refreshes live, so the static seed only
  // needs the most-recent slice. `unified` is already sorted newest-first, so a
  // head slice is the most-recent N by timestamp. The item SHAPE is unchanged —
  // only the count shrinks (from full per-collection caps to ~150).
  const homeFeed = unified.slice(0, HOME_SNAPSHOT_MAX);
  await writeJson('unifiedFeed', homeFeed, { guardEmpty: true });

  // --- Discoverability: sitemap.xml + Atom feed -----------------------------
  // Generated from the snapshots already in hand. Blog posts live in the
  // `blogs` snapshot (site.standard.document); creative works are the legacy
  // `creations` plus any portfolio-/cross-posted standard doc; curating
  // channels are the enabled are.na galleries.
  const blogRecords = Array.isArray(written.blogs) ? written.blogs : [];
  const creationRecords = Array.isArray(written.creations) ? written.creations : [];
  const creatingRecords = [
    ...blogRecords.filter((r) => showOnCreating(r?.value)),
    ...creationRecords,
  ];
  const builtAt = new Date().toISOString();
  await safe(
    'sitemap',
    () =>
      writePublicFile(
        'sitemap.xml',
        buildSitemap({
          blogRecords,
          creatingRecords,
          curatingChannels: galleries,
          ratioedPieces: Array.isArray(ratioedWritten) ? ratioedWritten : ratioedPieces,
          builtAt,
        }),
      ),
    null,
  );
  await safe(
    'feed',
    () => writePublicFile('feed.xml', buildAtomFeed({ blogRecords, builtAt })),
    null,
  );

  // --- Snapshot meta --------------------------------------------------------
  await writeJson('snapshot-meta', {
    builtAt: new Date().toISOString(),
    pds,
    appview: APPVIEW,
    did: ME_DID,
    counts,
    // §6.1: unifiedFeed.json is trimmed to the most-recent HOME_SNAPSHOT_MAX
    // items, so estimated chip counts derived from it would undercount. Preserve
    // the FULL per-filter counts (over the untrimmed feed) here so a client can
    // read exact estimates without loading the heavy snapshot. Keys match
    // FeedFilters.feedFilterCounts (verb names + `replying`).
    feedCounts: feedFilterCounts(unified, ME_DID),
    homeFeedCount: homeFeed.length,
    // §8.3: snapshots kept from a prior good build instead of an empty fetch.
    preserved: preservedSnapshots,
    ok: preservedSnapshots.length === 0,
  });

  log('done');
}

main().catch((err) => {
  console.error('[prefetch] fatal', err);
  process.exitCode = 1;
});
