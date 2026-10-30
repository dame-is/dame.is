// Quoting a document: a passage somebody selected on a blog post or a work,
// carried in the link they share as `?quote=…`, and read back off the record
// wherever that link lands.
//
// Three places read the same link, and this module is what keeps them in
// agreement:
//
//   • the page (src/components/QuoteShare.jsx), which offers the link for a
//     selection and highlights the passage when one arrives with it
//   • the edge (middleware.js), which writes the quote into the <head> so the
//     link unfurls as that passage rather than as the essay's title card
//   • the card renderer (api/og.js), which draws it
//
// The quote rides on the URL, so anybody can type one. That is why nothing
// here trusts it: a quote is only ever a way of FINDING a passage in the
// record, and every caller draws the record's own words at that place, never
// the query's. A quote the document doesn't contain finds nothing, and the
// link falls back to the ordinary card, so a dame.is card can't be made to
// say something its author didn't write.
//
// Pure and dependency-free past smartPunctuation, so it runs in the browser,
// at the edge and in Node alike.

import { smartenText } from './smartPunctuation.js';

export const QUOTE_PARAM = 'quote';

// A quote is a passage, not a word: double-clicking a word to look it up
// shouldn't offer to share it.
export const QUOTE_MIN_WORDS = 2;

// Past this the card stops being a quotation and becomes a page of text set
// small. 360 characters is three or four sentences, and fills the card's
// column at body size without cutting any of it (og/design.js quoteCard).
export const QUOTE_MAX_CHARS = 360;

const TEXT = 'pub.leaflet.blocks.text';
const HEADER = 'pub.leaflet.blocks.header';
const LISTS = new Set(['pub.leaflet.blocks.unorderedList', 'pub.leaflet.blocks.orderedList']);

// Text layouts that set somebody else's words, or a figure's credit, rather
// than the author's prose (LeafletDocument.jsx TEXT_LAYOUTS). A card would
// present them as Dame's, so they can't be quoted, the way an embedded post,
// a code listing and a blockquote can't.
const NOT_OWN_LAYOUTS = new Set(['inset', 'credit']);

// What stands where a block that can't be quoted sits. No quote can contain
// it (fold drops control characters from a quote), so no match can reach
// across an embed, a figure or a quotation to join the prose either side.
const WALL = '\u0000';

/** The text of one list, item by item, nested items included. */
function listText(block, out) {
  for (const item of Array.isArray(block?.children) ? block.children : []) {
    const text = item?.content?.plaintext;
    if (typeof text === 'string' && text.trim()) out.push(text);
    if (Array.isArray(item?.children) && item.children.length) listText(item, out);
  }
}

/**
 * The prose of a `pub.leaflet.content` document as one string: its own words,
 * block by block, one line each, and a wall where anything else stands.
 * Blocks with no text (spacers, empty headings) leave nothing behind, so
 * prose either side of them still reads as continuous.
 */
export function quotableText(content) {
  const parts = [];
  for (const page of Array.isArray(content?.pages) ? content.pages : []) {
    for (const wrap of Array.isArray(page?.blocks) ? page.blocks : []) {
      const block = wrap?.block;
      const type = block?.$type;
      if ((type === TEXT && !NOT_OWN_LAYOUTS.has(block.layout)) || type === HEADER) {
        const text = typeof block.plaintext === 'string' ? block.plaintext : '';
        if (text.trim()) parts.push(text);
      } else if (LISTS.has(type)) {
        listText(block, parts);
      } else if (type) {
        if (parts[parts.length - 1] !== WALL) parts.push(WALL);
      }
    }
    if (parts.length && parts[parts.length - 1] !== WALL) parts.push(WALL);
  }
  return parts.join('\n');
}

// Characters that differ between the record and the page without the words
// differing. The record keeps what was typed and the page typesets it
// (smartPunctuation.js), so a passage copied off the page has curly quotes, an
// ellipsis and dashes where the record has straight marks, three dots and
// hyphens. Each is folded to the typed form, which is what the typesetting
// was made from. An em dash folds to two hyphens because that is what makes
// one, so the record's "--" and the page's "—" both read as "--".
const FOLD = new Map([
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['‛', "'"], ['′', "'"], ['ʼ', "'"],
  ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'], ['″', '"'],
  ['—', '--'], ['–', '-'], ['‒', '-'], ['―', '-'], ['−', '-'],
  ['…', '...'],
]);

// Marks that take up no room on the page: zero-width spaces and joiners, a
// soft hyphen, a byte-order mark, and the object-replacement box an Apple
// keyboard can leave behind.
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff\ufffc]/;

/** A C0 control character or DEL, which no passage on the page contains. */
const isControl = (ch) => {
  const c = ch.charCodeAt(0);
  return c < 0x20 || c === 0x7f;
};

/**
 * Text folded for comparison: case, whitespace runs, typeset punctuation and
 * invisible marks all reduced, so the same words match however they were set.
 * `starts[i]` and `ends[i]` give the span of the source character that folded
 * character `i` came from, so a match in the folded text can be cut back out
 * of the source exactly. Both count UTF-16 code units, as indexOf and slice
 * do, so a passage after an emoji doesn't come back one character askew.
 *
 * `quote` folds a quote rather than a document: control characters are
 * dropped rather than kept, which is what keeps a quote from matching a wall.
 */
