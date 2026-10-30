/**
 * The pads that put a document's blocks back on its line rhythm
 * (LeafletDocument.css, "The line rhythm"): how much more space each block
 * needs above it so that it starts a whole number of lines below the first.
 *
 * `tops` are the blocks' tops as laid out now, from any one origin; `pads` the
 * pad each carries now; `line` one line of the text, in the same unit;
 * `anchored[i]` whether block i starts on the rhythm at all (a credit doesn't:
 * it hangs from the figure above, and the block after it is placed instead).
 * The first block is where the rhythm starts, and never takes a pad.
 *
 * One pass, because on the page a pad moves everything after it by exactly
 * its own size (the document is a flex column, whose margins never collapse):
 * each block's top is worked out with the pads already decided above it, less
 * the pad it carries itself. A block within half a pixel of a line counts as
 * on it, so subpixel layout can't set pads flickering.
 */
export function rhythmPads(tops, pads, line, anchored) {
  const out = tops.map(() => 0);
  if (!(line > 0) || tops.length === 0) return out;
  const origin = tops[0];
  let shift = 0;
  for (let i = 1; i < tops.length; i += 1) {
    const bare = tops[i] + shift - (pads[i] || 0);
    if (anchored[i]) {
      const off = (((bare - origin) % line) + line) % line;
      const need = off < 0.5 || line - off < 0.5 ? 0 : line - off;
      out[i] = Math.round(need * 100) / 100;
    }
    shift += out[i] - (pads[i] || 0);
  }
  return out;
}

/** Where the rule under each line falls, as a distance from the doc's top into
 *  one line: the first block's top plus the baseline's depth in a line box. */
export function rhythmPhase(origin, baseline, line) {
  if (!(line > 0)) return 0;
  return Math.round(((((origin + baseline) % line) + line) % line) * 100) / 100;
}
