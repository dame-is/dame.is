// Shapes for pub.leaflet.blocks.{unordered,ordered}List, and the conversions
// between a list and a paragraph.
//
// The list type lives in TWO places in the lexicon — the block's own `$type`
// and a matching `#listItem` on every child — so anything that changes one has
// to change the other. Keeping that in one module is why this file exists: an
// earlier version toggled only the block, leaving an ordered list full of
// children still typed as unordered items.

import { splitRichTextLines, joinRichTextLines } from './facetUtils.js';

export const BULLET_LIST = 'pub.leaflet.blocks.unorderedList';
export const NUMBER_LIST = 'pub.leaflet.blocks.orderedList';

/** The block `$type` for a list of the given kind. */
export function listType(ordered) {
  return ordered ? NUMBER_LIST : BULLET_LIST;
}

/** The `$type` every child of such a list must carry. */
export function listItemType(ordered) {
  return `${listType(ordered)}#listItem`;
}

/** Is this block one of the two list types? */
export function isListBlock(block) {
  return block?.$type === BULLET_LIST || block?.$type === NUMBER_LIST;
}

/** Is this list numbered? */
export function isOrdered(block) {
  return block?.$type === NUMBER_LIST;
}

/** One list item carrying the given rich text. */
export function listItem({ text = '', facets = [] } = {}, ordered = false, children = []) {
  return {
    $type: listItemType(ordered),
    content: { $type: 'pub.leaflet.blocks.text', plaintext: text, facets },
    children,
  };
}

/** An empty item, for a fresh list or a new row. */
export function emptyListItem(ordered = false) {
  return listItem({}, ordered);
}

/**
 * Retype a list and everything under it. Used when switching between bulleted
 * and numbered, where the children's `#listItem` types have to follow.
 */
export function retypeList(block, ordered) {
  const children = (Array.isArray(block?.children) ? block.children : []).map((item) =>
    retypeItem(item, ordered),
  );
  return { ...block, $type: listType(ordered), children };
}

function retypeItem(item, ordered) {
  const nested = Array.isArray(item?.children) ? item.children : [];
  return {
    ...item,
    $type: listItemType(ordered),
    children: nested.map((child) => retypeItem(child, ordered)),
  };
}

/** Build a list block from a set of rich-text values, one per item. */
export function listBlockFrom(parts, ordered = false) {
  const items = (parts || []).map((part) => listItem(part, ordered));
  return {
    $type: listType(ordered),
    children: items.length ? items : [emptyListItem(ordered)],
  };
}

/**
 * Flatten a list back into a paragraph, one line per item.
 *
 * Nested items are pulled up rather than dropped — a paragraph has no depth to
 * put them at, and losing the author's text would be the worse outcome.
 */
export function listToTextBlock(block) {
  const lines = [];
  const walk = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      const content = item?.content;
      lines.push({ text: content?.plaintext || '', facets: content?.facets || [] });
      walk(item?.children);
    }
  };
  walk(block?.children);
  const { text, facets } = joinRichTextLines(lines.filter((l) => l.text.trim()));
  return { $type: 'pub.leaflet.blocks.text', plaintext: text, facets };
}

/** Split a paragraph's rich text into per-line items. Re-exported for callers
 *  that only need the list side of the conversion. */
export { splitRichTextLines };
