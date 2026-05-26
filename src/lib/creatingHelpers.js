// Helpers for working with is.dame.creating.work record values.

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
