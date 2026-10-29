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
  APPVIEW,
  COLLECTIONS,
  MOTHING_OBSERVATION_NSID,
  OBSERVING_OBSERVATION_NSID,
  RATIOED_PATH,
  RATIOED_DOC_RKEY,
  RATIOED_PUBLICATION,
} from '../src/config.js';
import { resolvePds, getRecord, listRecords, rkeyFromAtUri } from '../src/lib/atproto.js';
import { fetchMothObservations } from '../src/lib/inaturalist.js';
import { findNight, isNightSlug, nightBeyondReach, nightCardCopy } from '../src/lib/mothing.js';
import { arenaText } from '../src/lib/arena.js';
import { VERB_REGISTRY, VERB_LABELS } from '../src/lib/verbRegistry.js';
import {
  TEAL_PLAY_NSIDS,
  listTealPlays,
  playArtistLine,
  playTrackName,
} from '../src/lib/teal.js';
import {
  ALBUMS_SEGMENT,
  albumCardCopy,
  albumsFromSnapshot,
  buildAlbums,
  findAlbum,
  isAlbumPath,
} from '../src/lib/albums.js';
import {
  workSlug,
  canonicalWorkPath,
  showOnCreating,
  showOnBlog,
  isDraft,
  isPortfolioDoc,
} from '../src/lib/publications.js';
import {
  brokenTakes,
  takesPresent,
  findParticipant,
  participantDossier,
  participantBoard,
} from '../src/lib/ratioedParticipant.js';
import { composeEventLog, livingKindsIndex } from '../src/lib/ratioedLog.js';
import { audienceIndex, fmtReach } from '../src/lib/ratioedReach.js';

const SNAPSHOT_TIMEOUT_MS = 2000;
const PDS_TIMEOUT_MS = 2500;
const INAT_TIMEOUT_MS = 3000;
const ARENA_TIMEOUT_MS = 2500;
// The AppView read that names whose post a repost or a like points at. Shorter
// than the PDS box because it comes after it, on the same request: a slow one
// costs the card its author, never the page its 200.
const APPVIEW_TIMEOUT_MS = 2000;

// Sections whose leaves are addressed by something other than an rkey in a
// verb's own collections, and so resolve through a function of their own below:
// blogging/creating are slug-addressed and read the snapshots, curating pulls
// its title from the are.na-backed `curating` snapshot.
const SLUG_SECTIONS = ['blogging', 'creating', 'curating'];

// rkey-addressed sections → the collection(s) a getRecord(rkey) should try, in
// order. Every verb in the registry that App.jsx gives a `/{verb}/:rkey` page,
// derived rather than listed: this used to name four of them, so a photo, a
// like or a flush resolved nothing, carded as the home page, and answered 200
// to an rkey that never existed. Every collection lives in ME_DID's repo, which
// is all liveByRkey needs. Two are spelled out because they aren't simply the
// registry's list: listening reads both of teal.fm's play lexicons (a shared
// /listening/{rkey} link resolves against whichever one holds that play), and
// /mothing/:rkey is an observation while /mothing/:date is a night.
const SECTION_COLLECTIONS = {
  listening: TEAL_PLAY_NSIDS,
  mothing: [MOTHING_OBSERVATION_NSID],
};
for (const { verb, collections } of VERB_REGISTRY) {
  if (SLUG_SECTIONS.includes(verb) || SECTION_COLLECTIONS[verb]) continue;
  SECTION_COLLECTIONS[verb] = collections.map((c) => c.nsid);
}

/**
 * Sections whose `/section/:id` leaves address a RECORD this module can
 * resolve. Exported because middleware.js has to make the same distinction
 * before it decides that an unresolvable path is a 404: /posting/3abc names a
 * record and 404s when there isn't one, while /available/v2 and
 * /exploring/:repo/:collection are ordinary pages that own their own content
 * and must never be judged against a record lookup.
 */
export const RECORD_SECTIONS = new Set([
  ...SLUG_SECTIONS,
  ...Object.keys(SECTION_COLLECTIONS),
]);

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

