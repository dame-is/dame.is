// Tiny isomorphic Are.na v3 client. No SDK — just fetch + JSON, so it runs
// in both `scripts/prefetch.mjs` (Node) and the browser.
//
// Public channels need no auth and the API sends `access-control-allow-origin:
// *`, so the browser's live refresh works unauthenticated (guest tier,
// 30 req/min — a gallery page view makes at most ~11 requests). At build time
// an optional read-only personal access token (ARENA_ACCESS_TOKEN) raises the
// rate ceiling to the account's tier (premium = 300/min). The env var is
// deliberately not VITE_-prefixed so Vite can never inline it into the
// client bundle.

import { ME_HANDLE } from '../config.js';

const ARENA_API = 'https://api.are.na/v3';

/** Are.na profile slug used for "view on are.na" links. */
export const ARENA_USER = ME_HANDLE.split('.')[0];

export function arenaChannelUrl(arenaSlug) {
  return `https://www.are.na/${ARENA_USER}/${encodeURIComponent(arenaSlug)}`;
}

/** Build-time only: undefined in the browser. */
export function arenaAccessToken() {
  return typeof process !== 'undefined' ? process.env?.ARENA_ACCESS_TOKEN : undefined;
}

async function arenaJson(path) {
  const token = arenaAccessToken();
  const res = await fetch(`${ARENA_API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
