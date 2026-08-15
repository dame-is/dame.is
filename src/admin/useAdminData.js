// Front Desk data: the counts, the "needs you" derivations, and the newest
// records across the small collections.
//
// Three ground rules shaped every line of this file, and each of them was
// established by measuring the live repo rather than by reasoning about it:
//
//  1. **There is no count API in AT Protocol.** `listRecords` caps at limit=100
//     (limit=101 → `InvalidRequest … maximum 100`), its envelope carries no
//     `indexedAt` and no rev, and `describeRepo` returns collection names with no
//     counts. So a "count" here is literally "how many records came back in one
//     page", and a full page means the number is a floor, rendered `N+`. Nothing
//     is ever hardcoded — the dashboard has to stay honest as collections grow.
//  2. **No snapshot files.** `public/data/` is gitignored and is written only by
//     scripts/prefetch.mjs during `npm run build`; it does not exist in dev or in
//     `build:offline`, where `fetchSnapshot` returns null. The Front Desk reads
//     zero snapshot files.
//  3. **No invented state.** There is no "reviewed", "unread", "triaged" or
//     "stale" anywhere in this codebase, and adding one here would mean writing a
//     field onto a record that also drives a public page. Every number below is
//     derived from records actually fetched on this page load.
//
// The exhaustion test is `records.length < limit`, NOT `!cursor`. Verified live
// against the PDS twice: `site.standard.document` returns 27 records AND a
// cursor, and that cursor's page is empty. Trusting `!cursor` is what puts a
// phantom "Load more" under a short list.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readFeedCache, writeFeedCache, isCacheFresh } from '../lib/feedCache.js';
import { COLLECTIONS, GUESTBOOK_NSID, GUESTBOOK_SUBJECT } from '../config.js';
import { lexiconFor } from '../lib/lexicons.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { compareIsoDesc } from '../lib/time.js';
import { visibilityModelFor } from '../lib/recordVisibility.js';
import { isDraft, isPortfolioDoc } from '../lib/publications.js';
import { LEGACY_POSTS, migratedSlugs } from '../lib/legacyBlog.js';
import { knownPageSlugs } from '../lib/pageRegistry.js';
import { getBacklinkCount } from '../lib/constellation.js';
import { fetchGuestbookBook, GUESTBOOK_SOURCE } from '../lib/guestbook.js';
import { allSurfaces, surfaceByKey, rowHrefFor } from './surfaces.js';
import { latestInstant, rowLabel } from './recordFields.js';

const STANDARD_DOC = 'site.standard.document';

/** One page is the API maximum. A full page means "at least this many". */
const PAGE_LIMIT = 100;

/**
 * How many Tier-A requests may be in the air at once. Measured: this PDS served
 * 246 sequential requests unthrottled and returned no rate-limit headers, so
 * six-way concurrency over a dozen small collections is polite rather than
 * cautious. There is no client-side retry anywhere in src/ and this is not the
 * place to invent the first one — a failed count degrades to a ⚠ on one tile.
 */
const MAX_IN_FLIGHT = 6;

/** Rows in "Latest records". */
const LATEST_LIMIT = 8;

/**
 * Cache TTL. The in-memory `feedCache` is deliberately the store: it evaporates
 * on reload by design, which is the right lifetime for a number the owner glances
 * at a handful of times a day. NEVER localStorage — and note that `getLatestCommit`
 * is not an alternative invalidator either, because it is repo-wide and external
 * mirrors (is.dame.state, teal plays, iNaturalist, are.na) move this repo's rev
 * constantly without touching anything the admin shows.
 */
export const COUNTS_TTL_MS = 60_000;

const CACHE_PREFIX = 'admin:counts:';

/**
 * The guestbook's two numbers ride the same key space and the same TTL, so that
 * `invalidateCounts()` with no scope refreshes them too.
 */
const GUESTBOOK_KEY = `${CACHE_PREFIX}${GUESTBOOK_NSID}`;

/**
 * Ceiling on the guestbook's third-party hops. Unlike the Tier-A counts — which
 * go to the owner's own PDS through the authenticated agent — these cross
 * Constellation and Slingshot, and neither `fetchJson` in this tree carries a
 * timeout. A hung third party must degrade to "Guestbook index unavailable",
 * never to a tile that skeletons forever.
 */
