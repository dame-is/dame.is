import { useEffect, useState } from 'react';
import { useLocation, matchPath } from 'react-router-dom';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, getRecord, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { ME_DID, COLLECTIONS } from '../config.js';

/**
 * Given the current route, derive the AT URI of its backing record and load
 * its raw value (for the debug overlay + RecordTimestamp).
 *
 * Returns `{ atUri, cid, lexicon, pds, record }` where `record` is the
 * `{uri, cid, value}` shape, or `null` while loading.
 */
export function useAtUri(override) {
  const location = useLocation();
  const [pds, setPds] = useState(null);
  const [info, setInfo] = useState(() => deriveFromRoute(location.pathname, override));

  useEffect(() => {
    setInfo(deriveFromRoute(location.pathname, override));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, override?.atUri]);

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
    if (!info?.atUri) return;

    async function load() {
      const seedRecord = await loadFromSnapshots(info);
      if (!cancelled && seedRecord) {
        setInfo((prev) => ({ ...prev, record: seedRecord, cid: seedRecord.cid || prev.cid }));
      }
      if (!pds) return;
      try {
        const fresh = await fetchRecordFromPds(pds, info);
        if (!cancelled && fresh) {
          setInfo((prev) => ({ ...prev, record: fresh, cid: fresh.cid || prev.cid }));
        }
      } catch {
        // keep snapshot
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.atUri, pds]);

  return { ...info, pds };
}

function deriveFromRoute(pathname, override) {
  if (override?.atUri) {
    return {
      atUri: override.atUri,
      cid: override.cid || null,
      lexicon: override.lexicon || lexiconFromAtUri(override.atUri),
      record: override.record || null,
      route: pathname,
    };
  }

  // Single-record routes
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
  if (pathname === '/about') {
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
    const blogs = await fetchSnapshot('blogs');
    return Array.isArray(blogs) ? blogs.find((r) => r?.value?.slug === info.slug) || null : null;
  }
  if (info.lexicon === COLLECTIONS.creating && info.slug) {
    const works = await fetchSnapshot('creations');
    return Array.isArray(works) ? works.find((r) => r?.value?.slug === info.slug) || null : null;
  }
  return null;
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
    return recs.find((r) => r?.value?.slug === info.slug) || null;
  }
  if (info.lexicon === COLLECTIONS.creating && info.slug) {
    const recs = await listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 }).catch(() => []);
    return recs.find((r) => r?.value?.slug === info.slug) || null;
  }
  return null;
}
