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

import { ME_DID, COLLECTIONS } from '../src/config.js';
import { resolvePds, getRecord, listRecords, rkeyFromAtUri } from '../src/lib/atproto.js';
import { workSlug, showOnCreating, showOnBlog, isDraft } from '../src/lib/publications.js';

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
  listening: [COLLECTIONS.listen],
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

const artistNames = (v) =>
  (Array.isArray(v?.artists) ? v.artists : [])
    .map((a) => a?.artistName)
    .filter(Boolean)
    .join(', ');

// value → { title, description, textOnly } for the OG card, keyed by lexicon.
// `title` is the big line (the record's own text/name); `description` is the
// secondary line; `textOnly` records (posts, statuses) have no title of their
// own, so the card renders their text as body copy and the section name (not
// the text) becomes the <title>.
const CARD_EXTRACTORS = {
  'app.bsky.feed.post': (v) => ({ title: firstText(v.text), description: '', textOnly: true }),
  'net.anisota.feed.post': (v) => ({ title: firstText(v.text), description: '', textOnly: true }),
  'is.dame.now': (v) => ({ title: firstText(v.status, v.text), description: '', textOnly: true }),
  'fm.teal.alpha.feed.play': (v) => ({
    title: firstText(v.trackName),
    description: artistNames(v),
    textOnly: false,
  }),
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
  };
}

/**
 * Resolve a record route to
 * `{ title, description, textOnly, section, atUri, cid, nsid, publication, date }`,
 * or null if it's not a record route or the record can't be resolved. `title`
 * is the card's big line (the record's own title, or its text for `textOnly`
 * records like posts); `description` is the secondary line; `atUri`/`cid` point
 * at the canonical record; `nsid` is its collection; `publication` is the parent
 * site.standard.publication at:// URI (or null); `date` is when it was made.
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
