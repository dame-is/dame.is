// Vercel serverless function: stream a remote image through our own origin so
// the block editor can pull a link's preview image (og:image) and re-upload it
// to the author's PDS as a blob. A straight browser fetch of the remote image
// is blocked by CORS on most hosts; proxying through dame.is sidesteps that and
// hands the client clean bytes + content-type it can wrap in a File.
//
// Read-only, owner-facing (used only inside the admin editor), but still guard
// the obvious feet: http(s) only, raster image types only, a size cap, and a
// time limit.
//
// "Raster only" is the security boundary, not a nicety. Whatever this returns
// is served FROM dame.is, and an SVG is a document that can carry <script>: a
// link to /api/image-proxy?url=<someone's .svg> opened in a tab ran that script
// on this origin, where the signed-in owner's OAuth session lives. So the
// upstream type is checked against a short list rather than a `image/` prefix,
// and the response is locked down (sandbox CSP, nosniff, an inline filename)
// so that even a mislabelled body can't become a page.

import {
  assertPublicHttpUrl,
  isCrossSiteRequest,
  UPSTREAM_TIMEOUT_MS,
} from './_lib/ssrfGuard.js';

const MAX_BYTES = 8 * 1024 * 1024; // og images are small; refuse anything huge.
const MAX_REDIRECTS = 3; // re-validate every hop against the SSRF guard.

// The formats a PDS blob upload and every browser will take as a picture and
// nothing else. Deliberately no image/svg+xml (see the header comment).
const RASTER_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

/** The bare media type of a Content-Type header: "Image/PNG; x=1" → "image/png". */
export function baseMediaType(contentType) {
  return String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

/**
 * Read a response body, giving up as soon as it passes `limit` bytes. Returns
 * the bytes, or null when the body was too big — in which case the rest of it
 * is never downloaded.
 */
async function readCapped(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length > limit ? null : buf;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (isCrossSiteRequest(req)) {
    return res
      .status(403)
      .json({ error: 'Cross-site requests are not allowed.' });
  }

  const url = req.query?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Pass a valid http(s) `url` query param.' });
  }

  let current;
  try {
    current = await assertPublicHttpUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err?.message || 'Refused to fetch that URL.' });
  }

  try {
    const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    // Follow redirects by hand so every hop is re-checked by the SSRF guard —
    // `redirect:'follow'` would silently chase a Location into a private host.
    let upstream;
    let hops = 0;
    for (;;) {
      upstream = await fetch(current.href, {
        headers: { 'user-agent': 'Mozilla/5.0 (dame.is link unfurl)' },
        redirect: 'manual',
        signal,
      });
      const location = upstream.status >= 300 && upstream.status < 400
        ? upstream.headers.get('location')
        : null;
      if (!location) break;
      if (hops >= MAX_REDIRECTS) {
        return res.status(502).json({ error: 'Too many redirects.' });
      }
      hops += 1;
      let next;
      try {
        next = new URL(location, current.href);
      } catch {
        return res.status(502).json({ error: 'Bad redirect location.' });
      }
      try {
        current = await assertPublicHttpUrl(next.href);
      } catch (err) {
        return res.status(400).json({ error: err?.message || 'Refused to follow redirect.' });
      }
      upstream.body?.cancel?.().catch(() => {});
    }
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream ${upstream.status}` });
    }
    const type = baseMediaType(upstream.headers.get('content-type'));
    if (!RASTER_TYPES.has(type)) {
      upstream.body?.cancel?.().catch(() => {});
      return res
        .status(415)
        .json({ error: `Not a supported image (${type || 'unknown type'}).` });
    }
    // A declared length over the cap is refused before a byte is read; a body
    // that lies about it (or sends none) is cut off by the capped read.
    const declared = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      upstream.body?.cancel?.().catch(() => {});
      return res.status(413).json({ error: 'Image too large.' });
    }
    const buf = await readCapped(upstream, MAX_BYTES);
    if (!buf) {
      return res.status(413).json({ error: 'Image too large.' });
    }
    // The normalised type, never the upstream's raw header, so nothing it
    // appended rides along.
    res.setHeader('content-type', type);
    res.setHeader('content-length', String(buf.length));
    res.setHeader('content-security-policy', "default-src 'none'; sandbox");
    res.setHeader('content-disposition', 'inline; filename="preview"');
    res.setHeader('x-content-type-options', 'nosniff');
    // Private: this is one person's editing tool, so no shared cache should
    // hold a copy — and a CDN hit would be served without the cross-site check
    // above ever running.
    res.setHeader('cache-control', 'private, max-age=3600');
    return res.status(200).end(buf);
  } catch (err) {
    res.setHeader('cache-control', 'no-store');
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? 'Upstream timed out.'
        : err?.message || 'image proxy failed',
    });
  }
}
