// Paste-to-blocks: turn a pasted markdown / multi-paragraph string into the
// editor's block shapes so the blocks editor can explode a paste into real
// text / heading / list / code / image blocks instead of dropping everything
// into one text block.
//
// The markdown → block conversion is the exact one the legacy-blog migration
// uses (`markdownToContent` in legacyBlogMarkdown.js), so paste and migration
// stay in lockstep and share its handling of headings, lists, code fences,
// blockquotes, links, and inline formatting (bold / italic / strike / code)
// as byte-offset facets. The only paste-specific tweak is images: the
// migration resolves an image's `_src` to an uploaded PDS blob in a later
// step, but a live paste has no such step — so an absolute image URL is kept
// as a renderable `url` and an unresolvable local path collapses to an empty
// image block (alt / caption preserved) for the author to fill in.

import { markdownToContent } from './legacyBlogMarkdown.js';

// Block-level markdown markers that, on their own, are strong enough evidence
// of "this is markdown" to convert even a single pasted line.
const STRONG_MARKERS = [
  /^\s{0,3}#{1,6}\s+\S/, // ATX heading:  "# Title"
  /^\s{0,3}!\[[^\]]*\]\([^)]*\)/, // standalone image:  "![alt](url)"
  /^\s{0,3}(```|~~~)/, // fenced code start
];

// Markers that only imply structure when the paste spans several lines, so a
// lone "- note" or "> hmm" or "1) call" still pastes as plain text.
const MULTILINE_MARKERS = [
  /^\s{0,3}[-*+]\s+\S/, // unordered list item
  /^\s{0,3}\d+[.)]\s+\S/, // ordered list item
  /^\s{0,3}>\s?/, // blockquote
  /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/, // thematic break: ---, ***, ___
];

/**
 * Should a pasted string be exploded into blocks rather than inserted as plain
 * text? True when it spans multiple paragraphs (a blank-line break) or carries
 * a block-level markdown marker. A single prose line — the everyday "paste a
 * word or a sentence" case — returns false and pastes normally.
 */
export function looksLikeMultiBlock(input) {
  const text = normalizeNewlines(input).trim();
  if (!text) return false;
  // Two or more paragraphs separated by a blank line.
  if (/\n[ \t]*\n/.test(text)) return true;
  const lines = text.split('\n');
  if (lines.some((line) => STRONG_MARKERS.some((re) => re.test(line)))) return true;
  if (lines.length > 1 && lines.some((line) => MULTILINE_MARKERS.some((re) => re.test(line)))) {
    return true;
  }
  return false;
}

/**
 * Convert a pasted markdown string into a flat list of editor blocks
 * (unwrapped — plain `pub.leaflet.blocks.*` values, not the linearDocument
 * wrapper). Returns `[]` for empty input.
 */
export function markdownToBlocks(input) {
  const text = normalizeNewlines(input);
  if (!text.trim()) return [];
  const content = markdownToContent(text);
  return (content?.pages?.[0]?.blocks || [])
    .map((wrap) => wrap?.block)
    .filter(Boolean)
    .map(resolvePastedImage);
}

/**
 * The migration leaves image blocks carrying a temporary `_src`; a live paste
 * has no upload step, so map an absolute URL onto the renderable `url` field
 * and drop `_src` (an unresolvable local path just leaves an empty image block
 * the author can upload into).
 */
function resolvePastedImage(block) {
  if (block?.$type !== 'pub.leaflet.blocks.image') return block;
  const { _src, ...rest } = block;
  if (_src && /^https?:\/\//i.test(_src)) return { ...rest, url: _src };
  return rest;
}

function normalizeNewlines(input) {
  return typeof input === 'string' ? input.replace(/\r\n?/g, '\n') : '';
}