const GUESTBOOK_DEADLINE_MS = 8000;

/** Shared empty array, so a memo dep does not change identity every render. */
const NO_RECORDS = Object.freeze([]);

/** Verbatim copy for the empty state, kept here so it cannot drift. */
export const NEEDS_YOU_EMPTY = 'Nothing needs you right now.';

/** Verbatim caption for "Latest records" — it explains a real data limitation. */
export const LATEST_CAPTION =
  'Newest first — by edit date where the record keeps one, otherwise by publication date. ' +
  'Documents carry no edit timestamp. Excludes logging, posting and listening.';

/**
 * @typedef {Object} CountEntry
 * @property {string} nsid
 * @property {number|null} count    How many records came back. null ⇒ the request failed.
 * @property {boolean} complete     false ⇒ a full page came back; render `count+`, never a bare number.
 * @property {Array<{uri:string,cid:string,value:object}>} records
 * @property {string|null} error
 * @property {number} fetchedAt     0 ⇒ deliberately not cached (an error, so the next mount retries).
 */

/**
 * @typedef {Object} DeskTile
 * @property {number|null} value    null while loading, or when the number is unavailable.
 * @property {boolean} complete     false ⇒ render `value+`.
 * @property {boolean} loading
 * @property {string|null} error
 */

/**
 * @typedef {Object} NeedsYouItem
 * @property {string} id
 * @property {'work'|'check'} kind  Work is something to act on; a check should always read zero.
 * @property {number} count
 * @property {string} label         Already pluralised and ready to render.
 * @property {string} href
 * @property {Array<{key:string,label:string,href:string}>|null} rows  Per-record links, when the
 *                                  item has them (only `drafts` does today).
 */

/* ------------------------------------------------------------------ */
/* Tier A — which collections may be counted at all                     */
/* ------------------------------------------------------------------ */

let countedCache = null;

/**
 * Every NSID the dashboard will count, deduped and in registry order.
 *
 * Derived from the registry's `countable` flag, never listed by hand: that flag
 * already encodes "small enough to count in one request, and living in this
 * repo". Blogging + Creating share one NSID and Ratioed studio + catalogue share
 * another, so the dedupe is what keeps this at ~a dozen requests.
 *
 * @returns {string[]}
 */
export function countedNsids() {
  if (!countedCache) {
    const out = [];
    for (const s of allSurfaces()) {
      if (!s.countable || !s.nsid) continue;
      if (!out.includes(s.nsid)) out.push(s.nsid);
    }
    countedCache = Object.freeze(out);
  }
  return countedCache;
}

/* ------------------------------------------------------------------ */
/* Cache, in-flight de-duplication, invalidation                        */
/* ------------------------------------------------------------------ */

// One promise per cache key, so two mounted consumers (the Front Desk and the
// rail, which both want counts) share a single request instead of racing.
const inflight = new Map();

// Bumped on invalidate. A request that was already in the air when a record was
// deleted must not land afterwards and re-freshen the pre-delete number for
// another minute, so it checks its generation before writing to the cache.
const generations = new Map();

function generationOf(key) {
  return generations.get(key) || 0;
}

/**
 * Drop cached counts so the next read refetches. `feedCache` exports no delete —
 * it is read-only to us — so an entry with `fetchedAt: 0` is the eviction: it
 * fails `isCacheFresh` for any TTL without touching that module.
 *
 * Because the key is per-NSID, deleting one record invalidates only the
 * collection that changed rather than re-running the whole batch.
 *
 * This is the cache half of the shell's `invalidate(scope)`; the shell pairs it
 * with a `dataRev` bump so mounted consumers re-read.
 *
 * @param {string|string[]|null} [scope] One NSID, several, or null for everything.
 */
export function invalidateCounts(scope) {
  const keys = scope == null
    ? [...countedNsids(), GUESTBOOK_NSID]
    : Array.isArray(scope)
      ? scope
      : [scope];
  for (const nsid of keys) {
    const key = `${CACHE_PREFIX}${nsid}`;
    generations.set(key, generationOf(key) + 1);
    inflight.delete(key);
    writeFeedCache(key, { fetchedAt: 0 });
  }
}

