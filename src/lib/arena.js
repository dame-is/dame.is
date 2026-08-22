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
 * snapshots) use. Handles Image and Link blocks (with a preview image) and
 * Text blocks (rendered as a text tile). Returns null for everything else —
 * Media, Attachment, nested Channels, and images/links without a preview.
 */
export function normalizeBlock(block) {
  if (!block) return null;

  // Text block → a text tile (are.na channels often mix single words / notes
  // in with the images). content is `{ markdown, html, plain }` on v3.
  if (block.type === 'Text') {
    const text = arenaText(block.content).trim();
    if (!text) return null;
    return {
      id: block.id,
      type: 'text',
      text,
      position: block.connection?.position ?? null,
      connectedAt: block.connection?.connected_at || null,
    };
  }

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
    // The page title behind a Link block ("Polysemy - Wikipedia").
    sourceTitle: block.source?.title || block.title || '',
    position: block.connection?.position ?? null,
    connectedAt: block.connection?.connected_at || null,
  };
}

/**
 * are.na v3 returns rich-text fields (e.g. a channel description) as a
 * `{ markdown, html, plain }` object — or a plain string on older/simple
 * shapes. Coerce either into a display string (preferring the plain text) so
 * it's never handed to React as an object child.
 */
export function arenaText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.plain || value.markdown || '';
  return String(value);
}

/**
 * Pick a gallery's cover thumbnail from its normalized blocks. Honours an
 * author-chosen `coverBlockId` (the are.na block id) when that block is present;
 * otherwise falls back to the first block — the historical default.
 */
export function pickCoverThumb(blocks, coverBlockId) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (coverBlockId != null && coverBlockId !== '') {
    const chosen = list.find((b) => String(b?.id) === String(coverBlockId));
    if (chosen?.thumb) return chosen.thumb;
  }
  // First block that actually has a thumbnail — text tiles have none.
  return list.find((b) => b?.thumb)?.thumb || null;
}

/**
 * How a gallery lays its blocks out, offered in the channel record's editor and
 * read by the gallery page. `curated` is are.na's own position order — the only
 * order the site had, and still the default, because it is the one the author
 * arranged by hand over there.
 *
 * `newest`/`oldest` sort by when a block was CONNECTED to this channel, which is
 * not the same question as position: reordering blocks on are.na moves their
 * position and leaves their connection date alone.
 */
export const BLOCK_ORDERS = [
  { value: 'curated', label: 'Curated — the order they sit in on are.na' },
  { value: 'newest', label: 'Newest first — most recently added to the channel' },
  { value: 'oldest', label: 'Oldest first — as they were added' },
  { value: 'random', label: 'Random — reshuffled on every visit' },
];

export const DEFAULT_BLOCK_ORDER = 'curated';

/** When a block joined this channel, in ms, or null if it doesn't say. */
const connectedMs = (b) => {
  const t = Date.parse(b?.connectedAt || '');
  return Number.isNaN(t) ? null : t;
};

/**
 * Fisher–Yates driven by a seeded PRNG (mulberry32), so one seed shuffles one
 * way. The seed matters: a gallery paints from the build snapshot and then
 * again from are.na, and an unseeded shuffle would deal the page twice.
 */
function shuffle(list, seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The unpinned remainder, in the order the channel asked for. */
function sortRest(rest, order, seed) {
  if (order === 'random') return shuffle(rest, seed);
  if (order !== 'newest' && order !== 'oldest') return rest; // curated, and anything unrecognised
  // A block with no connection date sorts after the dated ones rather than to
  // one end of them, where a missing date would read as "added first" (or last).
  // Sort is stable, so within each group the channel's own order survives.
  const dated = [];
  const undated = [];
  for (const b of rest) (connectedMs(b) === null ? undated : dated).push(b);
  const dir = order === 'newest' ? -1 : 1;
  dated.sort((x, y) => dir * (connectedMs(x) - connectedMs(y)));
  return [...dated, ...undated];
}

/**
 * A gallery's blocks in the order its record asks for them.
 *
 * Pinned blocks lead, in the order they were pinned — a pin is "this one first",
 * and it holds whichever way the rest is sorted, including random. A pin naming
 * a block that has since left the channel simply places nothing; the record is
 * not rewritten for it, so unpinning on are.na and re-adding still works.
 *
 * @param {Array} blocks           normalized blocks, in are.na position order
 * @param {object} [opts]
 * @param {string} [opts.order]    one of BLOCK_ORDERS
 * @param {Array}  [opts.pinned]   are.na block ids, in pin order
 * @param {number} [opts.seed]     shuffle seed; hold it steady across a visit
 * @returns {Array} a new array; the input is never mutated
 */
export function orderBlocks(blocks, { order = DEFAULT_BLOCK_ORDER, pinned = [], seed = 0 } = {}) {
  const list = (Array.isArray(blocks) ? blocks : []).filter(Boolean);
  if (list.length < 2) return [...list];
  const byId = new Map(list.map((b) => [String(b.id), b]));
  const head = [];
  const taken = new Set();
  for (const id of Array.isArray(pinned) ? pinned : []) {
    const key = String(id);
    const block = byId.get(key);
    if (block && !taken.has(key)) {
      head.push(block);
      taken.add(key);
    }
  }
  const rest = taken.size ? list.filter((b) => !taken.has(String(b.id))) : list;
  return [...head, ...sortRest(rest, order, seed)];
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
