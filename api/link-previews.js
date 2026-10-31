// Vercel serverless function: the hover previews for one document's links,
// looked up now. The build writes them for every document it knows
// (scripts/prefetch.mjs); this answers for one published or edited since,
// which would otherwise show its links bare for up to six hours, just when its
// author is most likely to be reading it.
//
//   GET /api/link-previews?uri=at://<me>/<collection>/<rkey>&cid=<cid>
//
// The answer is the same shape as the build's file. It is not a way to look up
// any URL: the links come from the record, read from the PDS, and only the
// site owner's documents in the collections that render them are read at all.
// The `cid` must be the record's current one, so every distinct answer belongs
// to a real version of a real document, and the CDN keeps each for a week. A
// stale or invented `cid` costs one record read and a 409.
//
// Pictures go through the image proxy, since nothing here can shrink them;
// the next build replaces them with its own small copies.

import { ME_DID, COLLECTIONS } from '../src/config.js';
import { getRecord, resolvePds } from '../src/lib/atproto.js';
import { documentLinks } from '../src/lib/linkPreviews.js';
import { liveMedia, resolveLinks } from './_lib/linkPreviews.js';

export const config = { maxDuration: 30 };

// The collections LeafletDocument draws: essays and works, the legacy works,
// the profile's long-form body.
const DOCUMENT_COLLECTIONS = new Set([
  COLLECTIONS.blogging,
  COLLECTIONS.leaflet,
  'is.dame.creating.work',
  COLLECTIONS.profile,
]);

/** `{ collection, rkey }` of one of the owner's documents, or null. */
export function parseDocumentUri(uri) {
  const m = String(uri || '').match(/^at:\/\/([^/]+)\/([a-z0-9.-]+)\/([A-Za-z0-9._:~-]{1,512})$/i);
  if (!m || m[1] !== ME_DID || !DOCUMENT_COLLECTIONS.has(m[2])) return null;
  return { collection: m[2], rkey: m[3] };
}

export default async function handler(req, res) {
  const uri = req.query?.uri;
  const cid = String(req.query?.cid || '');
  const doc = parseDocumentUri(uri);
  if (!doc) {
    return res.status(400).json({ error: 'Pass `uri`, one of this site’s documents.' });
  }
  if (!/^[a-z0-9]{8,128}$/i.test(cid)) {
    return res.status(400).json({ error: 'Pass `cid`, the document version to read.' });
  }

  let record;
  try {
    const pds = await resolvePds(ME_DID);
    record = await getRecord(pds, { repo: ME_DID, collection: doc.collection, rkey: doc.rkey });
  } catch (err) {
    res.setHeader('cache-control', 'no-store');
    const status = err?.status === 400 || err?.status === 404 ? 404 : 502;
    return res.status(status).json({ error: status === 404 ? 'No such document.' : 'Couldn’t read the document.' });
  }
  if (record?.cid !== cid) {
    // An edit since the page loaded, or a made-up version. Briefly cached, so
    // a burst of the same wrong one costs one read.
    res.setHeader('cache-control', 'public, max-age=0, s-maxage=60');
    return res.status(409).json({ error: 'That isn’t the document’s current version.', cid: record?.cid || null });
  }

  const value = record.value || {};
  const links = documentLinks(value.content ?? value);
  const { previews, icons, failed } = await resolveLinks(links, {
    media: liveMedia(),
    concurrency: 8,
    perLinkMs: 5000,
    deadlineMs: 12_000,
  });

  // A version's links don't change, so a whole answer keeps for a week. One
  // with gaps is kept for minutes, so a site that was down gets asked again.
  res.setHeader(
    'cache-control',
    failed.length
      ? 'public, max-age=60, s-maxage=600'
      : 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400',
  );
  return res.status(200).json({
    uri,
    cid,
    builtAt: new Date().toISOString(),
    live: true,
    previews,
    icons,
    failed,
  });
}
