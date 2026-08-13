// Edge-safe resolver for per-record page metadata (blog posts, creative works,
// curated channels). middleware.js uses this to give record routes a real
// "<record title> — dame.is" <title>, a per-record OG card, and the record's
// own at:// URI in the crawler-facing <head>, instead of the generic section
// card. Plain fetch only, so it runs in the Edge runtime.
//
// A record route is /{section}/{slug}. The slug is NOT always an rkey:
//   • /blogging/:id      → id is the rkey of a site.standard.document (or a
//                          pub.leaflet.document)
//   • /creating/:slug    → slug is the doc's human `path` (e.g. "how-i-made-…"),
//                          matched against portfolio-homed standard docs — the
//                          rkey rarely equals the slug, which is exactly why the
//                          old getRecord-by-rkey lookup silently missed and
//                          every work fell back to the /creating section card
//   • /curating/:slug    → slug is the channel rkey
//
// Resolution mirrors the SPA (src/hooks/useAtUri.js): match against the static
// JSON snapshots the site already ships under /data/*.json (fast, edge-cached,
// and they carry uri + cid), falling back to a time-boxed live PDS lookup for
// records too fresh to be in the latest snapshot. Everything is defensive: any
// failure returns null and the caller falls back to the section card, so a
// slow/broken PDS never blocks the page.

import {
  ME_DID,
  COLLECTIONS,
  RATIOED_PATH,
  RATIOED_DOC_RKEY,
  RATIOED_PUBLICATION,
} from '../src/config.js';
import { resolvePds, getRecord, listRecords, rkeyFromAtUri } from '../src/lib/atproto.js';
import { TEAL_PLAY_NSIDS, playArtistLine, playTrackName } from '../src/lib/teal.js';
import {
  workSlug,
  canonicalWorkPath,
  showOnCreating,
  showOnBlog,
  isDraft,
} from '../src/lib/publications.js';

const SNAPSHOT_TIMEOUT_MS = 2000;
const PDS_TIMEOUT_MS = 2500;

// Sections whose leaf pages render a single AT-Protocol record.
const RECORD_SECTIONS = new Set([
  'blogging',
  'creating',
  'curating',
  'posting',
  'logging',
  'listening',
  'mothing',
]);

// rkey-addressed sections → the collection(s) a getRecord(rkey) should try, in
// order. (blogging/creating are slug-addressed and resolve via snapshots;
// curating pulls its title from the are.na-backed `curating` snapshot.)
const SECTION_COLLECTIONS = {
  posting: ['app.bsky.feed.post', 'net.anisota.feed.post'],
  logging: [COLLECTIONS.now],
  // teal.fm's production + alpha play lexicons; a shared /listening/{rkey}
  // link resolves against whichever one holds that play.
  listening: TEAL_PLAY_NSIDS,
  mothing: ['is.dame.mothing.observation'],
};

/** Resolve after `ms`, whichever comes first, so a hung fetch never blocks. */
function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSnapshot(origin, name) {
  if (!origin) return null;
  const json = await fetchJson(`${origin}/data/${name}.json`, SNAPSHOT_TIMEOUT_MS);
  return Array.isArray(json) ? json : null;
}

function endsWithRkey(uri, rkey) {
  if (!uri || !rkey) return false;
  const m = String(uri).match(/\/([^/]+)$/);
  return Boolean(m) && m[1] === rkey;
}