// U+FFFC is dropped on the way in: a placeholder Apple's text system can leave
// where an inline object was (see src/lib/postRichText.jsx). In a head or on a
// card it would show as a box, and a text that was only that is no text.
const firstText = (...vals) => {
  for (const s of vals) {
    const t = String(s == null ? '' : s).replace(/￼/g, '').trim();
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
  'app.bsky.feed.post': (v) => ({ title: postTitle(v), description: '', textOnly: true }),
  'net.anisota.feed.post': (v) => ({ title: postTitle(v), description: '', textOnly: true }),
  'is.dame.now': (v) => ({ title: firstText(v.status, v.text), description: '', textOnly: true }),
  [MOTHING_OBSERVATION_NSID]: (v) => {
    const common = firstText(v.taxon?.commonName);
    const sci = firstText(v.taxon?.name);
    return { title: common || sci || 'Moth observation', description: common && sci ? sci : '', textOnly: false };
  },
  // Everything else iNaturalist holds, mirrored in the same shape.
  [OBSERVING_OBSERVATION_NSID]: (v) => {
    const common = firstText(v.taxon?.commonName);
    const sci = firstText(v.taxon?.name);
    return {
      title: common || sci || 'Observation',
      description: common && sci ? sci : '',
      textOnly: false,
    };
  },
  // A feed generator calls its name `displayName`, which the generic branch
  // doesn't look for.
  'app.bsky.feed.generator': (v) => ({
    title: firstText(v.displayName),
    description: firstText(v.description),
    textOnly: false,
  }),
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

// A play cards the same either side of teal.fm's namespace move. The release
// rides in the description because a track's album is the second thing anybody
// wants to know about it — and because the card draws its cover, which the
// description is the text half of.
const playCard = (v) => ({
  title: playTrackName(v),
  description: [playArtistLine(v), firstText(v.releaseName)].filter(Boolean).join(' · '),
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

// The album/record split under /listening lives with the derivation it belongs
// to (src/lib/albums.js), because the router needs it too; re-exported here so
// middleware.js gets it alongside everything else it asks this module for.
export { ALBUMS_SEGMENT, isAlbumPath };

/** True if `pathname` looks like a slug-addressed record route we can resolve. */
export function isRecordRoute(pathname) {
  const segs = (pathname || '').split('/').filter(Boolean);
  return segs.length === 2 && RECORD_SECTIONS.has(segs[0]) && !isAlbumPath(pathname);
}

// ── resolvers: snapshot-first, then a time-boxed live PDS fallback ───────────

// /blogging/:id — id is the rkey; standard docs first, then leaflets. (No
// leaflet snapshot is ever written — pub.leaflet.document isn't in the verb
// registry — so leaflets are only ever found live.)
async function resolveBlog(origin, slug) {
  const blogs = await fetchSnapshot(origin, 'blogs');
  const std = Array.isArray(blogs)
    ? blogs.find((r) => endsWithRkey(r?.uri, slug) && !isDraft(r?.value) && showOnBlog(r?.value))
    : null;
  if (std) return std;
  return withTimeout(liveBlogByRkey(slug), PDS_TIMEOUT_MS);
}

/**
 * A blog post too fresh for the snapshot, read live — filtered the way the
 * snapshot is. Unfiltered, a draft answered 200 here with its title in the
 * card, and a portfolio-only work got a self-canonical /blogging page the SPA
 * renders as Not Found. A standard doc that exists but isn't a blog post is a
 * definite answer, so the leaflet collection isn't asked after it.
 */
async function liveBlogByRkey(rkey) {
  const pds = await resolvePds(ME_DID).catch(() => null);
  if (!pds) return null;
  const std = await getRecord(pds, {
    repo: ME_DID,
    collection: COLLECTIONS.blogging,
    rkey,
  }).catch(() => null);
  if (std?.value)
    return !isDraft(std.value) && showOnBlog(std.value) ? std : null;
  const leaf = await getRecord(pds, {
    repo: ME_DID,
    collection: COLLECTIONS.leaflet,
    rkey,
  }).catch(() => null);
  return leaf?.value ? leaf : null;
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

/**
 * One are.na channel's metadata, through our own same-origin `/api/arena`
 * proxy — the way the gallery page reads it (src/lib/arena.js in the browser).
 * Going through the proxy rather than api.are.na directly keeps the account
 * token server-side and means the edge only ever talks to its own deployment.
 * Null on anything at all going wrong; every caller has a fallback.
 */
async function arenaChannelMeta(origin, arenaSlug) {
  if (!origin || !arenaSlug) return null;
  const path = `/channels/${encodeURIComponent(String(arenaSlug))}`;
  return fetchJson(`${origin}/api/arena?path=${encodeURIComponent(path)}`, ARENA_TIMEOUT_MS);
}

// /curating/:slug — slug is the channel rkey. The record itself only carries
// `arenaSlug`/`enabled` plus OPTIONAL title/description overrides; the human
// copy lives on are.na and is baked into the `curating` snapshot at build time,
// so read it from there (falling back to a live getRecord + are.na itself).
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
  const v = rec.value || {};
  // A gallery published (or renamed) since the last deploy is the only one that
  // gets this far, and the record alone can't name it: `title`/`description` are
  // overrides that are usually absent, so the card fell through to a humanized
  // rkey — the slug with its apostrophes filed off and its tail cut, which is
  // how "there are 'we didn't start the fires' by billy joel everywhere for
  // those with eyes to see" cards as "There are we didn t start the fires".
  // Ask are.na for the real copy, exactly as the page does (CuratingChannel.jsx).
  // Disabled galleries are hidden from the site, so they resolve to nothing here
  // too — otherwise the crawler got a card for a page the SPA renders as a 404.
  if (v.enabled === false || !firstText(v.arenaSlug)) return null;
  const needsMeta = !firstText(v.title) || !firstText(v.description);
  const meta = needsMeta ? await arenaChannelMeta(origin, v.arenaSlug) : null;
  return {
    uri: rec.uri || atUri,
    cid: rec.cid || null,
    value: {
      ...v,
      title: firstText(v.title, arenaText(meta?.title), humanizeSlug(slug)),
      description: firstText(v.description, arenaText(meta?.description)),
    },
  };
}

// Every collection is asked at once and the first in order that holds the rkey
// wins. One after another, /crafting's nine lexicons spent the whole time box
// on the misses before reaching a record in the last of them, and a page for a
// record that exists would have answered 404.
async function liveByRkey(rkey, collections) {
  const pds = await resolvePds(ME_DID).catch(() => null);
  if (!pds) return null;
  const found = await Promise.all(
    collections.map((collection) =>
      getRecord(pds, { repo: ME_DID, collection, rkey }).catch(() => null),
    ),
  );
  return found.find((rec) => rec?.value) || null;
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
 * The one address a record should be indexed under. `/creating` addresses a
 * record two ways (see canonicalWorkPath), and a standard document can be
 * cross-posted onto the other section by a tag — but its `site` stays its
 * home, so the copy under the other section points there. Without that, a blog
 * post tagged `creating` was indexable at two self-canonical URLs, and both
 * were in the sitemap. Legacy is.dame.creating.work records carry no `site`,
 * which is why this keys on the collection rather than on isPortfolioDoc alone.
 * Every other section already has one form, so the requested path stands.
 */
function canonicalPathFor(section, record, slug) {
  const rkey = rkeyFromAtUri(record?.uri);
  const isStandardDoc = collectionFromUri(record?.uri) === COLLECTIONS.blogging;
  if (
    isStandardDoc &&
    rkey &&
    (section === 'blogging' || section === 'creating')
  ) {
    return isPortfolioDoc(record.value)
      ? canonicalWorkPath(record.value, rkey, slug)
      : `/blogging/${encodeURIComponent(rkey)}`;
  }
  if (section !== 'creating') return `/${section}/${encodeURIComponent(slug)}`;
  return canonicalWorkPath(record?.value, rkey, slug);
}

/** "A like" from "a like": the registry's label, as the start of a sentence. */
const sentenceCase = (s) =>
  String(s || '').replace(/^\w/, (c) => c.toUpperCase());

/**
 * What a post says when it says nothing: a quote post, a photo, a link. Read
 * off the embed, so the card names the kind of post it is.
 */
function embedLine(embed) {
  const type = String(embed?.$type || '');
  const mediaType = String(embed?.media?.$type || '');
  const linked = firstText(
    embed?.external?.title,
    embed?.media?.external?.title,
  );
  if (linked) return `A link to “${linked}”`;
  if (type.startsWith('app.bsky.embed.record')) return 'A quote post';
  if (type === 'app.bsky.embed.images' || mediaType === 'app.bsky.embed.images')
    return 'A photo post';
  if (type === 'app.bsky.embed.video' || mediaType === 'app.bsky.embed.video')
    return 'A video post';
  return '';
}

/**
 * A stand-in line for a record that resolved but has no text of its own to
 * card with — a quote post, a like, a follow, a status left blank. Those used
 * to come back null, which the middleware takes to mean "no such record": the
 * page answered 404 with noindex although the record was right there. Only the
 * rkey-addressed verb sections get one; the slug-addressed ones have fallbacks
 * of their own, and an unknown record with nothing in it stays null.
 */
function fallbackTitle(section, value) {
  if (!SECTION_COLLECTIONS[section]) return '';
  return firstText(embedLine(value?.embed), sentenceCase(VERB_LABELS[section]));
}

/* ── photos, and the posts they ride on ───────────────────────────────────── */

// Bluesky's image CDN serves any blob in a repo by DID and CID, resized. A card
// asks for the feed thumbnail, which fits inside 1000px: a comfortable 2x for
// the largest plate a card draws, where the original upload can run to several
// MB. Always as JPEG, for two reasons. Satori can't decode WebP, so a WebP plate
// would throw and take the whole card down. And asking the CDN for a raster
// means an SVG blob never reaches the renderer as an SVG, which is the rule the
// image proxy enforces too (api/image-proxy.js).
const BSKY_CDN = 'https://cdn.bsky.app/img';
const DID_RE = /^did:(plc|web):[a-zA-Z0-9._:%-]+$/;
const CID_RE = /^[a-z0-9]{16,}$/i;

/** A CDN URL for one blob, or null if either half of the address looks wrong.
 *  Both halves come off records other people write, so they are checked
 *  rather than pasted into a URL the renderer will fetch. */
export function bskyImageUrl(did, cid, preset = 'feed_thumbnail') {
  if (!DID_RE.test(String(did || '')) || !CID_RE.test(String(cid || ''))) return null;
  return `${BSKY_CDN}/${preset}/plain/${did}/${cid}@jpeg`;
}

/**
 * The thumbnail-sized copy of an avatar the AppView hands back, or null. Only a
 * CDN avatar URL is taken (the AppView's own shape, `…/img/avatar/plain/{did}/
 * {cid}`), rebuilt from its parts, so whatever else might sit in that field is
 * never fetched. The thumbnail is 128px, about twice the square a card draws.
 */
export function avatarThumbUrl(url) {
  const m = String(url || '').match(
    /^https:\/\/cdn\.bsky\.app\/img\/avatar(?:_thumbnail)?\/plain\/([^/]+)\/([a-z0-9]+)(?:@[a-z]+)?$/i,
  );
  return m ? bskyImageUrl(m[1], m[2], 'avatar_thumbnail') : null;
}

const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** Cut to `max` characters on a word boundary, with an ellipsis if cut. */
function clipWords(text, max) {
  const s = oneLine(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// How long a line of alt text may run in a head or a title. Post text is
// capped at 300 by Bluesky; alt text can run to 2,000, and a screenshot's is
// often a transcript of the whole thing.
const ALT_MAX = 280;

/**
 * The photos a post carries, in order: a plain image embed, or the media half
 * of a quote-with-media. Each is `{ cid, alt, aspect }`, where `aspect` is
 * width over height when the record says (null when it doesn't).
 */
export function postImages(value) {
  const embed = value?.embed || {};
  const media =
    embed.$type === 'app.bsky.embed.images'
      ? embed
      : embed.media?.$type === 'app.bsky.embed.images'
        ? embed.media
        : null;
  const list = Array.isArray(media?.images) ? media.images : [];
  return list
    .map((img) => {
      // `ref.$link` is the blob ref as JSON; `cid` is the legacy blob shape
      // some early records still carry.
      const cid = String(img?.image?.ref?.$link || img?.image?.cid || '');
      const w = Number(img?.aspectRatio?.width);
      const h = Number(img?.aspectRatio?.height);
      return { cid, alt: oneLine(img?.alt), aspect: w > 0 && h > 0 ? w / h : null };
    })
    .filter((im) => CID_RE.test(im.cid));
}

// The labels that keep a photo off a share card: a card is drawn for anybody
// who sees the link, signed in or not, with none of the click-through an app
// puts in front of these. The post's text still cards; only the plate goes.
const SENSITIVE_LABELS = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore']);

function labelValues(...sources) {
  const vals = [];
  for (const src of sources) {
    // Self-labels on a record: `{ $type: …#selfLabels, values: [{ val }] }`.
    // Labels on an AppView view: `[{ val, … }]`.
    const list = Array.isArray(src) ? src : Array.isArray(src?.values) ? src.values : [];
    for (const l of list) if (l?.val) vals.push(String(l.val));
  }
  return vals;
}

/** True when a post, or the view of it, carries a label that keeps its photos
 *  off a card. */
export function hidesPhotos(value, viewLabels) {
  return labelValues(value?.labels, viewLabels).some((v) => SENSITIVE_LABELS.has(v));
}

// Bluesky allows four photos to a post, so the words run out where it does.
const COUNT_WORDS = ['A photo', 'Two photos', 'Three photos', 'Four photos'];

/** `1` → "A photo", `3` → "Three photos". */
export function photosLabel(n) {
  return COUNT_WORDS[n - 1] || `${n} photos`;
}

/** The first alt text a post's photos carry, or ''. */
const firstAlt = (photos) => (photos.find((p) => p.alt) || {}).alt || '';

/**
 * What a post of Dame's is called in a head: its text, and when it has none,
 * its first photo's alt text (the author's own description of the picture),
 * and failing that a plain count. All three beat the embed-kind stand-in
 * ("A photo post") now that the card draws the photo itself.
 */
function postTitle(value) {
  const photos = postImages(value);
  return firstText(
    value?.text,
    clipWords(firstAlt(photos), ALT_MAX),
    photos.length ? `${photosLabel(photos.length)} by Dame` : '',
  );
}

/**
 * How many photos fit on a card. All of a post's, since Bluesky stops at four
 * and the plate lays four out the way the app does.
 */
const MAX_PLATES = 4;

/**
 * Everything a post's card says, minus the pixels: what api/og.js draws, read
 * off the record (and for somebody else's post, the AppView's view of its
 * author), so the head and the card are worded by one function.
 *
 *   text     the post's own words, as written
 *   caption  when there are none: the first photo's alt text, set in italic
 *            on the card, because it describes the picture rather than saying
 *            anything of its own
 *   standIn  when there is neither: "A photo", or what kind of post it is
 *   alt      the first photo's alt text, whatever else there is
 *   photos   `[{ url, alt, aspect }]`, CDN thumbnails, at most four, none when
 *            a label keeps them off (hidesPhotos)
 *   total    how many photos the post has, whether or not they are drawn
 *   author   `{ name, handle, did, avatar }` for somebody else's post, else null
 */
export function postCardCopy(value, { did = ME_DID, author = null, labels = null } = {}) {
  const all = postImages(value);
  const photos = hidesPhotos(value, labels)
    ? []
    : all
        .slice(0, MAX_PLATES)
        .map((p) => ({ url: bskyImageUrl(did, p.cid), alt: p.alt, aspect: p.aspect }))
        .filter((p) => p.url);
  const text = firstText(value?.text);
  const alt = firstAlt(all);
  const caption = text ? '' : alt;
  const standIn =
    text || caption ? '' : all.length ? photosLabel(all.length) : embedLine(value?.embed);
  return { text, alt, caption, standIn, photos, total: all.length, author };
}

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * The words that describe a post's card to somebody who can't see it. The card
 * is the text beside a photo, so it says both:
 *
 *   Dame's, with text   gm from cooper (a photo: A small tan chihuahua…)
 *   Dame's, photo only  A photo by Dame: dril tweet about spending 3,600…
 *   somebody else's     A post by Poe (@poe.atpota.to): “new dispatch!…”
 *
 * `by` is the author's label when the post isn't Dame's. Dame's own words are
 * left unquoted, as a text post's card alt always has been; somebody else's are
 * quoted, because the card is quoting them.
 */
function postImageAlt({ text, alt, standIn, total }, { by = '' } = {}) {
  // The alt text is the first photo's, so with more than one it says so.
  const described = alt ? `${total > 1 ? ', the first' : ''}: ${alt}` : '';
  const photos = total
    ? `${photosLabel(total)}${text ? '' : ` by ${by || 'Dame'}`}${described}`
    : '';
  if (!text) return photos || (by ? `A post by ${by}: ${lowerFirst(standIn)}` : standIn);
  const said = by ? `A post by ${by}: “${oneLine(text)}”` : oneLine(text);
  return photos ? `${said} (${lowerFirst(photos)})` : said;
}

/* ── reposts and likes: somebody else's post ──────────────────────────────── */

// The verbs whose records point at a post rather than being one. Their card is
// the post they point at, credited to whoever wrote it: carded as Dame's own
// words, a repost put somebody else's sentence under Dame's name.
const SUBJECT_SECTIONS = {
  reposting: 'repost',
  liking: 'like',
};

/** The `/api/og` query key a subject section's card goes by. */
export const SUBJECT_CARD_KEYS = Object.fromEntries(
  Object.entries(SUBJECT_SECTIONS).map(([section, key]) => [key, section]),
);

const POST_URI_RE = /^at:\/\/(did:[a-z]+:[a-zA-Z0-9._:%-]+)\/app\.bsky\.feed\.post\/[a-zA-Z0-9._~:-]+$/;

/**
 * One post as the public AppView sees it: author profile, record, labels. Null
 * on any failure, or when the author has asked not to be shown to signed-out
 * readers (`!no-unauthenticated`), which is what a share card is drawn for.
 */
async function postView(uri) {
  if (!POST_URI_RE.test(String(uri || ''))) return null;
  const json = await fetchJson(
    `${APPVIEW}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`,
    APPVIEW_TIMEOUT_MS,
  );
  const view = Array.isArray(json?.posts) ? json.posts.find((p) => p?.uri === uri) : null;
  if (!view?.author?.did || !view?.record) return null;
  if (labelValues(view.author.labels).includes('!no-unauthenticated')) return null;
  return view;
}

/** `{ name, handle, did, self, label }` for a post view's author. `label` is
 *  how a head names them: "Poe (@poe.atpota.to)", or the handle alone when
 *  there is no display name worth adding. */
function authorOf(view) {
  const a = view?.author || {};
  const handle = oneLine(a.handle);
  const name = oneLine(a.displayName);
  const at = handle && handle !== 'handle.invalid' ? `@${handle}` : '';
  const label =
    name && name !== handle && at ? `${name} (${at})` : at || name || 'somebody';
  return {
    name: name && name !== handle ? name : '',
    handle: at ? handle : '',
    did: a.did,
    self: a.did === ME_DID,
    label,
    avatar: avatarThumbUrl(a.avatar),
  };
}

/**
 * The reference record a `/reposting/:rkey` or `/liking/:rkey` path names, and
 * the post it points at, or null. Shared by the head (below) and the card
 * renderer (api/og.js), so the two can't disagree about whose post it is. A
 * subject that isn't a Bluesky post (a Grain favorite, a Tangled star, an
 * Anisota repost) answers with no view, and those keep the plain verb card.
 */
export async function subjectPost(section, rkey) {
  const collections = SUBJECT_SECTIONS[section] ? SECTION_COLLECTIONS[section] : null;
  const want = String(rkey ?? '').trim();
  if (!collections || !want) return null;
  const record = await withTimeout(liveByRkey(want, collections), PDS_TIMEOUT_MS);
  if (!record) return null;
  const view = await withTimeout(postView(record.value?.subject?.uri), APPVIEW_TIMEOUT_MS);
  return { record, view: view || null };
}

/**
 * Everything a repost's or a like's card draws, minus the pixels: the post it
 * points at, under its author's name, avatar and handle. Null when the AppView
 * couldn't name the post, which leaves the renderer to draw the section card.
 */
export function subjectCardCopy(found) {
  if (!found?.view) return null;
  const author = authorOf(found.view);
  return postCardCopy(found.view.record, {
    did: author.did,
    labels: found.view.labels,
    author: { name: author.name, handle: author.handle, avatar: author.avatar },
  });
}

/**
 * A post of Dame's by record key, as /posting/:rkey resolves it. Exported for
 * the card renderer, which reads the text and the photos back off the record
 * rather than taking either on the query string.
 */
export async function postRecord(rkey) {
  const want = String(rkey ?? '').trim();
  if (!want) return null;
  return withTimeout(liveByRkey(want, SECTION_COLLECTIONS.posting), PDS_TIMEOUT_MS);
}

/**
 * Meta for a repost or a like whose post the AppView could name. The head says
 * who wrote it and quotes it, rather than presenting it as Dame's words: the
 * title is "Dame reposted a post by Poe (@poe.atpota.to)", the description the
 * post itself, in quotation marks.
 */
function subjectMeta(record, view, section, slug) {
  const base = shapeMeta(record, section, slug);
  if (!base) return null;
  const author = authorOf(view);
  const copy = postCardCopy(view.record, { did: author.did, labels: view.labels });
  const past = VERB_REGISTRY.find((v) => v.verb === section)?.pastTense || section;
  const whose = author.self ? 'their own post' : `a post by ${author.label}`;
  // The post itself, quoted. With no words of its own, the photo's alt text
  // (not quoted: it describes the picture, it isn't the post saying anything),
  // and failing that what kind of post it is. The title has already named the
  // author, so none of these repeats them.
  const description = copy.text
    ? `“${clipWords(copy.text, ALT_MAX)}”`
    : clipWords(copy.caption, ALT_MAX) || copy.standIn || '';
  const rkey = rkeyFromAtUri(record.uri);
  return {
    ...base,
    title: `Dame ${past} ${whose}`,
    description,
    textOnly: false,
    imageAlt: postImageAlt(copy, { by: author.self ? 'Dame' : author.label }),
    ...(rkey ? { ogQuery: `${SUBJECT_SECTIONS[section]}=${encodeURIComponent(rkey)}` } : {}),
  };
}

function shapeMeta(record, section, slug) {
  const v = (record && record.value) || {};
  const atUri = record.uri || null;
  const collection = collectionFromUri(atUri);
  const { title, description, textOnly } = extractCard(collection, v, { slug });
  // A record that is there and says nothing gets a stand-in line, carded the
  // way a post's text is: the section names the page (see fallbackTitle).
  const standIn = firstText(title) ? '' : fallbackTitle(section, v);
  const cleanTitle = firstText(title, standIn);
  if (!cleanTitle) return null;
  const cid = record.cid || null;
  // `site` is the site.standard.document → site.standard.publication link
  // (an at:// URI). Bluesky needs it to render the Standard Site embed.
  const publication = typeof v.site === 'string' ? v.site : null;
  // When the record was made — drives the OG card's day-of-life folio so it
  // reflects the record's day, not the day the card is rendered.
  const date = v.publishedAt || v.createdAt || v.playedTime || v.playedAt || null;
  // A play gets a card of its own: a song is its cover before it is any of its
  // text, and a title-and-blurb card throws that away. Only the record key
  // reaches the renderer, which reads the track, the artist, the album and the
  // artwork back off the record itself.
  const rkey = rkeyFromAtUri(atUri);
  // A post of Dame's with a photo the card may show gets the photo card: the
  // picture as a plate, the words beside it. Only the record key reaches the
  // renderer, which reads the text and the photos back off the record, so no
  // free text and no image URL ever rides on the query string.
  const isPost = collection === 'app.bsky.feed.post' || collection === 'net.anisota.feed.post';
  const postCopy = isPost && section === 'posting' ? postCardCopy(v) : null;
  const ogQuery =
    TEAL_PLAY_NSIDS.includes(collection) && rkey
      ? `play=${encodeURIComponent(rkey)}`
      : postCopy?.photos.length && rkey
        ? `post=${encodeURIComponent(rkey)}`
        : null;
  return {
    title: cleanTitle,
    description: firstText(description),
    textOnly: Boolean(textOnly || standIn),
    section,
    atUri,
    cid,
    nsid: collection,
    publication,
    date,
    canonicalPath: canonicalPathFor(section, record, slug),
    // What the card shows, for a reader who can't see it. Only a post with
    // photos says more than its title: the card is the text and the picture.
    ...(postCopy?.total ? { imageAlt: postImageAlt(postCopy) } : {}),
    ...(ogQuery ? { ogQuery } : {}),
  };
}

/* ── /mothing/:date — one night at the light ──────────────────────────────── */

/**
 * The night a `/mothing/<date>` path names — `{ session, newer, older }`, or
 * null when no session fell on that date.
 *
 * A night is not a record. It's the grouping a night's worth of observations
 * makes (`buildSessions`), so it is derived here from the same
 * /data/mothing.json the page paints from — every observation, rebuilt on
 * every deploy — rather than fetched.
 *
 * The night somebody actually shares a link to, though, is usually the one
 * that just happened, which is newer than the last build. So a date past the
 * snapshot's reach falls back to a small, time-boxed pull from iNaturalist.
 */
export async function nightSession(date, origin) {
  if (!isNightSlug(date)) return null;
  const snap = origin ? await fetchJson(`${origin}/data/mothing.json`, SNAPSHOT_TIMEOUT_MS) : null;
  const observations = Array.isArray(snap?.observations) ? snap.observations : [];
  const found = findNight(observations, date);
  if (found) return found;
  // Only ask iNaturalist when the snapshot could actually be short here, and
  // never for a date in the future — without that second bound a stream of
  // invented dates would turn crawler hits into outbound API requests.
  if (!nightBeyondReach(observations, date)) return null;
  if (date > new Date().toISOString().slice(0, 10)) return null;
  const live = await withTimeout(fetchMothObservations({ max: 200 }), INAT_TIMEOUT_MS);
  if (!Array.isArray(live)) return null;
  // Merged into the snapshot rather than used on its own: a session's number
  // is its ordinal among every night there has ever been, so a night built
  // from the most recent 200 observations alone would call itself #6 of 6.
  const byId = new Map(observations.map((o) => [o.id, o]));
  for (const o of live) byId.set(o.id, o);
  return findNight(Array.from(byId.values()), date);
}

/**
 * Meta for a night page. Same shape `recordMeta` returns, so the middleware
 * treats it identically — with `atUri` null, because a night has no record of
 * its own to advertise: it is what a night's observation records add up to.
 */
async function nightMeta(date, origin) {
  const found = await nightSession(date, origin);
  if (!found) return null;
  const { session } = found;
  const { title, description } = nightCardCopy(session);
  return {
    title,
    description,
    textOnly: false,
    section: 'mothing',
    atUri: null,
    cid: null,
    nsid: MOTHING_OBSERVATION_NSID,
    publication: null,
    // The card stamps the session's number where other cards stamp the
    // day-of-life folio, so it needs no date.
    date: null,
    canonicalPath: `/mothing/${session.date}`,
    // A night gets a card of its own rather than the generic title-and-blurb
    // one: what it has to show is the moths, and only the date reaches the
    // renderer — everything drawn is read back from the night itself.
    ogQuery: `night=${encodeURIComponent(session.date)}`,
  };
}

/* ── /listening — plays, and the albums they add up to ────────────────────── */

/**
 * One play by rkey, snapshot first and the PDS after.
 *
 * `/data/listening.json` is the merged archive across both teal.fm lexicons, so
 * a play in it needs no namespace guess; a play scrobbled since the last build
 * isn't in it, and `liveByRkey` tries the two collections in registry order
 * (production first) exactly as a `/listening/{rkey}` page load does.
 *
 * Exported because the card renderer wants the same record the crawler meta
 * resolved — it draws a cover from the play's own identifiers, which only the
 * record carries.
 */
export async function playRecord(rkey, origin) {
  const want = String(rkey ?? '').trim();
  if (!want) return null;
  const snap = await fetchSnapshot(origin, 'listening');
  const found = Array.isArray(snap) ? snap.find((r) => endsWithRkey(r?.uri, want) && r.value) : null;
  if (found) return found;
  return withTimeout(liveByRkey(want, SECTION_COLLECTIONS.listening), PDS_TIMEOUT_MS);
}

/**
 * How deep the live fallback pull goes, per lexicon, when an album isn't in the
 * snapshot. Small on purpose: the snapshot is built from a thousand plays a
 * lexicon (scripts/prefetch.mjs) and is the answer in almost every case, so
 * this only has to cover an album first played since the last build — which is
 * necessarily recent.
 */
const ALBUM_LIVE_MAX = 200;

/**
 * The album a `/listening/albums/{slug}` path names, or null.
 *
 * An album is not a record: it is what a run of plays adds up to (see
 * src/lib/albums.js), so it is derived here from the build's own albums
 * snapshot rather than fetched. A slug the snapshot doesn't answer to falls
 * back to a small, time-boxed live pull — the same shape `nightSession` uses,
 * and for the same reason: the thing somebody just shared a link to is usually
 * newer than the last build.
 */
export async function albumBySlug(slug, origin) {
  const want = String(slug ?? '').trim();
  if (!want) return null;
  const snap = origin ? await fetchJson(`${origin}/data/albums.json`, SNAPSHOT_TIMEOUT_MS) : null;
  const found = findAlbum(albumsFromSnapshot(snap), want);
  if (found) return found;
  const pds = await withTimeout(resolvePds(ME_DID), PDS_TIMEOUT_MS);
  if (!pds) return null;
  const plays = await withTimeout(
    listTealPlays(pds, { repo: ME_DID, max: ALBUM_LIVE_MAX }),
    PDS_TIMEOUT_MS,
  );
  if (!Array.isArray(plays) || !plays.length) return null;
  return findAlbum(buildAlbums(plays), want);
}

/**
 * Meta for one album's page. Same shape `recordMeta` returns, so the middleware
 * treats it identically — with `atUri` null, because an album has no record of
 * its own to advertise. The nearest thing is the plays, and they are already
 * named by the NSID chip.
 */
export async function albumMeta(pathname, origin) {
  const segs = (pathname || '').split('/').filter(Boolean);
  if (segs.length !== 3 || segs[0] !== 'listening' || segs[1] !== 'albums') return null;
  let slug = segs[2];
  try { slug = decodeURIComponent(slug); } catch {}

  const album = await albumBySlug(slug, origin);
  if (!album) return null;
  const { title, description } = albumCardCopy(album);
  return {
    title,
    description,
    textOnly: false,
    section: 'listening',
    atUri: null,
    cid: null,
    nsid: TEAL_PLAY_NSIDS[0],
    publication: null,
    // The card stamps the day the album was last played where other cards stamp
    // the day their record was made — for an album that IS the last time it
    // changed, since nothing else on the page moves.
    date: album.lastPlayed || null,
    canonicalPath: `/listening/albums/${encodeURIComponent(album.slug)}`,
    // An album gets a card of its own rather than the generic title-and-blurb
    // one: what it has to show is the cover. Only the slug reaches the renderer,
    // which reads everything else back off the index.
    ogQuery: `album=${encodeURIComponent(album.slug)}`,
  };
}

/**
 * The albums index, for the /listening/albums card — the first few covers and
 * the totals under them. Null when the snapshot can't be read, which sends the
 * card back to the plain page layout rather than drawing an empty shelf.
 */
export async function albumsIndex(origin, { max = 0 } = {}) {
  const snap = origin ? await fetchJson(`${origin}/data/albums.json`, SNAPSHOT_TIMEOUT_MS) : null;
  const albums = albumsFromSnapshot(snap);
  if (!albums.length) return null;
  return {
    albums: max > 0 ? albums.slice(0, max) : albums,
    total: albums.length,
    plays: albums.reduce((n, a) => n + (a.plays || 0), 0),
    artists: new Set(albums.flatMap((a) => (a.artists || []).map((s) => s.toLowerCase()))).size,
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

/**
 * A short stamp that changes whenever the piece's card would draw differently.
 *
 * Two halves, because two different kinds of edit change this card. `measuredAt`
 * moves on a re-measure, `sealedAt` on the seal, and `postedAt` is all a live
 * piece has — that is the first half, in whole seconds, base 36. The second is
 * the four facts the card sets in type, hashed: a recovered reaction time or a
 * breaker who finally has a name is written onto the record WITHOUT re-measuring
 * it, deliberately, and a card that ignored that would go on saying "ended by
 * @unknown" until something unrelated moved the clock.
 */
function cardVersion(v) {
  const at = Date.parse(v?.measuredAt || v?.sealedAt || v?.postedAt || '');
  const b = v?.breaker || {};
  const drawn = [
    b.currentHandle || b.handle || '',
    b.reactionMs ?? '',
    v?.lifespanMs ?? '',
    v?.preSeal?.participants ?? '',
  ].join('|');
  // djb2. Not a checksum of the record — a cache key for the six things on the
  // card, small enough to sit in a query string.
  let h = 5381;
  for (let i = 0; i < drawn.length; i += 1) h = ((h << 5) + h + drawn.charCodeAt(i)) >>> 0;
  const stamp = Number.isFinite(at) ? Math.floor(at / 1000).toString(36) : '0';
  return `${stamp}${h.toString(36)}`;
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
  // A SEALED piece is finished, and the snapshot's copy of it is as good as the
  // PDS's. An unsealed one is not: the studio writes the record when the post
  // goes up, so a deploy while a piece is running bakes in a piece with no
  // breaker, no reaction time and a lifespan of zero — and the card and the
  // crawler description would go on saying that after it ended, until whenever
  // the site next builds.
  if (found?.value?.sealedAt) return found;
  // The snapshot is a build artefact; a piece published since the last deploy
  // is only on the PDS. Same reason loadPieces() re-reads it.
  return pickPiece(await withTimeout(livePieces(), PDS_TIMEOUT_MS), want) || found;
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
    //
    // `v` is not read by the renderer. It is there because this URL names a
    // record whose contents change ONCE, decisively, and are cached either side
    // of it: the post that starts a piece carries a link to this page, so every
    // card service on the network fetches the image while the piece is still
    // alive — a card that says 0s, ended by nobody, 0 people — and then serves
    // that back when the announcement links the same page after the seal. Take
    // 16 went out that way. Stamping the record's own last-written moment into
    // the URL makes the sealed card a different resource from the live one, so
    // nothing has to expire for it to be right.
    ogQuery: `piece=${encodeURIComponent(take)}&v=${cardVersion(v)}`,
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
 * Two optional fields: `ogQuery`, when the record has a card of its own, and
 * `imageAlt`, when that card shows more than the title says (a photo beside a
 * post's text, somebody else's name over theirs).
 */
export async function recordMeta(pathname, origin) {
  const segs = (pathname || '').split('/').filter(Boolean);
  if (segs.length !== 2) return null;
  const [section, rawSlug] = segs;
  if (!RECORD_SECTIONS.has(section)) return null;

  let slug = rawSlug;
  try { slug = decodeURIComponent(rawSlug); } catch {}

  // /mothing serves two things on one path: a date names a NIGHT (a session,
  // which is derived rather than stored), anything else an observation's
  // iNaturalist id. Same split the router makes — see App.jsx's MothingLeaf.
  if (section === 'mothing' && isNightSlug(slug)) return nightMeta(slug, origin);

  let record = null;
  try {
    if (section === 'blogging') record = await resolveBlog(origin, slug);
    else if (section === 'creating') record = await resolveWork(origin, slug);
    else if (section === 'curating') record = await resolveChannel(origin, slug);
    // A play resolves through the same function the card renderer calls, so the
    // two can't disagree about which record a `/listening/{rkey}` link names —
    // and so a play already in the build's merged archive costs no PDS round
    // trip at the edge.
    else if (section === 'listening') record = await playRecord(slug, origin);
    // A repost or a like is a pointer, and what it points at is the page's
    // real subject: somebody's post. When the AppView can name its author the
    // head credits them; when it can't (a slow read, a deleted post, a Grain
    // favorite) the record still resolves and keeps the plain verb card.
    else if (SUBJECT_SECTIONS[section]) {
      const found = await subjectPost(section, slug);
      record = found?.record || null;
      if (found?.view) {
        // Its own catch: an odd view must cost the card its author, not send
        // a record that exists to the 404 the outer catch would.
        try {
          const meta = subjectMeta(found.record, found.view, section, slug);
          if (meta) return meta;
        } catch {
          /* the plain verb card, below */
        }
      }
    } else if (SECTION_COLLECTIONS[section]) {
      record = await withTimeout(liveByRkey(slug, SECTION_COLLECTIONS[section]), PDS_TIMEOUT_MS);
    }
  } catch {
    record = null;
  }
  return record ? shapeMeta(record, section, slug) : null;
}


/* ------------------------------------------------------------------ */
/* Ratioed participants                                                 */
/* ------------------------------------------------------------------ */

/**
 * The roster and the pieces, as the participant pages read them.
 *
 * Both come from the build's snapshots, which is enough for a card: the roster
 * is regenerated on every deploy and a piece published since then has nobody in
 * it yet. Nothing here re-derives a measurement; the ranking, the living
 * window and the audience join are the same functions the pages call, so a card
 * and the page it links to cannot order the same five people differently.
 *
 * `bundled` is the harvest behind the first eleven pieces and `audience` the
 * dated follower table, both handed in by the caller — they are files in
 * src/data, and the serverless bundle reaches them by require rather than by
 * import (see api/og.js).
 */
export async function ratioedRoster(origin, { bundled = {}, audience = null } = {}) {
  const [pieceRecords, people] = await Promise.all([
    fetchSnapshot(origin, 'ratioed'),
    fetchSnapshot(origin, 'ratioedPeople'),
  ]);
  if (!Array.isArray(people) || !people.length) return null;

  const pieces = (pieceRecords || [])
    .map((r) => ({ rkey: rkeyFromAtUri(r?.uri) || '', ...(r?.value || {}) }))
    .filter((p) => p.take && p.sealedAt);
  // Composed, not chosen. The repair pass wrote afterlife rows onto the first
  // eleven records, so a piece can have a recorded log AND have its whole alive
  // window in the harvest — taking the record's alone read catblanketflower's
  // twelve records as none, and reordered the board's ties along with it.
  const logs = {};
  for (const p of pieces) {
    const log = composeEventLog(p.events, bundled[p.rkey]);
    if (log?.length) logs[p.rkey] = log;
  }
  const resolveEvents = (p) => logs[p.rkey] || null;
  const liveKinds = livingKindsIndex(logs, people);

  // The same set livingRoster measures: anybody who was there while something
  // was standing, with breaking a piece counting as being there.
  const rows = people
    .filter((p) => (p.pre || []).length > 0 || brokenTakes(p).length > 0)
    .map((p) => {
      const pre = takesPresent(p);
      return { ...p, pre, live: pre.length, after: (p.post || []).length, liveKinds: liveKinds(p) || null };
    });

  const audiences = audienceIndex(pieces, resolveEvents, audience);
  return { pieces, people, rows, resolveEvents, audiences };
}

/** How many rows the leaderboard card lists. Five is a podium; past that the
 *  names stop being readable at the size a card gets looked at. */
const BOARD_ROWS = 5;

/** Everything the leaderboard card draws, read off the roster. */
export async function participantsCard(origin, opts) {
  const roster = await ratioedRoster(origin, opts);
  if (!roster) return null;
  const { totals, ranked } = participantBoard(roster.rows, { audiences: roster.audiences });
  if (!totals.people) return null;
  return {
    people: totals.people,
    returned: totals.returned,
    breakers: totals.breakers,
    // Formatted here rather than in the renderer, which is deliberately
    // import-free: the card and the page it links to then round the same number
    // the same way, because they call the same function.
    audience: fmtReach(totals.audience),
    takes: roster.pieces.length,
    top: ranked.slice(0, BOARD_ROWS).map((p) => ({
      rank: p.rank,
      handle: p.h,
      live: p.live,
      broke: brokenTakes(p).length > 0,
    })),
    max: ranked[0]?.live || 1,
  };
}

/** Everything one participant's card draws, or null if nobody answers to that
 *  handle. Free text never reaches the renderer: the query carries a handle,
 *  and a handle that is not in the roster is not a card. */
export async function participantCard(handle, origin, opts) {
  const roster = await ratioedRoster(origin, opts);
  if (!roster) return null;
  const person = findParticipant(roster.rows, handle);
  if (!person) return null;
  const d = participantDossier(person, { pieces: roster.pieces, resolveEvents: roster.resolveEvents });
  const found = roster.audiences[person.did] || roster.audiences[person.h] || null;
  return {
    handle: person.h,
    live: d.live,
    takes: d.takes.filter((t) => t.wasAlive).map((t) => t.take),
    acts: d.acts,
    broke: d.broke,
    total: roster.pieces.length,
    audience: typeof found?.fr === 'number' ? fmtReach(found.fr) : null,
    debut: d.debut?.piece?.postedAt || null,
  };
}

/** The head meta for one participant's page. */
export async function participantMeta(pathname, origin, opts) {
  const segs = (pathname || '').split('/').filter(Boolean);
  if (segs.length !== 4 || segs[0] !== 'creating' || segs[2] !== 'participant') return null;
  const parent = segs[1];
  if (parent !== RATIOED_PATH && parent !== RATIOED_DOC_RKEY) return null;

  const card = await participantCard(segs[3], origin, opts);
  if (!card) return null;
  const ended = card.broke.length
    ? ` They ended ${card.broke.map((t) => `#${String(t).padStart(2, '0')}`).join(' and ')}.`
    : '';
  // Only what the roster itself knows. The record count is a log figure, and
  // this runs in the edge middleware, where the bundled harvest behind the
  // first eleven pieces is not to hand — a description that quoted it would be
  // short by however many of somebody's records were harvested rather than
  // recorded. The card, which renders in the serverless function beside the
  // bundle, shows it.
  return {
    title: `@${card.handle} in Ratioed`,
    description:
      `@${card.handle} was there for ${card.live} of the ${card.total} Ratioed pieces, while ` +
      `${card.live === 1 ? 'it was' : 'they were'} still standing.${ended}`,
    textOnly: false,
    section: 'creating',
    atUri: null,
    cid: null,
    nsid: COLLECTIONS.ratioedPiece,
    publication: RATIOED_PUBLICATION,
    date: card.debut,
    canonicalPath: `/creating/${RATIOED_PATH}/participant/${encodeURIComponent(card.handle)}`,
    ogQuery: `participant=${encodeURIComponent(card.handle)}`,
  };
}

/** The head meta for the leaderboard. */
export async function participantsMeta(pathname, origin, opts) {
  const segs = (pathname || '').split('/').filter(Boolean);
  if (segs.length !== 3 || segs[0] !== 'creating' || segs[2] !== 'participants') return null;
  const parent = segs[1];
  if (parent !== RATIOED_PATH && parent !== RATIOED_DOC_RKEY) return null;

  const card = await participantsCard(origin, opts);
  if (!card) return null;
  return {
    title: 'Ratioed participants',
    // Roster facts only, for the reason participantMeta gives: this runs in the
    // edge middleware, where neither the harvest nor the dated follower table
    // is to hand, and a total quoted without them is short by a quarter of a
    // million followers. The card renders beside both files and says it there.
    description:
      `${card.people} people have been in a Ratioed piece while it was still standing. ` +
      `${card.returned} of them came back for another, and ${card.breakers} ended one.`,
    textOnly: false,
    section: 'creating',
    atUri: null,
    cid: null,
    nsid: COLLECTIONS.ratioedPiece,
    publication: RATIOED_PUBLICATION,
    date: null,
    canonicalPath: `/creating/${RATIOED_PATH}/participants`,
    ogQuery: 'board=1',
  };
}