/** Whatever is still fresh, so a remount inside the TTL paints numbers, not skeletons. */
function seedFromCache() {
  const seed = {};
  for (const nsid of countedNsids()) {
    const key = `${CACHE_PREFIX}${nsid}`;
    if (isCacheFresh(key, COUNTS_TTL_MS)) seed[nsid] = readFeedCache(key);
  }
  return seed;
}

/** Resolve `fallback` if `promise` has not settled within `ms`. */
function withDeadline(promise, ms, fallback) {
  let timer = null;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * One collection's count, from cache or from one `listRecords`.
 * Never rejects: a failure is a value, so `Promise.allSettled` over the pool can
 * only ever lose one tile.
 *
 * @returns {Promise<CountEntry>}
 */
function loadCount(agent, did, nsid) {
  const key = `${CACHE_PREFIX}${nsid}`;
  if (isCacheFresh(key, COUNTS_TTL_MS)) return Promise.resolve(readFeedCache(key));
  const existing = inflight.get(key);
  if (existing) return existing;

  const gen = generationOf(key);
  // Kicked off inside a `then` so that a SYNCHRONOUS throw — a malformed agent,
  // say — becomes a rejection this chain can turn into an error entry, rather
  // than an exception that escapes and takes the rest of its pool lane with it.
  const p = Promise.resolve()
    .then(() => agent.com.atproto.repo.listRecords({ repo: did, collection: nsid, limit: PAGE_LIMIT }))
    .then((res) => {
      const data = res?.data || res;
      const records = Array.isArray(data?.records) ? data.records : [];
      return {
        nsid,
        records,
        count: records.length,
        // A full page means there may be more. An empty page means the
        // collection is empty OR has never existed — listRecords answers 200
        // `{"records":[]}` either way, and the two are indistinguishable to the
        // owner as well, so one presentation ("no records yet") serves both.
        complete: records.length < PAGE_LIMIT,
        error: null,
        fetchedAt: Date.now(),
      };
    })
    .catch((err) => ({
      nsid,
      records: NO_RECORDS,
      count: null,
      complete: false,
      error: err?.message || String(err),
      // fetchedAt 0: a failure is remembered for display but never counts as
      // fresh, so remounting retries instead of showing a ⚠ for a full minute.
      fetchedAt: 0,
    }))
    .then((entry) => {
      inflight.delete(key);
      if (generationOf(key) === gen) writeFeedCache(key, entry);
      return entry;
    });

  inflight.set(key, p);
  return p;
}

/**
 * The guestbook's two numbers — and it is exactly two requests.
 *
 * NOT `fetchGuestbookEntries`, which is a Constellation walk plus one-to-two
 * requests per signer PDS plus profile hydration plus, once the modern book fits
 * in a page, the whole legacy book again: a floor of ~23 requests across three
 * third-party hosts, with two unbounded `Promise.all`s that would blow straight
 * through the six-in-flight pool above.
 *
 * @returns {Promise<{signatures:number|null, hiddenList:number|null, fetchedAt:number}>}
 */
function loadGuestbook() {
  if (isCacheFresh(GUESTBOOK_KEY, COUNTS_TTL_MS)) {
    return Promise.resolve(readFeedCache(GUESTBOOK_KEY));
  }
  const existing = inflight.get(GUESTBOOK_KEY);
  if (existing) return existing;

  const gen = generationOf(GUESTBOOK_KEY);
  const work = Promise.all([
    getBacklinkCount(GUESTBOOK_SUBJECT, GUESTBOOK_SOURCE).catch(() => null),
    fetchGuestbookBook().catch(() => null),
  ]);
  const p = withDeadline(work, GUESTBOOK_DEADLINE_MS, [null, null])
    .then(([counted, book]) => {
      // Constellation has answered under both field names; RatioedPanel already
      // reads it defensively the same way.
      const raw = counted?.total ?? counted?.count;
      const signatures = typeof raw === 'number' ? raw : null;
      // The book's `hidden` array is exact as a LIST LENGTH and approximate as a
      // count of hidden signatures: a hidden record whose signer has since
      // deleted it drops out of the backlink total while its at-uri lingers here.
      // Caption it "N on the hidden list", never "N hidden signatures".
      const hiddenList = Array.isArray(book?.value?.hidden)
        ? book.value.hidden.length
        : book
          ? 0
          : null;
      const unavailable = signatures == null && hiddenList == null;
      return { signatures, hiddenList, fetchedAt: unavailable ? 0 : Date.now() };
    })
    .then((entry) => {
      inflight.delete(GUESTBOOK_KEY);
      if (generationOf(GUESTBOOK_KEY) === gen) writeFeedCache(GUESTBOOK_KEY, entry);
      return entry;
    });

  inflight.set(GUESTBOOK_KEY, p);
  return p;
}

/**
 * Run `worker` over `items` with at most `limit` in flight. `allSettled`, not
 * `all`: one collection failing must never blank the dashboard.
 */
async function runPool(items, worker, limit = MAX_IN_FLIGHT) {
  let next = 0;
  const drain = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      try {
        await worker(items[i]);
      } catch {
        // A rejected worker must not take the rest of its lane down with it —
        // the remaining collections in this lane would never be requested at all.
      }
    }
  };
  const lanes = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) lanes.push(drain());
  await Promise.allSettled(lanes);
}