function collectionFromUri(uri) {
  const m = String(uri || '').match(/^at:\/\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}

const firstText = (...vals) => {
  for (const s of vals) {
    const t = String(s == null ? '' : s).trim();
    if (t) return t;
  }
  return '';
};

const humanizeSlug = (slug) =>
  String(slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());

// value → { title, description, textOnly } for the OG card, keyed by lexicon.
// `title` is the big line (the record's own text/name); `description` is the
// secondary line; `textOnly` records (posts, statuses) have no title of their
// own, so the card renders their text as body copy and the section name (not
// the text) becomes the <title>.
const CARD_EXTRACTORS = {
  'app.bsky.feed.post': (v) => ({ title: firstText(v.text), description: '', textOnly: true }),
  'net.anisota.feed.post': (v) => ({ title: firstText(v.text), description: '', textOnly: true }),
  'is.dame.now': (v) => ({ title: firstText(v.status, v.text), description: '', textOnly: true }),
  'is.dame.mothing.observation': (v) => {
    const common = firstText(v.taxon?.commonName);
    const sci = firstText(v.taxon?.name);
    return { title: common || sci || 'Moth observation', description: common && sci ? sci : '', textOnly: false };
  },
  'is.dame.arena.channel': (v, ctx) => ({
    title: firstText(v.title, ctx?.title, humanizeSlug(ctx?.slug)),
    description: firstText(v.description, ctx?.description),
    textOnly: false,
  }),
};

const docCard = (v) => ({
  title: firstText(v.title, v.name),
  description: firstText(v.description, v.summary, v.subtitle),
  textOnly: false,
});
CARD_EXTRACTORS['site.standard.document'] = docCard;
CARD_EXTRACTORS['pub.leaflet.document'] = docCard;
CARD_EXTRACTORS['is.dame.creating.work'] = docCard;

// A play cards the same either side of teal.fm's namespace move.
const playCard = (v) => ({
  title: playTrackName(v),
  description: playArtistLine(v),
  textOnly: false,
});
for (const nsid of TEAL_PLAY_NSIDS) CARD_EXTRACTORS[nsid] = playCard;

function extractCard(collection, value, ctx) {
  const fn = CARD_EXTRACTORS[collection];
  if (fn) return fn(value, ctx);
  // Unknown lexicon: any title/name, else any text body.
  const named = firstText(value.title, value.name);
  const text = firstText(value.text, value.status, value.body);
  return named
    ? { title: named, description: firstText(value.description, value.summary), textOnly: false }
    : { title: text, description: '', textOnly: Boolean(text) };
}

/** True if `pathname` looks like a slug-addressed record route we can resolve. */
export function isRecordRoute(pathname) {
  const segs = (pathname || '').split('/').filter(Boolean);
  return segs.length === 2 && RECORD_SECTIONS.has(segs[0]);
}

// ── resolvers: snapshot-first, then a time-boxed live PDS fallback ───────────

// /blogging/:id — id is the rkey; standard docs first, then leaflets.
async function resolveBlog(origin, slug) {
  const blogs = await fetchSnapshot(origin, 'blogs');
  const std = Array.isArray(blogs)
    ? blogs.find((r) => endsWithRkey(r?.uri, slug) && !isDraft(r?.value) && showOnBlog(r?.value))
    : null;
  if (std) return std;
  const leaflets = await fetchSnapshot(origin, 'leaflets');
  const leaf = Array.isArray(leaflets) ? leaflets.find((r) => endsWithRkey(r?.uri, slug)) : null;
  if (leaf) return leaf;
  return withTimeout(liveByRkey(slug, [COLLECTIONS.blogging, COLLECTIONS.leaflet]), PDS_TIMEOUT_MS);
}

// /creating/:slug — slug is the doc's `path` (or an rkey); portfolio-homed
// standard docs first, then legacy is.dame.creating.work.
async function resolveWork(origin, slug) {
  const blogs = await fetchSnapshot(origin, 'blogs');
  const std = Array.isArray(blogs)
    ? blogs.find(
        (r) =>
          !isDraft(r?.value) &&
          showOnCreating(r?.value) &&
          (workSlug(r?.value) === slug || rkeyFromAtUri(r?.uri) === slug),
      )
    : null;
  if (std) return std;
  const works = await fetchSnapshot(origin, 'creations');
  const legacy = Array.isArray(works)
    ? works.find((r) => !isDraft(r?.value) && workSlug(r?.value) === slug)
    : null;
  if (legacy) return legacy;
  return withTimeout(liveWorkBySlug(slug), PDS_TIMEOUT_MS);
}

// /curating/:slug — slug is the channel rkey. The record itself only carries
// `arenaSlug`/`enabled`; the human title + description come from are.na and are
// baked into the `curating` snapshot at build time, so read them from there
// (falling back to a live getRecord + a humanized slug).
async function resolveChannel(origin, slug) {
  const atUri = `at://${ME_DID}/${COLLECTIONS.arenaChannel}/${slug}`;
  const snap = origin ? await fetchJson(`${origin}/data/curating.json`, SNAPSHOT_TIMEOUT_MS) : null;
  const gallery = (Array.isArray(snap?.galleries) ? snap.galleries : []).find(
    (g) => g?.slug === slug || g?.arenaSlug === slug,
  );
  if (gallery && firstText(gallery.title)) {
    return {
      uri: atUri,
      cid: null,
      value: { $type: COLLECTIONS.arenaChannel, title: gallery.title, description: gallery.description || '' },
    };
  }
  const rec = await withTimeout(liveByRkey(slug, [COLLECTIONS.arenaChannel]), PDS_TIMEOUT_MS);
  if (!rec) return null;
  return {
    uri: rec.uri || atUri,
    cid: rec.cid || null,
    value: { ...(rec.value || {}), title: firstText(rec.value?.title, humanizeSlug(slug)) },
  };
}

async function liveByRkey(rkey, collections) {
  const pds = await resolvePds(ME_DID).catch(() => null);
  if (!pds) return null;
  for (const collection of collections) {
    const rec = await getRecord(pds, { repo: ME_DID, collection, rkey }).catch(() => null);
    if (rec?.value) return rec;
  }
  return null;
}

async function liveWorkBySlug(slug) {
  const pds = await resolvePds(ME_DID).catch(() => null);
  if (!pds) return null;
  const std = await listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.blogging, max: 200 }).catch(() => []);
  const byStd = std.find(
    (r) =>
      !isDraft(r?.value) &&
      showOnCreating(r?.value) &&
      (workSlug(r?.value) === slug || rkeyFromAtUri(r?.uri) === slug),
  );
  if (byStd) return byStd;
  const legacy = await listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 }).catch(() => []);
  return legacy.find((r) => !isDraft(r?.value) && workSlug(r?.value) === slug) || null;
}

