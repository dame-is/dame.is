// Vercel serverless function: stream a remote image through our own origin so
// the block editor can pull a link's preview image (og:image) and re-upload it
// to the author's PDS as a blob. A straight browser fetch of the remote image
// is blocked by CORS on most hosts; proxying through dame.is sidesteps that and
// hands the client clean bytes + content-type it can wrap in a File.
//
// Read-only, owner-facing (used only inside the admin editor), but still guard
// the obvious feet: http(s) only, image content-types only, and a size cap.

import { assertPublicHttpUrl } from './_lib/ssrfGuard.js';

const MAX_BYTES = 8 * 1024 * 1024; // og images are small; refuse anything huge.
const MAX_REDIRECTS = 3; // re-validate every hop against the SSRF guard.

export default async function handler(req, res) {
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
    // Follow redirects by hand so every hop is re-checked by the SSRF guard —
    // `redirect:'follow'` would silently chase a Location into a private host.
    let upstream;
    let hops = 0;
    for (;;) {
      upstream = await fetch(current.href, {
        headers: { 'user-agent': 'Mozilla/5.0 (dame.is link unfurl)' },
        redirect: 'manual',
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
    const type = upstream.headers.get('content-type') || '';
    if (!/^image\//i.test(type)) {
      return res.status(415).json({ error: `Not an image (${type || 'unknown type'}).` });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: 'Image too large.' });
    }
    res.setHeader('content-type', type);
    res.setHeader('content-length', String(buf.length));
    res.setHeader('cache-control', 'public, max-age=3600, s-maxage=86400');
    return res.status(200).end(buf);
  } catch (err) {
    res.setHeader('cache-control', 'no-store');
    return res.status(502).json({ error: err?.message || 'image proxy failed' });
  }
}