/**
 * Every Tier-A count, six requests at a time. Resolves to the full map once all
 * have settled; `onEntry(nsid, entry)` fires as each one lands, so a tile can
 * stop skeletoning as soon as its OWN number is in rather than waiting on the
 * slowest collection.
 *
 * @param {object} agent
 * @param {string} did
 * @param {(nsid: string, entry: CountEntry) => void} [onEntry]
 * @returns {Promise<Record<string, CountEntry>>}
 */
export async function fetchCounts(agent, did, onEntry) {
  const out = {};
  await runPool(countedNsids(), async (nsid) => {
    const entry = await loadCount(agent, did, nsid);
    out[nsid] = entry;
    if (onEntry) onEntry(nsid, entry);
  });
  return out;
}

/** The guestbook's two numbers. See loadGuestbook for why it is exactly two. */
export function fetchGuestbookCounts() {
  return loadGuestbook();
}

/* ------------------------------------------------------------------ */
/* Derivations                                                          */
/* ------------------------------------------------------------------ */

function tile({ value = null, complete = true, loading = false, error = null }) {
  return { value, complete, loading, error };
}

/** Values only, for the predicates in publications.js / recordVisibility.js. */
function valuesOf(entry) {
  return (entry?.records || NO_RECORDS).map((r) => r.value);
}

/**
 * The named surface a record belongs to, for the "surface" column on a Latest
 * row. Documents split on their publication exactly as the public site does;
 * everything else takes the first registry surface for its NSID that is
 * reachable without an `&r=`.
 *
 * @param {string} nsid
 * @param {object} value
 * @returns {import('./surfaces.js').AdminSurface|null}
 */
export function surfaceForRecord(nsid, value) {
  if (nsid === STANDARD_DOC) return surfaceByKey(isPortfolioDoc(value) ? 'creating' : 'blogging');
  const all = allSurfaces();
  return all.find((s) => s.nsid === nsid && !s.requiresRkey) || all.find((s) => s.nsid === nsid) || null;
}

/**
 * The four dashboard tiles. **Not one of them is a sum of surface counts.**
 * Surface counts are not a partition — Blogging and Creating split one collection
 * client-side, and publications.js lets a document cross-post onto both — so
 * adding them up would double-count exactly the records the owner cares most
 * about. Every document number therefore comes out of ONE fetched array, using
 * the same predicates the public site uses, so the two agree by construction.
 *
 * @param {Record<string, CountEntry>} entries
 * @param {{signatures:number|null,hiddenList:number|null}|null} guestbookEntry
 */
