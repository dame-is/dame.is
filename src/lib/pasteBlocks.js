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
import { applyFeatureAlways, sliceRichText } from '../components/blocks/facetUtils.js';

const TEXT_TYPE = 'pub.leaflet.blocks.text';

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

/* ------------------------------------------------------------------ */
/* Markdown a text block was written in, resolved when the author       */
/* leaves it                                                            */
/* ------------------------------------------------------------------ */

/**
 * Turn a text block the author wrote markdown into the blocks it describes —
 * headings, lists, code, images, links — or `null` when there's nothing to do.
 *
 * The test for "nothing to do" is the conversion itself: run it, and if the
 * result is still the same lone paragraph with the same text and the same
 * facets, the block wasn't markdown. That's stricter than guessing from
 * markers, and it makes the operation idempotent — leaving an already-converted
 * block a second time is a no-op, which matters when this runs on every exit.
 *
 * Formatting the author applied with the toolbar rather than with markers has
 * no marker to survive on, so it's carried across separately (see carryFacets).
 */
export function textBlockToBlocks(block) {
  if (block?.$type !== TEXT_TYPE) return null;
  const text = typeof block.plaintext === 'string' ? block.plaintext : '';
  if (!text.trim()) return null;
  const converted = markdownToBlocks(text);
  // An all-whitespace parse yields nothing; keep the block the author has
  // rather than deleting what they were writing.
  if (converted.length === 0) return null;
  carryFacets(text, block.facets || [], converted);
  if (isSameParagraph(block, converted)) return null;
  return withLayout(block, converted);
}

/**
 * Re-apply the block's own facets to the converted output.
 *
 * Markdown conversion only knows the markers in the text, so a bold applied
 * from the toolbar would vanish. Each converted piece of rich text is located
 * back in the original by its own text — searching forward, so repeated words
 * can't match out of order — and any facet covering that span comes with it. A
 * piece whose markers were consumed (`**bold**` → `bold`) has no verbatim match
 * and keeps only what the markdown gave it.
 */
function carryFacets(text, facets, blocks) {
  if (!Array.isArray(facets) || facets.length === 0) return;
  let cursor = 0;
  for (const node of richTextNodes(blocks)) {
    if (!node.text) continue;
    const at = text.indexOf(node.text, cursor);
    if (at === -1) continue;
    cursor = at + node.text.length;
    let next = node.facets;
    for (const f of sliceRichText(text, facets, at, cursor).facets) {
      for (const feature of f.features || []) {
        next = applyFeatureAlways(next, f.index.byteStart, f.index.byteEnd, feature);
      }
    }
    node.set(next);
  }
}

/**
 * Every facet-bearing piece of rich text in a block list, in reading order.
 * Code blocks are skipped — their text is verbatim and carries no formatting.
 */
function* richTextNodes(blocks) {
  for (const block of blocks) {
    if (block?.$type === TEXT_TYPE || block?.$type === 'pub.leaflet.blocks.header') {
      yield {
        text: block.plaintext || '',
        facets: block.facets || [],
        set: (facets) => {
          block.facets = facets;
        },
      };
    } else if (Array.isArray(block?.children)) {
      yield* listItemNodes(block.children);
    }
  }
}

function* listItemNodes(items) {
  for (const item of items) {
    const content = item?.content;
    if (content) {
      yield {
        text: content.plaintext || '',
        facets: content.facets || [],
        set: (facets) => {
          content.facets = facets;
        },
      };
    }
    if (Array.isArray(item?.children)) yield* listItemNodes(item.children);
  }
}

/** Did the conversion leave the block exactly as it was? */
function isSameParagraph(block, converted) {
  if (converted.length !== 1) return false;
  const only = converted[0];
  if (only.$type !== TEXT_TYPE) return false;
  if (only.plaintext !== block.plaintext) return false;
  return facetKey(only.facets) === facetKey(block.facets);
}

// Compare facets by value, not by shape: the two sides are built by different
// code paths, so field and feature order can differ while the meaning matches.
function facetKey(facets) {
  return JSON.stringify(
    (Array.isArray(facets) ? facets : [])
      .map((f) => [
        f?.index?.byteStart ?? -1,
        f?.index?.byteEnd ?? -1,
        (f?.features || [])
          .map((x) => `${x?.$type || ''}|${x?.uri || ''}`)
          .sort(),
      ])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  );
}

/**
 * Carry the spacing the author set on the paragraph onto the blocks that
 * replace it: space above lands on the first, space below on the last, so the
 * gap they opened around the passage stays where they put it. Indent is a
 * paragraph's own property and only follows a paragraph.
 */
function withLayout(block, converted) {
  const out = converted.slice();
  const first = { ...out[0] };
  if (block.spaceTop != null) first.spaceTop = block.spaceTop;
  if (block.indent != null && first.$type === TEXT_TYPE) first.indent = block.indent;
  out[0] = first;
  if (block.spaceBottom != null) {
    out[out.length - 1] = { ...out[out.length - 1], spaceBottom: block.spaceBottom };
  }
  return out;
}
