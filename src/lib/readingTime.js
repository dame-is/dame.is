// How long a document takes to read, for the band under an essay's title.
//
// Counts the words a reader reads through: paragraphs, headings, quotations
// and list items. Code, embedded posts, link cards and pictures are left out;
// they're looked at more than read, and an embedded post's text isn't in the
// record anyway. Kept free of React so vitest can pin it in `node`.

// Silent reading of English non-fiction, from Brysbaert's 2019 review of 190
// studies ("How many words do we read per minute?", Journal of Memory and
// Language): 238 words a minute on average.
export const WORDS_PER_MINUTE = 238;

const READ_BLOCKS = new Set([
  'pub.leaflet.blocks.text',
  'pub.leaflet.blocks.header',
  'pub.leaflet.blocks.blockquote',
]);
const LIST_BLOCKS = new Set([
  'pub.leaflet.blocks.unorderedList',
  'pub.leaflet.blocks.orderedList',
]);

/** Words in a string: runs between spaces with a letter or digit in them. */
export function countWords(text) {
  if (typeof text !== 'string') return 0;
  let n = 0;
  for (const token of text.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) n += 1;
  }
  return n;
}

function listWords(items) {
  let n = 0;
  for (const item of Array.isArray(items) ? items : []) {
    n += countWords(item?.content?.plaintext);
    n += listWords(item?.children);
  }
  return n;
}

/** Words a reader reads in a pub.leaflet.content document. */
export function documentWords(content) {
  let n = 0;
  const pages = Array.isArray(content?.pages) ? content.pages : [];
  for (const page of pages) {
    for (const wrap of Array.isArray(page?.blocks) ? page.blocks : []) {
      const block = wrap?.block;
      if (READ_BLOCKS.has(block?.$type)) n += countWords(block.plaintext);
      else if (LIST_BLOCKS.has(block?.$type)) n += listWords(block.children);
    }
  }
  return n;
}

/** Whole minutes to read `words`, rounded, and never under one; 0 for none. */
export function readingMinutes(words) {
  if (!words) return 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
