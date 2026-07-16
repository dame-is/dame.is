// Profanity/slur detection (and masking) for user-authored guestbook text.
//
// The guestbook has no database we control — every signature is a record on
// the SIGNER's own PDS, assembled at read time (see src/lib/guestbook.js). We
// can't edit anyone's words; we can only choose how to render them. The read
// path uses `hasProfanity` to auto-hide a whole signature from public display
// when it trips the filter — the same posture as the book's host-curated
// `hidden` list, just computed per-render instead of written to the book.
// `censorProfanity` (blank the offending word, keep the rest) is kept for a
// finer touch — e.g. a heads-up in the sign form before publishing.
//
// Built on `obscenity`, whose English dataset is word-boundary aware (so
// "Scunthorpe", "classic", and "assassin" pass through clean) and
// obfuscation-resistant (so "sh!t" and light leetspeak don't slip past). The
// matcher is a little expensive to assemble, so it's built once, lazily, on
// first use.

import {
  RegExpMatcher,
  TextCensor,
  asteriskCensorStrategy,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity';

let filter = null; // { matcher, censor }, built on first use

function ensureFilter() {
  if (!filter) {
    const matcher = new RegExpMatcher({
      ...englishDataset.build(),
      ...englishRecommendedTransformers,
    });
    // Blank each matched region with asterisks of the same width — reads as a
    // deliberate redaction without leaking the word's shape.
    const censor = new TextCensor().setStrategy(asteriskCensorStrategy());
    filter = { matcher, censor };
  }
  return filter;
}

/**
 * Mask any profanity/slurs in `text`, returning a display-safe string. Clean
 * text — and any non-string — comes back untouched, so this is safe to wrap
 * around every rendered field. Only the offending word is blanked ("you're a
 * ****"), so a note that merely contains one bad word stays otherwise readable.
 */
export function censorProfanity(text) {
  if (typeof text !== 'string' || text === '') return text;
  const { matcher, censor } = ensureFilter();
  const matches = matcher.getAllMatches(text);
  if (matches.length === 0) return text;
  return censor.applyTo(text, matches);
}

/** True when `text` contains anything the filter would mask. */
export function hasProfanity(text) {
  if (typeof text !== 'string' || text === '') return false;
  return ensureFilter().matcher.hasMatch(text);
}