export function deriveTiles(entries, guestbookEntry) {
  const docsEntry = entries[STANDARD_DOC];
  const docValues = valuesOf(docsEntry);
  const draftCount = docValues.filter(isDraft).length;

  // Drafts and Hidden must describe DISJOINT sets. `site.standard.document`'s
  // visibility model IS the draft predicate, so folding documents into "hidden"
  // would report the same three records twice under two headings whose sum is
  // twice the number of affected records. Hence "Hidden ELSEWHERE", and hence
  // this list excluding documents.
  const hiddenNsids = [COLLECTIONS.arenaChannel, COLLECTIONS.heroPhrase, COLLECTIONS.resume];
  const hiddenEntries = hiddenNsids.map((nsid) => entries[nsid]);
  let hidden = 0;
  hiddenNsids.forEach((nsid, i) => {
    const model = visibilityModelFor(nsid);
    // Optional-chained on purpose: seven Tier-A collections have no visibility
    // model at all, and `.isHidden` on a null model is a TypeError, not a zero.
    for (const v of valuesOf(hiddenEntries[i])) if (model?.isHidden(v) ?? false) hidden += 1;
  });

  const docsLoading = !docsEntry;
  const docsError = docsEntry?.error || null;
  const hiddenLoading = hiddenEntries.some((e) => !e);
  const hiddenError = hiddenEntries.find((e) => e?.error)?.error || null;

  return {
    documentsPublished: tile({
      value: docsLoading || docsError ? null : docValues.length - draftCount,
      complete: docsEntry?.complete ?? true,
      loading: docsLoading,
      error: docsError,
    }),
    drafts: tile({
      value: docsLoading || docsError ? null : draftCount,
      complete: docsEntry?.complete ?? true,
      loading: docsLoading,
      error: docsError,
    }),
    hiddenElsewhere: tile({
      value: hiddenLoading || hiddenError ? null : hidden,
      complete: hiddenEntries.every((e) => !e || e.complete),
      loading: hiddenLoading,
      error: hiddenError,
    }),
    guestbook: {
      // "Backlink count, not entry count" — some backlinks never hydrate and are
      // dropped from any rendered list, so this is a ceiling on what you can act
      // on. Label it "signatures indexed".
      signatures: guestbookEntry?.signatures ?? null,
      hiddenList: guestbookEntry?.hiddenList ?? null,
      loading: !guestbookEntry,
      // Neither number is rendered as 0 when the index is unreachable — the tile
      // reads "Guestbook index unavailable" instead.
      available:
        !!guestbookEntry && (guestbookEntry.signatures != null || guestbookEntry.hiddenList != null),
    },
  };
}

/**
 * "Needs you" — every item derived from data already fetched, so the section
 * costs zero extra requests. An item is present only when its count is greater
 * than zero; when none are, the section says NEEDS_YOU_EMPTY.
 *
 * Deliberately NOT here: anything derived from the guestbook's `flagged` state.
 * `flagged` is recomputed per render by the language filter and is never
 * persisted, so an item built on it is not a queue — it would nag forever with
 * nothing the owner could do to clear it. The guestbook surface, where the full
 * walk already happens and the number is already computed, is where it belongs.
 * There is no "reviewed" / "unread" / "awaiting" state anywhere in this codebase,
 * and the record that would have to carry one also drives the public /welcoming.
 *
 * @param {Record<string, CountEntry>} entries
 */
