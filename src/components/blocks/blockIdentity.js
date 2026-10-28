// Following one block through a document that keeps being rewritten.
//
// The blocks editor never mutates: every edit replaces the block it touched
// with a new object, and a document that arrives from outside the editor is a
// copy in which every block is new. Most writes do not care — they are built
// from the document on screen, synchronously. An upload does care. It finishes
// seconds after it started, and by then the block it started on may have been
// edited (its alt text typed while the bytes went up), moved, or deleted. So
// the editor keeps a successor chain — old block object → the object that
// replaced it — in a WeakMap, and an async write follows the chain from the
// block it started on to wherever that block is now. Kept out of the component
// so vitest can pin it in `node`.

/**
 * Where the block an async write started on sits now: follow `from` through
 * its successors (each edit replaces the block object) and return the index of
 * the newest version still in the document, or -1 when none is — the block was
 * deleted, or folded into others by a paste or a markdown resolve.
 *
 * The NEWEST version still present rather than the last link of the chain,
 * because an undo puts an older version back: the chain then runs on past the
 * block on screen, to edits the undo took away.
 *
 * @param {{block: object}[]} blocks  the document's block wrappers, as they are now
 * @param {object|null} from          the block object the write started on
 * @param {WeakMap<object, object>} successors
 * @returns {number}
 */
export function locateBlock(blocks, from, successors) {
  if (!from) return -1;
  const indexOf = new Map(blocks.map((wrap, k) => [wrap?.block, k]));
  let found = -1;
  const seen = new Set();
  for (let b = from; b && !seen.has(b); b = successors.get(b)) {
    seen.add(b);
    if (indexOf.has(b)) found = indexOf.get(b);
  }
  return found;
}

/**
 * Link every block of `next` to the block at the same place in `prev`, when the
 * two documents are the same shape: as many blocks, of the same types, in the
 * same order. That is what a copy of one document looks like, and a copy is
 * what arrives from outside the editor — the record editor's display-URL pass,
 * the record a save leaves behind, a trip through the JSON view. A document of
 * any other shape was rewritten rather than copied, and nothing is linked: an
 * upload whose block cannot be found is dropped rather than guessed onto
 * another.
 *
 * @param {object} prev  a `pub.leaflet.content` value
 * @param {object} next  the value that replaced it
 * @param {WeakMap<object, object>} successors  written to
 */
export function linkCopies(prev, next, successors) {
  const before = prev?.pages?.[0]?.blocks;
  const after = next?.pages?.[0]?.blocks;
  if (!Array.isArray(before) || !Array.isArray(after)) return;
  if (before.length !== after.length) return;
  for (let k = 0; k < before.length; k += 1) {
    if (before[k]?.block?.$type !== after[k]?.block?.$type) return;
  }
  for (let k = 0; k < before.length; k += 1) {
    const from = before[k]?.block;
    const to = after[k]?.block;
    if (from && to && from !== to && typeof from === 'object') {
      successors.set(from, to);
    }
  }
}
