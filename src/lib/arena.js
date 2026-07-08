// Tiny isomorphic Are.na v3 client. No SDK — just fetch + JSON, so it runs
// in both `scripts/prefetch.mjs` (Node) and the browser.
//
// A read-only personal access token (ARENA_ACCESS_TOKEN) raises the rate
// ceiling from the 30 req/min guest tier to the account's tier. It is applied
// two ways so both the build and the live site are authenticated, while the
// secret never reaches the client bundle:
//   - Node (build-time prefetch): sent straight to api.are.na as a Bearer.
//   - Browser (live refresh): requests go through our same-origin `/api/arena`
//     serverless proxy, which injects the token server-side.
// The env var is deliberately not VITE_-prefixed so Vite can never inline it.

const ARENA_API = 'https://api.are.na/v3';

// Browser calls hit the serverless proxy instead of api.are.na directly.
const ARENA_PROXY = '/api/arena';

// Courtesy identification for build-time requests so are.na can see who
// is calling. Node only — browsers forbid setting User-Agent, but their
// requests already carry an Origin/Referer of dame.is.
const ARENA_USER_AGENT = 'dame.is prefetch (+https://dame.is)';

const IS_NODE = typeof process !== 'undefined' && Boolean(process.versions?.node);

/**
 * Build-time only: undefined in the browser. Accepts a few common env-var
 * names so a token set under any of them is picked up.
 */
export function arenaAccessToken() {
  if (typeof process === 'undefined') return undefined;
  const env = process.env || {};
  return env.ARENA_ACCESS_TOKEN || env.ARENA_TOKEN || env.ARENA_API_KEY || undefined;
}

async function arenaJson(path) {
  const headers = {};
  let url;
  if (IS_NODE) {
    // Build time: talk to are.na directly, authenticating with the token.
    const token = arenaAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    headers['User-Agent'] = ARENA_USER_AGENT;
    url = `${ARENA_API}${path}`;
  } else {
    // Browser: go through the same-origin proxy, which adds the token.
    url = `${ARENA_PROXY}?path=${encodeURIComponent(path)}`;
  }
  const res = await fetch(url, {
    headers: Object.keys(headers).length ? headers : undefined,
  });
  if (!res.ok) {
    const err = new Error(`are.na HTTP ${res.status} for ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** `GET /v3/channels/{slug}` — channel metadata (title, description, counts). */
export function fetchChannelMeta(arenaSlug) {
  return arenaJson(`/channels/${encodeURIComponent(arenaSlug)}`);
}

/** One contents page, in the channel's curated (position) order. */
export function fetchChannelPage(arenaSlug, page = 1, per = 100) {
  return arenaJson(
    `/channels/${encodeURIComponent(arenaSlug)}/contents?page=${page}&per=${per}&sort=position_asc`,
  );
}

/**
 * Normalize an are.na block to the compact shape the gallery pages (and
 * snapshots) use. Returns null for block types the gallery can't render —
 * Text, Media, Attachment, nested Channels, and Links without a preview
 * image.
 */
export function normalizeBlock(block) {
  const img = block?.image;
  if (!img?.src) return null;
  if (block.type !== 'Image' && block.type !== 'Link') return null;
  return {
    id: block.id,
    type: block.type.toLowerCase(), // 'image' | 'link'
    title: block.title || '',
    alt: img.alt_text || block.title || '',
    thumb: {
      src: img.small?.src || img.src,
      src2x: img.small?.src_2x || null,
      width: img.small?.width || img.width || null,
      height: img.small?.height || img.height || null,
    },
    large: img.large?.src || img.src,
    width: img.width || null,
    height: img.height || null,
    aspectRatio: img.aspect_ratio || null,
    sourceUrl: block.source?.url || null,
    position: block.connection?.position ?? null,
    connectedAt: block.connection?.connected_at || null,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a channel's contents (position order), normalized. `maxPages` caps
 * depth (default 10 pages × 100 = 1000 blocks); `truncated` tells callers to
 * point at are.na for the rest. `delayMs` spaces requests to respect the
 * rate tier — only needed at build time when many channels queue up.
 */
export async function fetchAllBlocks(arenaSlug, { per = 100, maxPages = 10, delayMs = 0 } = {}) {
  const blocks = [];
  let page = 1;
  let truncated = false;
  for (;;) {
    const res = await fetchChannelPage(arenaSlug, page, per);
    for (const b of res?.data || []) {
      const n = normalizeBlock(b);
      if (n) blocks.push(n);
    }
    if (!res?.meta?.has_more_pages) break;
    if (page >= maxPages) {
      truncated = true;
      break;
    }
    page += 1;
    if (delayMs) await sleep(delayMs);
  }
  return { blocks, truncated };
}
