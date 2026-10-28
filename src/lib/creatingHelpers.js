// Helpers for working with creative-work record values — both the legacy
// `is.dame.creating.work` shape and the `site.standard.document` shape that
// now backs the portfolio.

const BSKY_IMAGE_CDN = 'https://cdn.bsky.app/img';

// Which Bluesky CDN preset a thumbnail asks for. `card` fits inside 1000px
// (enough for a grid or feed card at 3x); `icon` is a 128px centre-cropped
// square, which is exactly what the résumé's 52px object-fit: cover tiles draw.
const THUMB_PRESETS = {
  card: 'feed_thumbnail',
  icon: 'avatar_thumbnail',
};

/**
 * A resized copy of a PDS blob from the Bluesky image CDN, or null when `url`
 * isn't a `com.atproto.sync.getBlob` URL (a legacy media URL, say).
 *
 * The annotated `_url` on a blob is the original upload — up to several MB for
 * a cover drawn a few hundred pixels wide — and the PDS serves it
 * `cache-control: private`, so nothing between here and there keeps a copy.
 * The CDN serves any blob in the repo, not only ones a post references.
 *
 * WebP rather than the `@jpeg` PostEmbed asks for: some covers are PNGs with
 * real transparency, which JPEG would flatten onto a solid ground. A GIF keeps
 * its original, because every CDN variant is a still frame.
 */
export function blobThumbUrl(url, { size = 'card', mimeType } = {}) {
  if (!url || mimeType === 'image/gif') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.pathname.endsWith('/xrpc/com.atproto.sync.getBlob')) return null;
  const did = parsed.searchParams.get('did') || '';
  const cid = parsed.searchParams.get('cid') || '';
  if (!/^did:[a-z]+:[\w.:%-]+$/.test(did) || !/^[a-z0-9]+$/i.test(cid))
    return null;
  const preset = THUMB_PRESETS[size] || THUMB_PRESETS.card;
  return `${BSKY_IMAGE_CDN}/${preset}/plain/${did}/${cid}@webp`;
}

// `{ url, alt, original }` for one image: the CDN thumbnail when there is one,
// with the full-size original kept for `swapToOriginal`.
function thumbFor(original, alt, opts) {
  const thumb = blobThumbUrl(original, opts);
  return { url: thumb || original, alt, original: thumb ? original : null };
}

/**
 * Best thumbnail for a creative work, in priority order:
 *   1. an explicit `coverImage` blob (standard.document) — the author's pick
 *   2. the first image block in the body
 *   3. a legacy `media[]` image URL
 * Returns `{ url, alt, original }` or null. `url` is a CDN-sized copy where the
 * image is a PDS blob, and `original` the full-size blob to fall back to (null
 * when `url` already is the original). `size` is 'card' or 'icon'.
 */
export function coverThumb(value, { size = 'card' } = {}) {
  const cover = value?.coverImage;
  if (cover?._url) {
    return thumbFor(cover._url, value.title || '', {
      size,
      mimeType: cover.mimeType,
    });
  }
  const fromContent = firstImageFromContent(value?.content);
  if (fromContent) {
    return thumbFor(fromContent.url, fromContent.alt, {
      size,
      mimeType: fromContent.mimeType,
    });
  }
  const legacy = Array.isArray(value?.media)
    ? value.media.find((m) => m?.kind === 'image' && m?.url)
    : null;
  if (legacy) return { url: legacy.url, alt: legacy.alt || '', original: null };
  return null;
}

/**
 * `onError` for a thumbnail <img>: if the CDN copy fails (the CDN is down, or
 * hasn't been able to reach the PDS), show the original blob instead. Once
 * only, so a broken original can't loop.
 */
export function swapToOriginal(event, original) {
  const img = event?.currentTarget;
  if (!img || !original || img.dataset.thumbFallback) return;
  img.dataset.thumbFallback = '1';
  img.src = original;
}

/**
 * Find the first image block in a pub.leaflet.content value and return
 * `{ url, alt, mimeType }` if one exists. Used to extract a thumbnail for
 * grid cards and feed previews. Falls through to legacy `block.url` if the
 * blob ref hasn't been annotated yet.
 */
export function firstImageFromContent(content) {
  const pages = Array.isArray(content?.pages) ? content.pages : [];
  for (const page of pages) {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const wrap of blocks) {
      const block = wrap?.block;
      if (block?.$type !== 'pub.leaflet.blocks.image') continue;
      const url = block?.image?._url || block?.url;
      if (url)
        return { url, alt: block?.alt || '', mimeType: block?.image?.mimeType };
    }
  }
  return null;
}
