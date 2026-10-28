import { useEffect, useState } from 'react';
import { useLocation, matchPath } from 'react-router-dom';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, getRecord, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import { VERB_TO_COLLECTION, RECORD_ROUTE_SEGMENTS, siblingCollections } from '../lib/recordRoutes.js';
import { TEAL_PLAY_NSIDS } from '../lib/teal.js';
import { showOnCreating, workSlug } from '../lib/publications.js';
import { isNightSlug } from '../lib/mothing.js';
import { isAlbumPath } from '../lib/albums.js';
import { rereadWork } from '../lib/workRecord.js';

const STANDARD_DOC = 'site.standard.document';

/**
 * Given the current route, derive the AT URI of its backing record and load
 * its raw value (for the debug overlay + RecordTimestamp).
 *
 * Returns `{ atUri, cid, lexicon, pds, record, recordStatus }` where
 *   - `record` is `{uri, cid, value}` once resolved, or `null`
 *   - `recordStatus` is `'idle' | 'loading' | 'ready' | 'missing' | 'none'`
 *     ('none' means the route has no backing record at all)
 */
export function useAtUri(override) {
  const location = useLocation();
  const [pds, setPds] = useState(null);
  const [info, setInfo] = useState(() => withInitialStatus(deriveFromRoute(location.pathname, override)));

  useEffect(() => {
    const next = withInitialStatus(deriveFromRoute(location.pathname, override));
    setInfo((prev) => keepLoadedRecord(prev, next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, override?.atUri, override?.cid]);

  useEffect(() => {
    let cancelled = false;
    ownPds()
      .then((endpoint) => {
        if (!cancelled) setPds(endpoint);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // We can fetch by atUri (most routes) or by rkey+lexicon (app.bsky.feed.post
    // where the repo DID isn't known yet) or by slug (blogs, works).
    const canResolve = info?.atUri || info?.rkey || info?.slug;
    if (!canResolve) {
      setInfo((prev) => (prev.recordStatus === 'none' ? prev : { ...prev, recordStatus: 'none' }));
      return;
    }

    setInfo((prev) => (prev.recordStatus === 'loading' ? prev : { ...prev, recordStatus: 'loading' }));

    // `fresh` is set when this run was sent by a bumped `refresh` (the page
    // told us about a newer version of the record than the one held), so the
    // live read skips the shared cache.
    const freshRead = Boolean(info.fresh);

    async function load() {
      let found = false;
      const seedRecord = await sharedLookup('snapshot', info, () => loadFromSnapshots(info));
      if (!cancelled && seedRecord) {
        found = true;
        setInfo((prev) => ({
          ...prev,
          record: seedRecord,
          // The resolved record's own URI beats the one derived from the
          // route: a `/{verb}/{rkey}` path can only guess the lexicon, and
          // `listening` spans two of them.
          atUri: seedRecord.uri || prev.atUri || null,
          cid: seedRecord.cid || prev.cid,
          recordStatus: 'ready',
        }));
      }
      // Awaited here rather than held as a dependency: keying this effect on
      // the endpoint ran the whole lookup twice per record, once before the
      // PDS was known (snapshot only) and again after.
      const endpoint = await ownPds().catch(() => null);
      if (cancelled) return;
      if (endpoint) {
        const fresh = await sharedLookup(
          'pds',
          info,
          () => fetchRecordFromPds(endpoint, info, seedRecord),
          { fresh: freshRead },
        );
        if (!cancelled && fresh) {
          found = true;
          setInfo((prev) => ({
            ...prev,
            record: fresh,
            atUri: fresh.uri || prev.atUri || null,
            cid: fresh.cid || prev.cid,
            recordStatus: 'ready',
          }));
        }
      }
      if (!cancelled && !found) {
        setInfo((prev) => (prev.record ? prev : { ...prev, recordStatus: 'missing' }));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // Keyed on what was asked for (`query`), not on `atUri`: a slug-routed
    // page only learns its URI from the record this loader finds, and keying on
    // the URI it had just filled in sent the whole lookup round a second time.
    // The route too, because a new route starts from a blank record even when
    // it asks for the same one as the last (two paths to one record).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.query, info?.route, info?.refresh]);

  return { ...info, pds };
}

/**
 * The next derivation for a route, keeping the record already loaded for it
 * when the new one still names that record.
 *
 * A record page registers its record with PageShell more than once — from the
 * URL as it mounts, then again with the cid once its own fetch lands — and every
 * registration re-derives here. Starting from scratch each time dropped a record
 * this hook had already loaded, and because the identity (so the loader's deps)
 * hadn't moved, nothing fetched it again: the footer settled on "written — ·
 * updated —" under a record that was right there on the page.
 *
 * A cid the held record doesn't carry means it has changed since it loaded (an
 * edit), so `refresh` sends the loader round once more, with the old version on
 * screen until the new one lands, and `fresh` has that one run read past the
 * shared cache. A different record starts clean: the footer's hook lives as
 * long as the app, and an edit on one page is no reason to skip the cache on
 * every page after it.
 *
 * A derivation that asks for exactly what the last one did, on the same route,
 * keeps whatever the loader has found or is still finding: the loader only
 * runs again when the ask (or the route) moves, so starting it over at
 * 'loading' would leave it there for good.
 */
function keepLoadedRecord(prev, next) {
  const held = prev?.record;
  const refresh = prev?.refresh || 0;
  const sameRecord =
    Boolean(held) &&
    !next.record &&
    prev.route === next.route &&
    Boolean(next.atUri) &&
    (next.atUri === prev.atUri || next.atUri === held.uri);
  if (!sameRecord) {
    const sameAsk =
      Boolean(prev) &&
      !next.record &&
      prev.route === next.route &&
      prev.query === next.query;
    if (sameAsk) {
      return next.cid && next.cid !== prev.cid
        ? { ...prev, cid: next.cid }
        : prev;
    }
    return { ...next, refresh, fresh: false };
  }
  const changed = Boolean(next.cid && held.cid && next.cid !== held.cid);
  if (!changed) return { ...prev, cid: next.cid || prev.cid };
  return { ...prev, cid: next.cid, refresh: refresh + 1, fresh: true };
}

// One PLC lookup for every consumer of this hook, rather than one each.
let pdsPromise = null;
function ownPds() {
  if (!pdsPromise) {
    pdsPromise = resolvePds(ME_DID).catch((err) => {
      pdsPromise = null;
      throw err;
    });
  }
  return pdsPromise;
}

// Every consumer of this hook on a page — the <head> hints, the footer's
// timestamp, the x-ray layer — asks after the same record, and each used to run
// its own snapshot parse and its own PDS read for it (posts.json is 3 MB, parsed
// twice over for a footer). One lookup per record now serves them all: an
// in-flight answer is shared, and a settled one is reused for long enough to
// cover a page's consumers mounting a beat apart, but not so long that coming
// back to a page later hides an edit made in between.
const LOOKUP_TTL_MS = 15_000;
const lookups = new Map();

function sharedLookup(kind, info, run, { fresh = false } = {}) {
  // Keyed on the record, not on how it was asked for: the footer's route-derived
  // lookup and a page's registered one name the same at:// URI.
  const key = `${kind}|${info.atUri || [info.lexicon, info.rkey, info.slug].map((p) => p || '').join('|')}`;
  const now = Date.now();
  const held = lookups.get(key);
  // A fresh read still shares one in flight: the head hints and the footer
  // both hear of the same new cid, and one request answers them both.
  if (held && (held.pending || (!fresh && now - held.at < LOOKUP_TTL_MS))) return held.promise;
  for (const [k, entry] of lookups) {
    if (!entry.pending && now - entry.at >= LOOKUP_TTL_MS) lookups.delete(k);
  }
  const entry = { pending: true, at: 0, promise: null };
  entry.promise = Promise.resolve()
    .then(run)
    .catch(() => null);
  entry.promise.then(() => {
    entry.pending = false;
    entry.at = Date.now();
  });
  lookups.set(key, entry);
  return entry.promise;
}

function withInitialStatus(info) {
  if (!info) return info;
  const canResolve = info.atUri || info.rkey || info.slug;
  return {
    ...info,
    // What the route (or a page's registration) named, fixed for the life of
    // this derivation; the loader only ever fills in the rest.
    query: [info.atUri, info.lexicon, info.rkey, info.slug]
      .map((p) => p || '')
      .join('|'),
    recordStatus: canResolve ? 'loading' : 'none',
  };
}

function deriveFromRoute(pathname, override) {
  if (override?.atUri) {
    return {
      atUri: override.atUri,
      cid: override.cid || null,
      lexicon: override.lexicon || lexiconFromAtUri(override.atUri),
      // Carry the rkey so the generic by-rkey snapshot/PDS lookups can
      // resolve override-driven records (e.g. /available's dynamically
      // selected is.dame.resume) — collections without a bespoke branch
      // below would otherwise never fetch.
      rkey: override.rkey || rkeyFromAtUri(override.atUri) || null,
      record: override.record || null,
      route: pathname,
    };
  }

  // Slug-routed pages first — `/blogging/:slug` and `/creating/:slug` are
  // addressed by a human slug, NOT the rkey, so they must be matched before
  // the generic `/:verb/:rkey` loop below (which would otherwise treat the
  // slug as an rkey under the verb's primary collection and never resolve).
  const blogMatch = matchPath('/blogging/:slug', pathname);
  if (blogMatch) {
    return {
      // The blog's `:slug` is the document's rkey (BlogPost resolves it as
      // one), so its URI is known before anything loads — and matches the one
      // the page registers once it has the record.
      atUri: `at://${ME_DID}/${COLLECTIONS.blogging}/${blogMatch.params.slug}`,
      cid: null,
      lexicon: COLLECTIONS.blogging,
      slug: blogMatch.params.slug,
      record: null,
      route: pathname,
    };
  }
  const workMatch = matchPath('/creating/:slug', pathname);
  if (workMatch) {
    return {
      atUri: null,
      cid: null,
      lexicon: COLLECTIONS.creating,
      slug: workMatch.params.slug,
      record: null,
      route: pathname,
    };
  }

  // `/mothing/:date` is a NIGHT, not a record. A session is what a night's
  // worth of observations add up to — the site derives it, nothing on the PDS
  // holds it — so there is no at:// URI to claim. Without this the generic
  // loop below would read the date as an observation rkey and advertise a
  // record that isn't there. App.jsx's router makes the same split.
  const nightMatch = matchPath('/mothing/:slug', pathname);
  if (nightMatch && isNightSlug(nightMatch.params.slug)) {
    return { atUri: null, cid: null, lexicon: null, record: null, route: pathname };
  }

  // `/listening/albums` is the shelf and `/listening/albums/:slug` one album,
  // and an album is what a run of plays adds up to rather than a record anyone
  // holds — so, like a night, neither has an at:// URI to claim. Without this
  // the generic loop below would read `albums` as a play's record key and
  // advertise `fm.teal.feed.play/albums`, which does not exist.
  if (isAlbumPath(pathname)) {
    return { atUri: null, cid: null, lexicon: null, record: null, route: pathname };
  }

  // Generic single-record routes — /:verb-or-nsid/:rkey
  for (const segment of RECORD_ROUTE_SEGMENTS) {
    const m = matchPath(`/${segment}/:rkey`, pathname);
    if (!m) continue;
    const collection = VERB_TO_COLLECTION[segment] || segment;
    const rkey = m.params.rkey;
    // A post under /posting is Dame's own (Record.jsx reads it from Dame's
    // repo), so it can be addressed straight away. A /reposting key, if it is
    // ever read as a post, names the post that was reposted, which may live
    // under another author's DID — that URI stays unset until the page
    // registers the record it found.
    const repoDid = collection === 'app.bsky.feed.post' && segment === 'reposting' ? null : ME_DID;
    return {
      atUri: repoDid ? `at://${repoDid}/${collection}/${rkey}` : null,
      cid: null,
      lexicon: collection,
      rkey,
      record: null,
      route: pathname,
    };
  }

  // Page routes — backed by is.dame.page records keyed by literal name.
  const page = pageRkeyForPath(pathname);
  if (page) {
    return {
      atUri: `at://${ME_DID}/${COLLECTIONS.page}/${page}`,
      cid: null,
      lexicon: COLLECTIONS.page,
      record: null,
      route: pathname,
    };
  }
  if (pathname === '/themself') {
    // Asked for by rkey, and named only once found. is.dame.profile/self is a
    // record the owner writes when they get to it; until then claiming its URI
    // advertised a link to nothing (and offered an editor for a record that
    // isn't there). The loader fills `atUri` in from the record it finds, as
    // middleware.js does for crawlers.
    return {
      atUri: null,
      cid: null,
      lexicon: COLLECTIONS.profile,
      rkey: 'self',
      record: null,
      route: pathname,
    };
  }
  return { atUri: null, cid: null, lexicon: null, record: null, route: pathname };
}

function pageRkeyForPath(pathname) {
  // The home route ('/' + its '/index' alias) is intentionally omitted: the
  // feed aggregates many records rather than being backed by a single
  // is.dame.page/home record. No such record exists, `home` isn't in
  // PAGE_REGISTRY, and nothing renders it — so claiming it only made the debug
  // pane's "Edit record" fetch a missing record and surface the raw PDS
  // "Could not locate record" error. Mirrors middleware.js's
  // TOP_LEVEL_PAGE_RKEY, which also excludes home.
  if (pathname === '/posting') return 'posting';
  if (pathname === '/logging') return 'logging';
  if (pathname === '/blogging') return 'blogging';
  if (pathname === '/creating') return 'creating';
  if (pathname === '/sharing') return 'sharing';
  if (pathname === '/listening') return 'listening';
  return null;
}

function lexiconFromAtUri(atUri) {
  const m = String(atUri || '').match(/^at:\/\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}

async function loadFromSnapshots(info) {
  if (info.lexicon === COLLECTIONS.page) {
    const pages = await fetchSnapshot('pages');
    const rkey = info.atUri && rkeyFromAtUri(info.atUri);
    return rkey && pages?.[rkey] ? pages[rkey] : null;
  }
  if (info.lexicon === COLLECTIONS.profile) {
    const ext = await fetchSnapshot('extendedProfile');
    return ext && ext.uri ? ext : null;
  }
  if (info.lexicon === COLLECTIONS.blogging && info.slug) {
    // `/blogging/:id` is backed by site.standard.document, addressed by rkey.
    const blogs = await fetchSnapshot('blogs');
    const found = Array.isArray(blogs)
      ? blogs.find((r) => endsWithRkey(r?.uri, info.slug)) || null
      : null;
    return mirrorLeafletTimestamps(found);
  }
  // No snapshot branch for pub.leaflet.document: prefetch writes no file of
  // them, so asking for one was a certain 404 ahead of every leaflet's live
  // read. fetchRecordFromPds finds them by rkey.
  if (info.lexicon === COLLECTIONS.creating && info.slug) {
    // Creative works are site.standard.document records (in `blogs`, matched
    // by path — or rkey for a blog-homed doc cross-posted here without one)
    // plus any legacy is.dame.creating.work (in `creations`).
    const blogs = await fetchSnapshot('blogs');
    const std = Array.isArray(blogs)
      ? blogs.find(
          (r) =>
            showOnCreating(r?.value) &&
            (workSlug(r.value) === info.slug || rkeyFromAtUri(r?.uri) === info.slug),
        )
      : null;
    if (std) return mirrorLeafletTimestamps(std);
    const works = await fetchSnapshot('creations');
    return Array.isArray(works) ? works.find((r) => workSlug(r?.value) === info.slug) || null : null;
  }

  // By-rkey lookups for the generic record routes.
  if (info.rkey) {
    const snapshotName = SNAPSHOT_FOR_COLLECTION[info.lexicon];
    if (!snapshotName) return null;
    const snap = await fetchSnapshot(snapshotName);
    if (!Array.isArray(snap)) return null;
    return snap.find((r) => endsWithRkey(r?.uri, info.rkey)) || null;
  }
  return null;
}

// No `app.bsky.feed.post` here on purpose. posts.json is the biggest snapshot
// the site ships (3 MB, most of it reply context), and a post page only ever
// wanted one record's timestamps out of it — which Dame's own PDS hands back in
// a single small getRecord (see fetchRecordFromPds). It also only ever held the
// newest few hundred posts, so an older post's footer came up empty anyway.
const SNAPSHOT_FOR_COLLECTION = {
  [COLLECTIONS.now]: 'now',
  [COLLECTIONS.blogging]: 'blogs',
  [COLLECTIONS.creating]: 'creations',
  // Both teal.fm play lexicons: the merged `listening.json` spans the
  // namespace move, so either name resolves out of the same file.
  ...Object.fromEntries(TEAL_PLAY_NSIDS.map((nsid) => [nsid, 'listening'])),
};

function endsWithRkey(uri, rkey) {
  if (!uri) return false;
  const m = String(uri).match(/\/([^/]+)$/);
  return m && m[1] === rkey;
}

/**
 * Leaflet documents only carry `publishedAt` natively. Mirror it onto
 * `createdAt` / `updatedAt` so the footer's <RecordTimestamp /> and
 * other shared helpers can stay agnostic of the lexicon.
 *
 * On a copy: a snapshot record is one parsed object shared with every other
 * reader of that file (see fetchSnapshot), so it isn't this hook's to write to.
 */
function mirrorLeafletTimestamps(record) {
  if (!record?.value) return record;
  const v = record.value;
  const createdAt = v.createdAt || v.publishedAt;
  const updatedAt = v.updatedAt || createdAt;
  if (createdAt === v.createdAt && updatedAt === v.updatedAt) return record;
  return { ...record, value: { ...v, createdAt, updatedAt } };
}

async function fetchRecordFromPds(pds, info, seed) {
  if (info.lexicon === COLLECTIONS.page) {
    const rkey = info.atUri && rkeyFromAtUri(info.atUri);
    if (!rkey) return null;
    return getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.page, rkey }).catch(() => null);
  }
  if (info.lexicon === COLLECTIONS.profile) {
    return getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.profile, rkey: 'self' }).catch(() => null);
  }
  if (info.lexicon === COLLECTIONS.blogging && info.slug) {
    // `/blogging/:id` is addressed by rkey (as the snapshot lookup above
    // assumes), so one getRecord answers it — no need to list every document.
    const rec = await getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.blogging, rkey: info.slug }).catch(
      () => null,
    );
    return mirrorLeafletTimestamps(rec?.value ? rec : null);
  }
  if (info.lexicon === COLLECTIONS.leaflet) {
    const wanted = info.rkey || info.slug;
    if (!wanted) return null;
    const rec = await getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.leaflet, rkey: wanted }).catch(() => null);
    return mirrorLeafletTimestamps(rec);
  }
  if (info.lexicon === COLLECTIONS.creating && info.slug) {
    // The snapshot already said which record this slug names, so re-read just
    // that one (see lib/workRecord.js); the listing is for a work it didn't
    // know.
    const known = await rereadWork(pds, seed, info.slug);
    if (known) return known;
    const std = await listRecords(pds, { repo: ME_DID, collection: STANDARD_DOC, max: 200 }).catch(() => []);
    const byStd =
      std.find(
        (r) =>
          showOnCreating(r?.value) &&
          (workSlug(r.value) === info.slug || rkeyFromAtUri(r?.uri) === info.slug),
      ) || null;
    if (byStd) return mirrorLeafletTimestamps(byStd);
    const recs = await listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 }).catch(() => []);
    return recs.find((r) => workSlug(r?.value) === info.slug) || null;
  }
  // A post is read from Dame's repo only when the URI says it lives there —
  // a post addressed by rkey alone may be someone else's.
  if (info.lexicon === 'app.bsky.feed.post') {
    const own = String(info.atUri || '').startsWith(`at://${ME_DID}/`);
    if (!own || !info.rkey) return null;
    return getRecord(pds, { repo: ME_DID, collection: info.lexicon, rkey: info.rkey }).catch(() => null);
  }
  // Generic by-rkey live fetch for our own PDS-backed collections. A
  // `/{verb}/{rkey}` route only guessed at the lexicon, so try the verb's
  // siblings before giving up: on `/listening/{rkey}` the guess is teal.fm's
  // production lexicon and the play may well still be an alpha one.
  if (info.rkey && info.lexicon) {
    for (const collection of siblingCollections(info.lexicon)) {
      const rec = await getRecord(pds, { repo: ME_DID, collection, rkey: info.rkey }).catch(() => null);
      if (rec?.value) return rec;
    }
  }
  return null;
}

