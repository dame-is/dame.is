// Display-only typesetting for record text: curly quotes, apostrophes, an
// ellipsis and spaced dashes, applied as the page renders and never written
// back. The record keeps exactly what its author typed (x-ray shows that
// manuscript), and the page shows the typeset edition.
//
// Runs on plain text segments only. The leaflet renderer calls it after facet
// slicing, so byte offsets are already spent, and skips code and link
// segments, where a curled quote would change what the reader copies.
//
// Quote direction is decided by the character before the mark, which may sit
// in the previous segment; callers pass it as `prev` so a quotation that
// opens in plain text and closes inside an italic run still pairs up.

const OPENS_AFTER = /[\s([{—–\-/"'“‘]/;

function isOpening(prev) {
  return !prev || OPENS_AFTER.test(prev);
}

/**
 * Typeset one run of text. `prev` is the character that precedes it on the
 * page ('' at the start of a block).
 */
export function smartenText(text, prev = '') {
  if (typeof text !== 'string' || !text) return text;
  let s = text
    // Three dots, spaced or not, become one ellipsis.
    .replace(/\.\.\./g, '…')
    // A double hyphen is an em dash; a hyphen with a space either side is a
    // spaced en dash. A hyphen inside a word or number range is left alone.
    .replace(/--/g, '—')
    .replace(/(^|\s)-(\s)/g, '$1–$2');

  let out = '';
  let before = prev;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const next = s[i + 1] || '';
    if (ch === '"') {
      out += isOpening(before) ? '“' : '”';
    } else if (ch === "'") {
      if (/\w/.test(before) && /\w/.test(next)) {
        // Inside a word: it's, Dame's, rock'n'roll.
        out += '’';
      } else if (isOpening(before) && /\d/.test(next)) {
        // An elided century: '90s.
        out += '’';
      } else {
        out += isOpening(before) ? '‘' : '’';
      }
    } else {
      out += ch;
    }
    before = ch;
  }
  return out;
}

/** How many typewriter marks smartenText would change in `text`. */
export function countStraightMarks(text) {
  if (typeof text !== 'string') return 0;
  return (text.match(/["']|\.\.\.|--|(?:^|\s)-(?=\s)/g) || []).length;
}
