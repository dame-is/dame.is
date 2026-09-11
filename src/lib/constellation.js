// Tiny client for the Constellation backlinks service
// (https://constellation.microcosm.blue). All calls swallow network / 4xx /
// 5xx errors and return `null` so the UI can render "Unavailable" without
// wrapping every call site in try/catch.

const CONSTELLATION_BASE = 'https://constellation.microcosm.blue';
const RETRY_DELAYS_MS = [1000, 2500, 5000, 10_000];

async function fetchJsonOrNull(url, init) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (init?.signal?.aborted) return null;
    try {
      const res = await fetch(url, {
        ...init,
        headers: { Accept: 'application/json', ...init?.headers },
      });
      if (res.ok) return await res.json();

      // The public Constellation instance is intentionally best-effort and
      // rate-limited. Slow down when it asks rather than translating a 429
      // into "backlinks unavailable" and throwing away an otherwise healthy
      // analytics sweep.
      const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
      if (!retryable || attempt === RETRY_DELAYS_MS.length) return null;
      await wait(retryDelayMs(res, attempt), init?.signal);
    } catch {
      if (init?.signal?.aborted || attempt === RETRY_DELAYS_MS.length) return null;
      await wait(RETRY_DELAYS_MS[attempt], init?.signal);
    }
  }
  return null;
}

function retryDelayMs(response, attempt) {
  const raw = response.headers?.get?.('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  return RETRY_DELAYS_MS[attempt];
}

function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      done();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * All sources (collection + record path) that point at `target`, with
 * per-source counts and distinct linking DIDs. `target` can be an AT URI
 * (record) OR a bare DID (identity backlinks like follows / blocks).
 *
 * Shape (from the deprecated-but-still-supported `/links/all`):
 *   { links: { "app.bsky.feed.like": { "subject.uri": { count, distinct_dids } } } }
 */
export async function getBacklinkSources(target) {
  if (!target) return null;
  const url = `${CONSTELLATION_BASE}/links/all?target=${encodeURIComponent(target)}`;
  return fetchJsonOrNull(url);
}

/**
 * Inbound link count for a single (target, source-collection, source-path)
 * tuple. `source` is in `<collection>:<path>` form, e.g.
 * `app.bsky.feed.like:subject.uri`.
 */
export async function getBacklinkCount(target, source) {
  if (!target || !source) return null;
  const params = new URLSearchParams({ subject: target, source });
  const url = `${CONSTELLATION_BASE}/xrpc/blue.microcosm.links.getBacklinksCount?${params}`;
  return fetchJsonOrNull(url);
}

/**
 * Paginated backlinks for a (target, source) tuple. Returns the raw
 * response or `null`.
 *
 * The rows come back under `records` on the XRPC route and under
 * `linking_records` on the older `/links` one — read them with
 * `backlinkRows()` rather than picking a field and hoping.
 */
export async function getBacklinks(target, source, { limit = 25, cursor, signal } = {}) {
  if (!target || !source) return null;
  const params = new URLSearchParams({
    subject: target,
    source,
    limit: String(limit),
  });
  if (cursor) params.set('cursor', cursor);
  const url = `${CONSTELLATION_BASE}/xrpc/blue.microcosm.links.getBacklinks?${params}`;
  return fetchJsonOrNull(url, signal ? { signal } : undefined);
}

/**
 * The `{ did, collection, rkey }` rows out of a `getBacklinks` response.
 *
 * `blue.microcosm.links.getBacklinks` names them `records`; the older `/links`
 * route names them `linking_records`. Reading only the latter is a silent
 * failure — the call returns 200, the array is undefined, and the caller
 * concludes the record has no backlinks at all.
 */
export function backlinkRows(page) {
  return page?.records || page?.linking_records || [];
}

/**
 * Flatten `getBacklinkSources` into a sorted array
 *   [{ collection, path, source, count, distinctDids }, ...]
 * sorted by count desc. Returns `null` if the underlying call failed.
 */
export function flattenSources(raw) {
  if (!raw) return null;
  const links = raw.links || raw; // tolerate both shapes
  const out = [];
  for (const [collection, paths] of Object.entries(links || {})) {
    if (!paths || typeof paths !== 'object') continue;
    for (const [path, info] of Object.entries(paths)) {
      const count = info?.records ?? info?.count ?? 0;
      const distinctDids = info?.distinct_dids ?? info?.distinctDids ?? null;
      // `/links/all` returns the path with a leading dot (e.g. ".subject"),
      // but `getBacklinks` rejects that — its `source` param uses the
      // unprefixed form (e.g. "app.bsky.graph.follow:subject"). Strip it.
      const sourcePath = path.startsWith('.') ? path.slice(1) : path;
      out.push({
        collection,
        path,
        source: `${collection}:${sourcePath}`,
        count,
        distinctDids,
      });
    }
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}