export function deriveNeedsYou(entries) {
  const docsEntry = entries[STANDARD_DOC];
  const resumeEntry = entries[COLLECTIONS.resume];
  const pagesEntry = entries[COLLECTIONS.page];
  const pubsEntry = entries['site.standard.publication'];

  const work = [];
  const checks = [];

  const docs = docsEntry?.records || NO_RECORDS;
  const drafts = docs.filter((r) => isDraft(r.value));
  if (drafts.length > 0) {
    work.push({
      id: 'drafts',
      kind: 'work',
      count: drafts.length,
      label: `${drafts.length} ${drafts.length === 1 ? 'draft' : 'drafts'}`,
      href: '/admin?view=blogging',
      // Each row goes back to the surface the doc is homed on, so a portfolio
      // draft opens in Creating and a blog draft in Blogging.
      rows: drafts.map((rec) => {
        const rkey = rkeyFromAtUri(rec.uri);
        const surf = surfaceForRecord(STANDARD_DOC, rec.value);
        return {
          key: rec.uri,
          label: rowLabel(rec.value, STANDARD_DOC, lexiconFor(STANDARD_DOC)) || rkey,
          href: surf ? rowHrefFor(surf, rkey) : '/admin?view=blogging',
        };
      }),
    });
  }

  // Legacy posts are bundled at build time, so this costs nothing beyond the
  // document array already in hand. The guard matters: if that array came back
  // full the migrated set may be incomplete, and asserting work that is in fact
  // already done is worse than staying quiet.
  if (docsEntry && !docsEntry.error && docsEntry.complete) {
    const slugs = LEGACY_POSTS.map((p) => p.slug);
    const migrated = migratedSlugs(docs, slugs);
    const outstanding = slugs.filter((s) => !migrated.has(s)).length;
    if (outstanding > 0) {
      work.push({
        id: 'legacy-blogs',
        kind: 'work',
        count: outstanding,
        label: `${outstanding} legacy ${outstanding === 1 ? 'post' : 'posts'} not migrated`,
        href: '/admin?view=legacy-blogs',
        rows: null,
      });
    }
  }

  // Consistency checks: things that should always read zero. They render under
  // their own sub-heading so a permanently-empty check does not read as a broken
  // feature.
  const featured = valuesOf(resumeEntry).filter((v) => v?.featured).length;
  if (featured > 1) {
    checks.push({
      id: 'resume-featured',
      kind: 'check',
      count: featured,
      // The tripwire for a real latent bug: the workbench's `featured` checkbox
      // sets the flag without clearing its siblings, while the studio's "set
      // active" does clear them — and the public side takes first-featured-wins.
      label: 'More than one resume version is active',
      href: '/admin?view=resume',
      rows: null,
    });
  }

  const known = new Set(knownPageSlugs());
  const strayPages = (pagesEntry?.records || NO_RECORDS).filter(
    (r) => !known.has(rkeyFromAtUri(r.uri)),
  ).length;
  if (strayPages > 0) {
    checks.push({
      id: 'pages-unknown',
      kind: 'check',
      count: strayPages,
      label: `${strayPages} page ${strayPages === 1 ? 'record' : 'records'} outside the built-in surfaces`,
      href: '/admin?view=pages',
      rows: null,
    });
  }

  // The publication editor hard-refuses to SAVE one without a url, but an older
  // record can still lack it — and a publication with no url breaks the Standard
  // Site embed silently.
  const urllessPubs = valuesOf(pubsEntry).filter((v) => !v?.url).length;
  if (urllessPubs > 0) {
    checks.push({
      id: 'publications-no-url',
      kind: 'check',
      count: urllessPubs,
      label: `${urllessPubs} ${urllessPubs === 1 ? 'publication' : 'publications'} with no url`,
      href: '/admin?view=publications',
      rows: null,
    });
  }

  return {
    work,
    checks,
    items: [...work, ...checks],
    empty: work.length === 0 && checks.length === 0,
    // The empty line must not flash before the data lands.
    loading: !docsEntry || !resumeEntry || !pagesEntry || !pubsEntry,
  };
}

/**
 * Latest records: newest first, merged across the Tier-A collections only.
 *
 * It is "Latest", not "Pick back up", because the data cannot support the
 * stronger claim: `site.standard.document` — the one collection the owner
 * actually edits — carries neither `updatedAt` nor `createdAt` (its field list
 * never spreads COMMON_TIMESTAMPS), so saving a document stamps nothing and
 * editing a 2024 post today does not move it. Naming the section for what the
 * records can honestly say beats shipping a promise they cannot keep.
 *
 * `listRecords` returns rkey order — which is ALPHABETICAL, not chronological,
 * for fixed-rkey collections — so the sort happens after the fetch, over the
 * whole set. Never take "the first N of a page" as "the most recent N".
 *
 * @param {Record<string, CountEntry>} entries
 */
