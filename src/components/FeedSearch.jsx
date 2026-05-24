/**
 * Lowercase substring match. Returns true when `q` is empty.
 *
 * The visible search input now lives in the bottom chrome bar
 * (`ChromeBarBottom` in ChromeBar.jsx), so this file holds only the
 * shared filter helper that the per-verb pages still call against
 * `?q=`.
 */
export function matchesQuery(text, q) {
  const needle = (q || '').trim().toLowerCase();
  if (!needle) return true;
  return String(text || '').toLowerCase().includes(needle);
}
