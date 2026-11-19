// The bands, closest first, and the ways someone comes to be on the list.
// One copy, read by the bot's own panel server and by any page built on this
// client, so both name things the same way.

/** Every band, closest first. PROTECTED accounts are never added. */
export const BANDS = ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN'];

/** Bands that are not strangers, closest first: what the review queue holds. */
export const CLOSE = ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE'];

/**
 * How someone came to be on the list, as one of a few families, from the
 * `approved_via` on their decision (`via` in the API): by name (a typed
 * block, or an approval that named them), by band, by a tone label, or by
 * agent mode or a watch acting on what the owner asked. 'none' is someone the
 * log has no add for.
 */
export function viaFamily(via) {
  const v = String(via || '');
  if (!v) return 'none';
  if (/^(agent|watch):/.test(v)) return 'agent';
  if (v.includes('triage')) return 'label';
  if (v === 'band') return 'band';
  return 'name';
}
