/**
 * How many columns each cell of a ruled figures band spans, so that no row
 * trails off into empty ruled space: the last cell of a short row takes the
 * rest of it. A `wide` cell (a time span, say) takes a whole row of its own
 * when `honorWide` is set, which the band does only at its narrow width; if
 * one arrives mid-row, the cell before it stretches to close that row first.
 *
 * Pure, so the band's two layouts (its full column count and two-up on a
 * phone) can each be worked out up front and handed to CSS as custom
 * properties. Returns one span per item, each between 1 and `columns`.
 */
export function figureSpans(items, columns, { honorWide = false } = {}) {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const list = Array.isArray(items) ? items : [];
  const spans = new Array(list.length).fill(1);
  let pos = 0; // the column the next cell would start in
  for (let i = 0; i < list.length; i += 1) {
    const wide = honorWide && Boolean(list[i]?.wide);
    if (wide && pos > 0 && i > 0) {
      // Close the row the wide cell can't share.
      spans[i - 1] += cols - pos;
      pos = 0;
    }
    spans[i] = wide ? cols : 1;
    pos += spans[i];
    if (pos >= cols) pos = 0;
  }
  if (pos > 0 && list.length > 0) spans[list.length - 1] += cols - pos;
  return spans;
}
