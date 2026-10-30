// The quotable prose as the page draws it, for the two jobs src/lib/quote.js
// can't do from the record alone: reading what a reader selected, and finding
// a quoted passage on the page to highlight.
//
// It reads the same blocks quote.js reads off the record (paragraphs that
// aren't quotations or credits, headings, list items) and nothing the page
// adds around them: a section number, x-ray's manuscript of the typed text.
// The typesetting it leaves alone, because quote.js folds “ and " alike.

import { fold } from './quote.js';

const PROSE =
  '.leaflet-paragraph:not(.leaflet-inset):not(.leaflet-credit), .leaflet-heading, .leaflet-list li';
const SKIP = '[aria-hidden="true"], .leaflet-xray-raw';

/**
 * The prose under `root` as one string, block by block on lines of their own
 * as quotableText writes the record, with each text node's place in it:
 * `{ text, segments: [{ node, start }] }`.
 */
export function proseText(root) {
  const segments = [];
  let text = '';
  let lastBlock = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeType === Node.ELEMENT_NODE && n.matches(SKIP)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
    const block = el?.closest(PROSE);
    if (!block || !root.contains(block)) continue;
    if (n.nodeType === Node.ELEMENT_NODE) {
      // A line break inside a paragraph is a "\n" in the record.
      if (n.tagName === 'BR' && block === lastBlock) text += '\n';
      continue;
    }
    if (block !== lastBlock) {
      if (text) text += '\n';
      lastBlock = block;
    }
    segments.push({ node: n, start: text.length });
    text += n.data;
  }
  return { text, segments };
}

/**
 * The prose a selection covers, or '' when it covers none. Anything else it
 * strays over (a figure, an embed) is left out, which is what keeps that from
 * matching: the record has a wall there that the prose either side can't
 * reach across.
 */
export function selectedProse(root, range) {
  const { text, segments } = proseText(root);
  let from = -1;
  let to = -1;
  for (const s of segments) {
    if (!range.intersectsNode(s.node)) continue;
    if (from < 0) from = s.start + (s.node === range.startContainer ? range.startOffset : 0);
    to = s.start + (s.node === range.endContainer ? range.endOffset : s.node.data.length);
  }
  return from >= 0 && to > from ? text.slice(from, to) : '';
}

/** Where position `pos` of proseText's string falls, as a node and offset. */
function locate(segments, pos, isEnd) {
  for (const s of segments) {
    const len = s.node.data.length;
    if (pos >= s.start && (isEnd ? pos <= s.start + len : pos < s.start + len)) {
      return { node: s.node, offset: pos - s.start };
    }
  }
  return null;
}

/** A DOM Range over the first place `words` appear in the prose, or null. */
export function rangeForQuote(root, words) {
  const { text, segments } = proseText(root);
  const page = fold(text);
  const q = fold(words, { quote: true }).norm.trim();
  if (!q) return null;
  const at = page.norm.indexOf(q);
  if (at < 0) return null;
  const a = locate(segments, page.starts[at], false);
  const b = locate(segments, page.ends[at + q.length - 1], true);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}