/**
 * The one address a record should be indexed under. Only `/creating` addresses
 * a record two ways (see canonicalWorkPath); every other section already has
 * one form, so the requested path stands.
 */
function canonicalPathFor(section, record, slug) {
  if (section !== 'creating') return `/${section}/${encodeURIComponent(slug)}`;
  return canonicalWorkPath(record?.value, rkeyFromAtUri(record?.uri), slug);
}

function shapeMeta(record, section, slug) {
  const v = (record && record.value) || {};
  const atUri = record.uri || null;
  const collection = collectionFromUri(atUri);
  const { title, description, textOnly } = extractCard(collection, v, { slug });
  const cleanTitle = firstText(title);
  if (!cleanTitle) return null;
  const cid = record.cid || null;
  // `site` is the site.standard.document → site.standard.publication link
  // (an at:// URI). Bluesky needs it to render the Standard Site embed.
  const publication = typeof v.site === 'string' ? v.site : null;
  // When the record was made — drives the OG card's day-of-life folio so it
  // reflects the record's day, not the day the card is rendered.
  const date = v.publishedAt || v.createdAt || v.playedTime || v.playedAt || null;
  return {
    title: cleanTitle,
    description: firstText(description),
    textOnly: Boolean(textOnly),
    section,
    atUri,
    cid,
    nsid: collection,
    publication,
    date,
    canonicalPath: canonicalPathFor(section, record, slug),
  };
}

/* ── /creating/:slug/:piece — one Ratioed piece ───────────────────────────── */

/** `13`, `013` and the record key all name the same piece. */
function pickPiece(records, ref) {
  const list = Array.isArray(records) ? records : [];
  const byKey = list.find((r) => endsWithRkey(r?.uri, ref));
  if (byKey) return byKey;
  if (!/^\d+$/.test(ref)) return null;
  const take = Number(ref);
  return list.find((r) => r?.value?.take === take) || null;
}

/** Seconds, minutes — the same shape src/lib/ratioed.js's fmtDuration gives. */
function shortDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Meta for a per-piece page. Same shape `recordMeta` returns, so the middleware
 * treats it identically.
 *
 * The parent segment is checked rather than assumed: a piece page hangs off the
 * Ratioed essay, and the essay answers to both its human path and its record
 * key, so both are accepted here and neither is canonical for the piece — the
 * take number under the configured path is.
 */
/**
 * The piece record a `/creating/…/:piece` segment names, snapshot first and the
 * PDS after. Shared by the crawler meta and the card renderer, which want the
 * same record for different reasons.
 */