export function deriveLatest(entries, limit = LATEST_LIMIT) {
  const rows = [];
  for (const nsid of countedNsids()) {
    const entry = entries[nsid];
    if (!entry?.records?.length) continue;
    const lex = lexiconFor(nsid);
    for (const rec of entry.records) {
      const instant = latestInstant(rec.value, rec.uri, nsid);
      // A record with no trustworthy instant is omitted, not shown undated.
      if (!instant) continue;
      const rkey = rkeyFromAtUri(rec.uri);
      const surf = surfaceForRecord(nsid, rec.value);
      rows.push({
        key: rec.uri,
        uri: rec.uri,
        rkey,
        nsid,
        instant,
        label: rowLabel(rec.value, nsid, lex) || rkey,
        surface: surf,
        surfaceLabel: surf?.label || nsid,
        href: surf
          ? rowHrefFor(surf, rkey)
          : `/admin?c=${encodeURIComponent(nsid)}&r=${encodeURIComponent(rkey)}`,
      });
    }
  }
  // Parse before comparing: is.dame.now records carry a -04:00 offset while
  // Bluesky posts carry Z, so string order is not time order.
  rows.sort((a, b) => compareIsoDesc(a.instant, b.instant));
  return rows.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* The hook                                                             */
/* ------------------------------------------------------------------ */

/**
 * Front Desk data. Renders its whole layout immediately and fills in — nothing
 * here blocks, and the dashboard is fully navigable with zero successful
 * requests.
 *
 * Safe to call from more than one component: requests are de-duplicated by cache
 * key while in flight, so the rail and the Front Desk together still make one
 * request per collection.
 *
 * @param {object}   opts
 * @param {object}   opts.agent          The @atproto/api Agent (or null before the gates pass).
 * @param {string}   opts.did
 * @param {number}   [opts.dataRev]      Bump to re-read after an invalidate.
 * @param {Function} [opts.onInvalidate] The shell's `invalidate`, so `refresh()` reaches
 *                                       every consumer and not just this one.
 */
export function useAdminData({ agent, did, dataRev = 0, onInvalidate = null } = {}) {
  /** @type {[Record<string, CountEntry>, Function]} */
  const [entries, setEntries] = useState(seedFromCache);
  const [guestbookEntry, setGuestbookEntry] = useState(() =>
    isCacheFresh(GUESTBOOK_KEY, COUNTS_TTL_MS) ? readFeedCache(GUESTBOOK_KEY) : null,
  );
  const [pending, setPending] = useState(true);
  // A local revision so `refresh()` works even where no shell context is wired.
  const [localRev, setLocalRev] = useState(0);

  useEffect(() => {
    if (!agent || !did) return undefined;
    let cancelled = false;
    setPending(true);

    // Existing entries are left in place across a refresh, so a re-read updates
    // numbers in situ instead of flashing every tile back to a skeleton.
    fetchCounts(agent, did, (nsid, entry) => {
      if (!cancelled) setEntries((prev) => ({ ...prev, [nsid]: entry }));
    }).then(() => {
      if (!cancelled) setPending(false);
    });

    fetchGuestbookCounts().then((entry) => {
      if (!cancelled) setGuestbookEntry(entry);
    });

    return () => {
      cancelled = true;
    };
  }, [agent, did, dataRev, localRev]);

  /**
   * Drop cached numbers and re-read. This is the manual escape hatch for a count
   * that has gone stale under you — counting is automatic on mount, so this is
   * the only way to get a fresh number without a full reload.
   */
  const refresh = useCallback(
    (scope) => {
      invalidateCounts(scope);
      if (onInvalidate) onInvalidate(scope);
      setLocalRev((r) => r + 1);
    },
    [onInvalidate],
  );

  // All three derivations key off the whole `entries` map rather than on
  // hand-picked slices. `entries` changes once per landing count — about a dozen
  // times per load — and re-deriving over at most ~1200 already-fetched records
  // is cheaper than the bug where someone adds a collection to a derivation and
  // forgets to add it to the dep array.
  const tiles = useMemo(() => deriveTiles(entries, guestbookEntry), [entries, guestbookEntry]);

  const needsYou = useMemo(() => deriveNeedsYou(entries), [entries]);

  const latest = useMemo(() => deriveLatest(entries), [entries]);

  /** The count entry for a surface (or a bare NSID), or null. */
  const countFor = useCallback(
    (surfaceOrNsid) => {
      const nsid = typeof surfaceOrNsid === 'string' ? surfaceOrNsid : surfaceOrNsid?.nsid;
      return (nsid && entries[nsid]) || null;
    },
    [entries],
  );

  /**
   * Does this surface render dimmed with "no records yet"? An absent collection
   * and an empty one are indistinguishable at the API and to the owner, so one
   * presentation serves both. `offRepo` surfaces are exempt — the guestbook's
   * working set lives on other people's repos and a zero here would be a lie.
   */
  const isAbsent = useCallback(
    (surf) => {
      if (!surf || surf.offRepo || !surf.countable || !surf.nsid) return false;
      return entries[surf.nsid]?.count === 0;
    },
    [entries],
  );

  return useMemo(
    () => ({
      counts: entries,
      countFor,
      isAbsent,
      tiles,
      needsYou,
      latest,
      refresh,
      /** True until every Tier-A request has settled at least once. */
      loading: pending,
    }),
    [entries, countFor, isAbsent, tiles, needsYou, latest, refresh, pending],
  );
}
