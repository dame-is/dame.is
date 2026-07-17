// Vercel serverless function: same-origin proxy for read-only are.na channel
// requests, so the browser's live gallery refresh can use the account's access
// token (raising the rate ceiling above the 30 req/min guest tier) without the
// secret ever reaching the client bundle. The token stays server-side here.
//
// Only `/channels/…` paths are forwarded, and only to api.are.na — this is not
// a general-purpose proxy.

const ARENA_API = 'https://api.are.na/v3';

/** Read the token under any of the accepted env-var names. Server-side only. */
function arenaToken() {
  return (
    process.env.ARENA_ACCESS_TOKEN ||
    process.env.ARENA_TOKEN ||
    process.env.ARENA_API_KEY ||
    ''
  );
}

export default async function handler(req, res) {
  const path = req.query?.path;
  if (typeof path !== 'string' || !path.startsWith('/channels/') || path.includes('..')) {
    return res.status(400).json({ error: 'Pass an are.na `path` beginning with /channels/.' });
  }

  // Same-origin guard, checked BEFORE the owner's token is attached: if the
  // request advertises an Origin or Referer, its host must match this
  // deployment's host. A cross-site page (or a hand-crafted request naming
  // another site) must not be able to borrow the account token and read the
  // owner's private are.na channels. Both headers absent → allow (the token is
  // only useful to first-party callers anyway, and cron / server-to-server
  // callers send neither).
  const host = req.headers?.host || '';
  const originHeader = req.headers?.origin;
  const refererHeader = req.headers?.referer || req.headers?.referrer;
  if (originHeader || refererHeader) {
    let sourceHost = null;
    try {
      sourceHost = new URL(originHeader || refererHeader).host;
    } catch {
      sourceHost = null; // present but unparseable (e.g. "Origin: null")
    }
    if (!host || !sourceHost || sourceHost !== host) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    }
  }

  try {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'dame.is (+https://dame.is)',
    };
    const token = arenaToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const upstream = await fetch(`${ARENA_API}${path}`, { headers });
    const body = await upstream.text();
    res.setHeader('content-type', 'application/json; charset=utf-8');
    // Cache successes at the edge (titles/counts change rarely); never pin an
    // error or a rate-limit response.
    res.setHeader(
      'cache-control',
      upstream.ok ? 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600' : 'no-store',
    );
    return res.status(upstream.status).end(body);
  } catch (err) {
    res.setHeader('cache-control', 'no-store');
    return res.status(502).json({ error: err?.message || 'are.na proxy failed' });
  }
}
