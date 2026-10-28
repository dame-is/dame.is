// Vercel serverless function: same-origin proxy for read-only are.na channel
// requests, so the browser's live gallery refresh can use the account's access
// token (raising the rate ceiling above the 30 req/min guest tier) without the
// secret ever reaching the client bundle. The token stays server-side here.
//
// Only the two request shapes src/lib/arena.js actually sends are forwarded —
// a channel's metadata and one page of its contents — and only to api.are.na.
// This is not a general-purpose proxy, and it is not a way to borrow the token:
// see `lendsToken` for who gets it.

const ARENA_API = 'https://api.are.na/v3';
const UPSTREAM_TIMEOUT_MS = 5000;

// `/channels/<slug>` and `/channels/<slug>/contents?page=N&per=N&sort=…`, and
// nothing else. Matched whole, with a character set that has no room for `%`,
// `.` or `\`: the old check (a `/channels/` prefix and no literal `..`) passed
// `/channels/%2e%2e/me`, which the URL parser normalises to `/v3/me`, so any
// authenticated are.na endpoint was one encoded dot-segment away.
const CHANNEL_PATH =
  /^\/channels\/([a-z0-9][a-z0-9_-]*)(?:\/contents(?:\?page=\d{1,4}&per=\d{1,3}&sort=[a-z_]{1,32})?)?$/i;

/** The channel slug a forwardable path names, or null for anything else. */
export function channelSlugFromPath(path) {
  if (typeof path !== 'string') return null;
  const m = path.match(CHANNEL_PATH);
  return m ? m[1].toLowerCase() : null;
}

/** Read the token under any of the accepted env-var names. Server-side only. */
function arenaToken() {
  return (
    process.env.ARENA_ACCESS_TOKEN ||
    process.env.ARENA_TOKEN ||
    process.env.ARENA_API_KEY ||
    ''
  );
}

// The slugs of the galleries the site publishes, from this deployment's own
// curating snapshot. The snapshot is fixed for the life of a deployment, and so
// is this instance, so one good read is kept for good; a failed one is retried
// a minute later rather than on every request. Requests that arrive while the
// read is under way wait for it rather than being taken for a failure.
let publishedSlugs = null;
let pendingRead = null;
let failedAt = 0;
const RETRY_AFTER_MS = 60_000;

async function readPublishedSlugs(host) {
  try {
    const res = await fetch(`https://${host}/data/curating.json`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const snap = await res.json();
    const slugs = (Array.isArray(snap?.galleries) ? snap.galleries : [])
      .map((g) => String(g?.arenaSlug || '').toLowerCase())
      .filter(Boolean);
    return new Set(slugs);
  } catch {
    return null;
  }
}

async function galleriesPublishedBy(host) {
  if (publishedSlugs) return publishedSlugs;
  if (!pendingRead) {
    if (Date.now() - failedAt < RETRY_AFTER_MS) return new Set();
    pendingRead = readPublishedSlugs(host).then((slugs) => {
      if (slugs) publishedSlugs = slugs;
      else failedAt = Date.now();
      pendingRead = null;
      return slugs;
    });
  }
  return (await pendingRead) || new Set();
}

/**
 * Whether this request gets the account token.
 *
 * Only for a channel the site already publishes. Those galleries are on the
 * page, in the snapshot and in the sitemap, so the token reads nothing through
 * them that isn't public already — it only buys the rate ceiling it exists for.
 * Any other slug goes to are.na as a guest, which is what keeps a private
 * channel private: with the token, knowing its slug was enough to read it. A
 * gallery enabled since the last build is fetched as a guest until the next
 * one, which costs it nothing but the guest rate limit.
 */
async function lendsToken(slug, host) {
  if (!slug || !host) return false;
  return (await galleriesPublishedBy(host)).has(slug);
}

export default async function handler(req, res) {
  const path = req.query?.path;
  const slug = channelSlugFromPath(path);
  if (!slug) {
    return res.status(400).json({
      error:
        'Pass an are.na `path` of the form /channels/<slug> or /channels/<slug>/contents.',
    });
  }

  // Same-origin guard: if the request advertises an Origin or Referer, its host
  // must match this deployment's host. A cross-site page (or a hand-crafted
  // request naming another site) is refused outright. Both headers absent →
  // allow: the edge middleware (og/records.js) calls this server-to-server and
  // sends neither, and the token policy above, not this check, is what decides
  // what such a caller can read.
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
    if (token && (await lendsToken(slug, host)))
      headers.Authorization = `Bearer ${token}`;
    const upstream = await fetch(`${ARENA_API}${path}`, {
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
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
