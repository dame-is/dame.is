// Helpers for working with creative-work record values — both the legacy
// `is.dame.creating.work` shape and the `site.standard.document` shape that
// now backs the portfolio.

/**
 * Best thumbnail for a creative work, in priority order:
 *   1. an explicit `coverImage` blob (standard.document) — the author's pick
 *   2. the first image block in the body
 *   3. a legacy `media[]` image URL
 * Returns `{ url, alt }` or null.
 */
export function coverThumb(value) {
  if (value?.coverImage?._url) return { url: value.coverImage._url, alt: value.title || '' };
  const fromContent = firstImageFromContent(value?.content);
  if (fromContent) return fromContent;
  const legacy = Array.isArray(value?.media)
    ? value.media.find((m) => m?.kind === 'image' && m?.url)
    : null;
  if (legacy) return { url: legacy.url, alt: legacy.alt || '' };
  return null;
}

/**
 * Find the first image block in a pub.leaflet.content value and return
 * `{ url, alt }` if one exists. Used to extract a thumbnail for grid
 * cards and feed previews. Falls through to legacy `block.url` if the
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
      if (url) return { url, alt: block?.alt || '' };
    }
  }
  return null;
}
