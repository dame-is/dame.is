// Running a Ratioed piece, end to end.
//
// The project has a fixed shape and dame has been executing it by hand for a
// year: write the post from the standing template with the next take number,
// quote the piece before it, watch, and the instant somebody likes it close
// replies and reply naming them. This module is the parts of that which are
// arithmetic — the take number, the text, the announcement — kept out of the
// component so they can be read and tested on their own.
//
// What is deliberately NOT here is any decision to seal. The reaction time is
// the project's central measurement and it measures a person noticing; a
// function that sealed on its own would replace that with a polling interval
// and quietly end the thing being measured.

import { RATIOED_PATH } from '../config.js';
import { fmtDuration } from './ratioed.js';

/** The standing text, as take #13 last worded it. */
export function pieceTemplate(take, { origin = 'dame.is' } = {}) {
  return [
    'i would like your help with a social art project',
    '',
    'this post is the project',
    '',
    'the goal of this post is for it to receive ZERO likes… only replies, reposts, or quotes allowed',
    '',
    'once it is liked, replies are immediately disabled, thereby sealing & finishing it',
    '',
    `this is take #${take}`,
    '',
    `${origin}/creating/${RATIOED_PATH}/${String(take).padStart(2, '0')}`,
  ].join('\n');
}

/**
 * The next take number.
 *
 * Counted off the highest take that exists rather than the number of pieces:
 * a gap in the series (a piece deleted, a record never written) must not make
 * the next one re-use a number somebody has already been told.
 */
export function nextTake(pieces) {
  let max = 0;
  for (const p of pieces || []) if (Number.isFinite(p?.take)) max = Math.max(max, p.take);
  return max + 1;
}

/** The piece a new one should quote: the most recent finished one. */
export function previousPiece(pieces) {
  const sorted = [...(pieces || [])].filter((p) => p?.take).sort((a, b) => b.take - a.take);
  return sorted[0] || null;
}

/**
 * Where this piece falls in the series by how long it stood.
 *
 * Returns `'shortest'`, `'longest'` or null. Take #13's announcement carried
 * exactly this line, and it's the kind of thing that is only true at the
 * moment of writing — so it's computed against the pieces that exist rather
 * than remembered.
 */
export function lifespanRank(lifespanMs, others) {
  const spans = (others || [])
    .map((p) => p.lifespanMs)
    .filter((v) => typeof v === 'number' && v > 0);
  if (!spans.length || typeof lifespanMs !== 'number') return null;
  if (lifespanMs < Math.min(...spans)) return 'shortest';
  if (lifespanMs > Math.max(...spans)) return 'longest';
  return null;
}

/** `{likes:1, threadPosts:0, …}` → `zero engagement` / `21 replies and 4 reposts`. */
export function engagementPhrase(preSeal) {
  const parts = [];
  const add = (n, one, many) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(preSeal?.threadPosts || 0, 'reply', 'replies');
  add(preSeal?.reposts || 0, 'repost', 'reposts');
  add(preSeal?.quotes || 0, 'quote', 'quotes');
  if (!parts.length) return 'zero engagement';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The concluding reply, prefilled.
 *
 * The first line has been identical since take #1 and is what
 * `breakerFromAnnouncement` reads the breaker back out of, so it is generated
 * verbatim. The two below it are the extras take #13 carried; they're offered
 * because they're true, and they're editable because whether a piece deserves
 * a closing sentence is not a thing arithmetic decides.
 */
export function announcementDraft({ handle, piece, others }) {
  const lines = [
    `thank you for your participation, this piece has now concluded, @${handle} was to blame for liking the post`,
  ];
  if (piece?.preSeal) {
    lines.push('', `at the time of this piece’s completion, it had ${engagementPhrase(piece.preSeal)}`);
  }
  if (typeof piece?.lifespanMs === 'number') {
    const rank = lifespanRank(piece.lifespanMs, others);
    lines.push(
      '',
      `it lasted approximately ${fmtDuration(piece.lifespanMs)}${
        rank ? `, it is now the ${rank} piece in the series` : ''
      }`,
    );
  }
  return lines.join('\n');
}
