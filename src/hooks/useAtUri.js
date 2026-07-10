import { useEffect, useState } from 'react';
import { useLocation, matchPath } from 'react-router-dom';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, getRecord, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import { VERB_TO_COLLECTION, RECORD_ROUTE_SEGMENTS } from '../lib/recordRoutes.js';
import { showOnCreating, workSlug } from '../lib/publications.js';

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
    setInfo(withInitialStatus(deriveFromRoute(location.pathname, override)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, override?.atUri, override?.cid]);

  useEffect(() => {
    let cancelled = false;
    async function loadPds() {
      try {
        const endpoint = await resolvePds(ME_DID);
        if (!cancelled) setPds(endpoint);
      } catch {
        // ignore
      }
    }
    loadPds();
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

    async function load() {
      let found = false;
      const seedRecord = await loadFromSnapshots(info);
      if (!cancelled && seedRecord) {
        found = true;
        setInfo((prev) => ({
          ...prev,
          record: seedRecord,
          atUri: prev.atUri || seedRecord.uri || null,
          cid: seedRecord.cid || prev.cid,
          recordStatus: 'ready',
        }));
      }
      // Wait for the PDS endpoint before falling back to "missing" — if we
      // haven't resolved it yet there's still hope a live fetch will succeed.
      if (!pds) {
        if (!cancelled && !found) {
          // Hold in 'loading' until pds is known; effect re-runs once it is.
        }
        return;
      }
      try {
        const fresh = await fetchRecordFromPds(pds, info);
        if (!cancelled && fresh) {
          found = true;
          setInfo((prev) => ({
            ...prev,
            record: fresh,
            atUri: prev.atUri || fresh.uri || null,
            cid: fresh.cid || prev.cid,
            recordStatus: 'ready',
          }));
        }
      } catch {
        // keep snapshot
      }
      if (!cancelled && !found) {
        setInfo((prev) => (prev.record ? prev : { ...prev, recordStatus: 'missing' }));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.atUri, info?.rkey, info?.slug, info?.lexicon, pds]);

  return { ...info, pds };
}

function withInitialStatus(info) {
  if (!info) return info;
  const canResolve = info.atUri || info.rkey || info.slug;
  return { ...info, recordStatus: canResolve ? 'loading' : 'none' };
}

function deriveFromRoute(pathname, override) {
  if (override?.atUri) {
    return {
      atUri: override.atUri,
      cid: override.cid || null,
      lexicon: override.lexicon || lexiconFromAtUri(override.atUri),
      // Carry the rkey so the generic by-rkey snapshot/PDS lookups can
      // resolve override-driven records (e.g. /for-hire's dynamically
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
      atUri: null, // resolved by slug below
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

  // Generic single-record routes — /:verb-or-nsid/:rkey
  for (const segment of RECORD_ROUTE_SEGMENTS) {
    const m = matchPath(`/${segment}/:rkey`, pathname);
    if (!m) continue;
    const collection = VERB_TO_COLLECTION[segment] || segment;
    const rkey = m.params.rkey;
    // Posts may live under another author's DID; we leave the URI unset for
    // now and let the page render its own AT URI hint after lookup.
    const repoDid = collection === 'app.bsky.feed.post' ? null : ME_DID;
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
    return {
      atUri: `at://${ME_DID}/${COLLECTIONS.profile}/self`,
      cid: null,
      lexicon: COLLECTIONS.profile,
      record: null,
      route: pathname,
    };
  }
  return { atUri: null, cid: null, lexicon: null, record: null, route: pathname };
}

function pageRkeyForPath(pathname) {
  if (pathname === '/' || pathname === '/index') return 'home';
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
  if (info.lexicon === COLLECTIONS.leaflet && (info.rkey || info.slug)) {
    const wanted = info.rkey || info.slug;
    const leaflets = await fetchSnapshot('leaflets');
    return Array.isArray(leaflets)
      ? leaflets.find((r) => endsWithRkey(r?.uri, wanted)) || null
      : null;
  }
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
    if (info.lexicon === 'app.bsky.feed.post') {
      const row = snap.find((r) => endsWithRkey(r?.post?.uri, info.rkey));
      return row?.post ? { uri: row.post.uri, cid: row.post.cid, value: row.post.record } : null;
    }
    return snap.find((r) => endsWithRkey(r?.uri, info.rkey)) || null;
  }
  return null;
}

const SNAPSHOT_FOR_COLLECTION = {
  'app.bsky.feed.post': 'posts',
  [COLLECTIONS.now]: 'now',
  [COLLECTIONS.blogging]: 'blogs',
  [COLLECTIONS.creating]: 'creations',
  [COLLECTIONS.listen]: 'listening',
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
 */
function mirrorLeafletTimestamps(record) {
  if (!record?.value) return record;
  const v = record.value;
  if (!v.createdAt && v.publishedAt) v.createdAt = v.publishedAt;
  if (!v.updatedAt) v.updatedAt = v.createdAt;
  return record;
}

async function fetchRecordFromPds(pds, info) {
  if (info.lexicon === COLLECTIONS.page) {
    const rkey = info.atUri && rkeyFromAtUri(info.atUri);
    if (!rkey) return null;
    return getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.page, rkey }).catch(() => null);
  }
  if (info.lexicon === COLLECTIONS.profile) {
    return getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.profile, rkey: 'self' }).catch(() => null);
  }
  if (info.lexicon === COLLECTIONS.blogging && info.slug) {
    const recs = await listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.blogging, max: 200 }).catch(() => []);
    return mirrorLeafletTimestamps(recs.find((r) => endsWithRkey(r?.uri, info.slug)) || null);
  }
  if (info.lexicon === COLLECTIONS.leaflet) {
    const wanted = info.rkey || info.slug;
    if (!wanted) return null;
    const rec = await getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.leaflet, rkey: wanted }).catch(() => null);
    return mirrorLeafletTimestamps(rec);
  }
  if (info.lexicon === COLLECTIONS.creating && info.slug) {
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
  // Generic by-rkey live fetch for our own PDS-backed collections. Skip
  // app.bsky.feed.post — those records may live under another author's repo.
  if (info.rkey && info.lexicon && info.lexicon !== 'app.bsky.feed.post') {
    return getRecord(pds, { repo: ME_DID, collection: info.lexicon, rkey: info.rkey }).catch(() => null);
  }
  return null;
}