export function fold(text, { quote = false } = {}) {
  const src = String(text ?? '');
  let norm = '';
  const starts = [];
  const ends = [];
  let i = 0;
  for (const ch of src) {
    const end = i + ch.length;
    let out;
    if (ch === WALL) out = quote ? '' : WALL;
    else if (/\s/.test(ch)) out = norm.endsWith(' ') ? '' : ' ';
    else if (INVISIBLE.test(ch) || isControl(ch)) out = '';
    else out = FOLD.get(ch) ?? ch.toLowerCase();
    norm += out;
    for (let k = 0; k < out.length; k += 1) {
      starts.push(i);
      ends.push(end);
    }
    i = end;
  }
  return { norm, starts, ends };
}

/** A letter, a digit or a combining mark at `i`, or an apostrophe inside a word. */
function isWordAt(text, i) {
  const ch = text[i];
  if (!ch) return false;
  if (/[\p{L}\p{N}\p{M}]/u.test(ch)) return true;
  if (ch === "'" || ch === '’') return /\p{L}/u.test(text[i - 1] || '') && /\p{L}/u.test(text[i + 1] || '');
  return false;
}

// What a quote doesn't start or end on: a selection dragged a character too
// far picks up the comma or the dash beside the words it was after.
const LEAD_TRIM = /[\s,;:.!?)\]}\-–—]/;
const TAIL_TRIM = /[\s,;:([{\-–—]/;

const countWords = (s) => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;

// One fold per document. The page asks again on every selection change, and
// the same record object comes back each time.
const cache = new WeakMap();
function documentFold(content) {
  if (content && typeof content === 'object' && cache.has(content)) return cache.get(content);
  const text = quotableText(content);
  const folded = { text, ...fold(text) };
  if (content && typeof content === 'object') cache.set(content, folded);
  return folded;
}

/**
 * Find `quote` in a document's prose. Null when it isn't there; otherwise
 *
 *   { words, display, tooLong }
 *
 * `words` is the passage as the record has it, rounded out to whole words,
 * trimmed of stray punctuation, its line breaks set as spaces: the form a
 * link carries. `display` is the same passage typeset the way the page sets
 * it. `tooLong` marks a real passage past QUOTE_MAX_CHARS, so the page can
 * say why it won't share one rather than going quiet.
 *
 * The first occurrence wins when a phrase appears twice; either would draw
 * the same card.
 */
export function matchQuote(content, quote) {
  const q = fold(quote, { quote: true }).norm.trim();
  if (!q || countWords(q) < QUOTE_MIN_WORDS) return null;
  const doc = documentFold(content);
  const at = doc.norm.indexOf(q);
  if (at < 0) return null;
  const { text } = doc;
  let start = doc.starts[at];
  let end = doc.ends[at + q.length - 1];
  // A selection that began or ended inside a word takes the whole word.
  while (start > 0 && isWordAt(text, start) && isWordAt(text, start - 1)) start -= 1;
  while (end < text.length && isWordAt(text, end - 1) && isWordAt(text, end)) end += 1;
  while (start < end && LEAD_TRIM.test(text[start])) start += 1;
  while (end > start && TAIL_TRIM.test(text[end - 1])) end -= 1;
  const words = text.slice(start, end).replace(/\s+/g, ' ');
  if (countWords(words) < QUOTE_MIN_WORDS) return null;
  // The character before the passage decides which way a quote mark at its
  // start curls, as it does on the page.
  const before = start > 0 && text[start - 1] !== WALL ? text[start - 1] : '';
  return {
    words,
    display: smartenText(words, /\s/.test(before) ? ' ' : before),
    tooLong: words.length > QUOTE_MAX_CHARS,
  };
}

/** The passage a quote finds, ready to share or draw, or null. */
export function quoteFrom(content, quote) {
  const found = matchQuote(content, quote);
  return found && !found.tooLong ? found : null;
}

/**
 * A quote as a query value, legibly: spaces as `+`, and the punctuation a
 * query allows (RFC 3986 §3.4) left as itself. The last character is escaped
 * if it is punctuation, because a URL that ends on a full stop or a bracket
 * loses it to the linkifier of nearly every app it's pasted into, and the
 * card would then quote a sentence without its end.
 */
export function encodeQuote(words) {
  const s = encodeURIComponent(String(words ?? ''))
    .replace(/%20/g, '+')
    .replace(/%2C/gi, ',')
    .replace(/%3A/gi, ':')
    .replace(/%3B/gi, ';')
    .replace(/%2F/gi, '/')
    .replace(/%3F/gi, '?')
    .replace(/%40/gi, '@');
  return s.replace(/[.!?)(*,:;'/@~-]$/, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

/** `path` with `words` as its quote: the link a selection shares. */
export function quoteHref(path, words) {
  return `${path}?${QUOTE_PARAM}=${encodeQuote(words)}`;
}
