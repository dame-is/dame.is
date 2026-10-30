// Image blocks whose alt text was standing in for a caption.
//
// An image block with no `caption` used to print its `alt` under the picture,
// and the older documents were written to that: in some, the alt is a
// painting's title and size or a figure's source. The page now prints
// `caption` alone, so those read as bare pictures until the text is copied
// across (the admin's "Alt text to captions" tool, AltCaptionMigration.jsx).
// Kept free of React so vitest can pin them in `node`.

const IMAGE_BLOCK = 'pub.leaflet.blocks.image';

function textOf(s) {
  return typeof s === 'string' ? s.trim() : '';
}

/**
 * Every image block in a document that has alt text and no caption, as
 * `{ page, index, alt }`: where it sits in `content.pages[page].blocks` and the
 * text the page used to print under it. Walks the pages and blocks the way
 * LeafletDocument does, so it finds exactly the pictures the page shows.
 */
export function uncaptionedImages(value) {
  const out = [];
  const pages = Array.isArray(value?.content?.pages) ? value.content.pages : [];
  pages.forEach((page, p) => {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    blocks.forEach((wrap, i) => {
      const block = wrap?.block;
      if (block?.$type !== IMAGE_BLOCK) return;
      const alt = textOf(block.alt);
      if (!alt || textOf(block.caption)) return;
      out.push({ page: p, index: i, alt });
    });
  });
  return out;
}

/**
 * `value` with each of those blocks given its alt text as its caption, and how
 * many it changed. The alt stays as it is: it is still the screen-reader text,
 * and the pair is what the page showed before. Returns a copy, through JSON so
 * any BlobRef in the record collapses to the wire form `putRecord` takes;
 * `value` itself is untouched.
 */
export function withAltCaptions(value) {
  const next = JSON.parse(JSON.stringify(value ?? {}));
  const found = uncaptionedImages(next);
  for (const { page, index, alt } of found) {
    next.content.pages[page].blocks[index].block.caption = alt;
  }
  return { value: next, count: found.length };
}
