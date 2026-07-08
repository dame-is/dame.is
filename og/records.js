// Edge-safe resolver for per-record page metadata (blog posts, creative works,
// curated channels). middleware.js uses this to give record routes a real
// "<record title> — dame.is" <title> + OG tags for crawlers, instead of the
// generic site card. Plain fetch only, so it runs in the Edge runtime.
//
// A record route is /{section}/{rkey} where {section} maps to one or more AT
// Protocol collections to try (the site addresses these by slug=rkey). We
// resolve Dame's PDS via the PLC directory, then getRecord until one hits.
// Everything is defensive: any failure returns null and the caller falls back
// to the section card, so a slow/broken PDS never blocks the page.

const ME_DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // mirrors src/config.js ME_DID
const PLC_DIRECTORY = 'https://plc.directory';
const TIMEOUT_MS = 2500;

// section (first path segment) → collections to try, in order. Mirrors the
// slug-addressed record routes in src/App.jsx / src/lib/recordRoutes.js.
const RECORD_COLLECTIONS = {
  blogging: ['site.standard.document', 'pub.leaflet.document'],
  creating: ['is.dame.creating.work'],
  curating: ['is.dame.arena.channel'],
};

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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

async function resolvePds(did) {
  const doc = await fetchJson(`${PLC_DIRECTORY}/${did}`);
  const services = doc?.service || [];
  const pds = services.find((s) => s.id === '#atproto_pds')?.serviceEndpoint || services[0]?.serviceEndpoint;
  return pds ? pds.replace(/\/$/, '') : null;
}

async function getRecordValue(pds, collection, rkey) {
  const params = new URLSearchParams({ repo: ME_DID, collection, rkey });
  const json = await fetchJson(`${pds}/xrpc/com.atproto.repo.getRecord?${params}`);
  return json?.value || null;
}

/** True if `pathname` looks like a slug-addressed record route we can resolve. */
export function isRecordRoute(pathname) {
  const segs = (pathname || '').split('/').filter(Boolean);
  return segs.length === 2 && Boolean(RECORD_COLLECTIONS[segs[0]]);
}

/**
 * Resolve a record route to `{ title, description, section }`, or null if it's
 * not a record route or the record can't be fetched. `title` is the record's
 * own title; `description` is its summary/subtitle when present.
 */
export async function recordMeta(pathname) {
  const segs = (pathname || '').split('/').filter(Boolean);
  if (segs.length !== 2) return null;
  const [section, rawRkey] = segs;
  const collections = RECORD_COLLECTIONS[section];
  if (!collections) return null;

  let rkey = rawRkey;
  try { rkey = decodeURIComponent(rawRkey); } catch {}

  const pds = await resolvePds(ME_DID);
  if (!pds) return null;

  for (const collection of collections) {
    const value = await getRecordValue(pds, collection, rkey);
    const title = value && (value.title || value.name);
    if (title) {
      const description = value.description || value.summary || value.subtitle || '';
      return { title: String(title).trim(), description: String(description).trim(), section };
    }
  }
  return null;
}
