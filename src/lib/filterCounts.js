/**
 * What a line of the filter sheet prints for its count, and what a screen
 * reader hears instead. Counts are of what's loaded, so they come in four
 * kinds, and the sheet's footer says so:
 *   - a plain number: every record of that kind the page holds;
 *   - "100+": the first fetch stopped at its cap for that kind, so there are
 *     more (it used to print a bare "100", which read as a total);
 *   - "~85": an estimate from the last saved snapshot, for a kind that isn't
 *     fetched live until it's switched on;
 *   - "—": not loaded at all yet.
 */
export function formatFilterCount({ count, estimate = false, capped = false } = {}) {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return { text: '—', spoken: 'not loaded yet' };
  }
  const n = count.toLocaleString('en-US');
  if (estimate) return { text: `~${n}`, spoken: `about ${n}, from the last snapshot` };
  if (capped) return { text: `${n}+`, spoken: `${n} or more` };
  return { text: n, spoken: n };
}

/** The header's summary: "14 of 17 kinds", and " · the defaults" when it is. */
export function kindsSummary(active, total, { defaults = false, noun = 'kinds' } = {}) {
  const base = `${active} of ${total} ${noun}`;
  return defaults ? `${base} · the defaults` : base;
}
