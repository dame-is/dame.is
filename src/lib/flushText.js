// Reading a flush (`im.flushing.right.now`) as a sentence.
//
// A flush is stored as a sentence fragment that completes the author's
// handle: the composer writes "is flushing" so flushes.app can print
// "@dame.is is flushing". That stutter is why flushes.app drops the
// leading "is " for handles that already end in ".is" — and ours does, so
// every flush on this site takes that branch and reads "dame.is flushing".
//
// Which is the same shape the whole site is named around ("dame.is …ing")
// and the same shape a logging status takes (see StatusEntry), so a flush
// row needs no special pleading to sit in the feed next to one.

/** What the composer stores when the box was left empty. */
const DEFAULT_FLUSH_TEXT = 'is flushing';

/**
 * The body of a flush, as it should read after the handle.
 *
 *   ('is flushing',            'dame.is') -> 'flushing'
 *   ('is not doing so hot',    'dame.is') -> 'not doing so hot'
 *   ('is flushing',        'someone.bsky') -> 'is flushing'
 *   ('',                       'dame.is') -> 'flushing'
 *
 * The leading "is " is only dropped for a handle that ends in ".is",
 * matching flushes.app. Everything else is returned as written — a flush
 * that opens some other way ("just flushed") is already a whole clause.
 * Only a whole leading word goes: "island time" keeps its island.
 */
export function flushBody(text, handle) {
  const raw = typeof text === 'string' ? text.trim() : '';
  const stutters = typeof handle === 'string' && handle.toLowerCase().endsWith('.is');
  if (!raw) return stutters ? 'flushing' : DEFAULT_FLUSH_TEXT;
  // `raw` is trimmed, so a leading "is " always has a real word behind it —
  // there's no way to strip this down to an empty string.
  if (stutters && raw.toLowerCase().startsWith('is ')) return raw.slice(3).trim();
  return raw;
}

/**
 * True when a flush carries no words of its own — an empty box, or the
 * default the composer writes into one. The condensed ledger row asks
 * this before printing a body, because its verb column already reads
 * "flushing" and would otherwise say it twice in a row.
 */
export function isWordlessFlush(text) {
  const raw = typeof text === 'string' ? text.trim().toLowerCase() : '';
  return raw === '' || raw === DEFAULT_FLUSH_TEXT || raw === 'flushing';
}

/**
 * The flushes.app permalink for a flush, which is where its reactions,
 * replies and neighbours live. Needs the author's handle — the route is
 * `/flush/<handle>/<rkey>` — so a caller without one gets null rather than
 * a guaranteed 404.
 */
export function flushPermalink(atUri, handle) {
  if (!handle) return null;
  const m = String(atUri || '').match(/^at:\/\/[^/]+\/im\.flushing\.right\.now\/([^/?#]+)/);
  if (!m) return null;
  return `https://flushes.app/flush/${encodeURIComponent(handle)}/${encodeURIComponent(m[1])}`;
}