export async function pieceRecord(ref, origin) {
  let want = String(ref ?? '');
  try { want = decodeURIComponent(want); } catch {}
  if (!want) return null;
  const found = pickPiece(await fetchSnapshot(origin, 'ratioed'), want);
  if (found) return found;
  // The snapshot is a build artefact; a piece published since the last deploy
  // is only on the PDS. Same reason loadPieces() re-reads it.
  return pickPiece(await withTimeout(livePieces(), PDS_TIMEOUT_MS), want);
}

export async function pieceMeta(pathname, origin) {
  const segs = (pathname || '').split('/').filter(Boolean);
  if (segs.length !== 3 || segs[0] !== 'creating') return null;
  const parent = segs[1];
  if (parent !== RATIOED_PATH && parent !== RATIOED_DOC_RKEY) return null;

  const record = await pieceRecord(segs[2], origin);
  const v = record?.value;
  if (!v?.take) return null;

  const take = String(v.take).padStart(2, '0');
  const breaker = v.breaker || {};
  const ended = breaker.handle && breaker.handle !== 'unknown'
    ? ` Ended by @${breaker.currentHandle || breaker.handle}${
        typeof breaker.reactionMs === 'number'
          ? `, whose like was caught ${(breaker.reactionMs / 1000).toFixed(1)}s later.`
          : ', whose like has since been deleted.'
      }`
    : '';
  const people = v.preSeal?.participants || 0;
  const drew = people === 0 ? 'nobody' : `${people} ${people === 1 ? 'person' : 'people'}`;

  return {
    title: `Ratioed, take ${take}`,
    description:
      `A post sealed the moment somebody liked it. It stood for ${shortDuration(v.lifespanMs)}` +
      ` and drew ${drew} while it was alive.${ended}`,
    textOnly: false,
    section: 'creating',
    atUri: record.uri || null,
    cid: record.cid || null,
    nsid: COLLECTIONS.ratioedPiece,
    // A piece is not a site.standard.document, so it carries no document ref —
    // only the publication it belongs to.
    publication: RATIOED_PUBLICATION,
    date: v.postedAt || null,
    canonicalPath: `/creating/${RATIOED_PATH}/${take}`,
    // A piece gets a card of its own rather than the generic record card — it
    // has a shape (how long it stood, what landed while it did) that a title
    // and a blurb can't carry. The take is all the card needs to find it, so
    // the query stays short and nothing free-text reaches the renderer.
    ogQuery: `piece=${encodeURIComponent(take)}`,
  };
}

async function livePieces() {
  const pds = await resolvePds(ME_DID).catch(() => null);
  if (!pds) return null;
  return listRecords(pds, {
    repo: ME_DID,
    collection: COLLECTIONS.ratioedPiece,
    max: 200,
  }).catch(() => null);
}

/**
 * Resolve a record route to
 * `{ title, description, textOnly, section, atUri, cid, nsid, publication,
 * date, canonicalPath }`, or null if it's not a record route or the record
 * can't be resolved. `title` is the card's big line (the record's own title, or
 * its text for `textOnly` records like posts); `description` is the secondary
 * line; `atUri`/`cid` point at the canonical record; `nsid` is its collection;
 * `publication` is the parent site.standard.publication at:// URI (or null);
 * `date` is when it was made; `canonicalPath` is the one on-site address it
 * should be indexed under, which is not always the one that was requested.
 */
export async function recordMeta(pathname, origin) {
  const segs = (pathname || '').split('/').filter(Boolean);
  if (segs.length !== 2) return null;
  const [section, rawSlug] = segs;
  if (!RECORD_SECTIONS.has(section)) return null;

  let slug = rawSlug;
  try { slug = decodeURIComponent(rawSlug); } catch {}

  let record = null;
  try {
    if (section === 'blogging') record = await resolveBlog(origin, slug);
    else if (section === 'creating') record = await resolveWork(origin, slug);
    else if (section === 'curating') record = await resolveChannel(origin, slug);
    else if (SECTION_COLLECTIONS[section]) {
      record = await withTimeout(liveByRkey(slug, SECTION_COLLECTIONS[section]), PDS_TIMEOUT_MS);
    }
  } catch {
    record = null;
  }
  return record ? shapeMeta(record, section, slug) : null;
}
