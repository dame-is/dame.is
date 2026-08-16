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

import { COLLECTIONS, RATIOED_PATH } from '../config.js';
import { fmtDuration } from './ratioed.js';
import { anchorsFromTemplate, isPiecePost, takeFromText } from './ratioedDiscovery.js';

/**
 * The template's placeholders. `{take}` is the number as written in the post
 * ("this is take #14"); `{link}` is the piece's own page, padded the way the
 * canonical URL is.
 */
export function fillTemplate(text, take, { origin = 'dame.is' } = {}) {
  const link = `${origin}/creating/${RATIOED_PATH}/${String(take).padStart(2, '0')}`;
  return String(text ?? '')
    .replaceAll('{take}', String(take))
    .replaceAll('{link}', link);
}

/**
 * Is this template safe to publish from?
 *
 * The scan that measures a piece finds it by reading the post, so a template
 * the scan can't recognise produces pieces the site never measures. That is not
 * hypothetical: take #13 dropped the word "experimental" and went missing until
 * somebody noticed by hand. The check runs against a filled-in copy, using the
 * same two functions the discovery scan uses — so this can never drift from
 * what the scan actually accepts.
 *
 * The scan now reads this same record and matches on the template's own lines,
 * so rewording the copy no longer needs a code change. That covers a piece
 * posted from the template as it stands; a piece posted from a template that
 * has since been rewritten twice over has only the take line and the link left
 * to be found by, which is why those two are still required here rather than
 * merely encouraged.
 *
 * Returns a list of problems; empty means good.
 */
export function templateProblems(text, take = 99) {
  const filled = fillTemplate(text, take);
  const out = [];
  if (!filled.trim()) out.push('The template is empty.');
  if (!isPiecePost({ text: filled }, anchorsFromTemplate(text))) {
    out.push(
      'The scan wouldn’t recognise this as a piece. Keep the take line and {link}, or a line of at least 24 characters that every piece will carry.',
    );
  }
  if (takeFromText(filled) !== take) {
    out.push('The take number can’t be read back. Keep a line like “this is take #{take}”.');
  }
  if (!String(text ?? '').includes('{link}')) {
    out.push('No {link}, so the post won’t link to the piece’s own page.');
  }
  return out;
}

/**
 * The standing text with the placeholders still in. This is the shape that gets
 * stored on the PDS and edited in the studio; it's the fallback when no record
 * has been written yet, which is also the state the site starts in — so this
 * tracks the current wording rather than freezing an old one.
 */
export const DEFAULT_TEMPLATE = [
  'i would like your help with a social art project',
  '',
  'this post is the project',
  '',
  'the goal is for this post to receive ZERO likes… only replies, reposts, or quotes',
  '',
  "once it's liked, replies are immediately disabled, thereby finishing the piece",
  '',
  'this is take #{take}',
  '',
  '{link}',
].join('\n');

/**
 * The standing text as stored on the PDS, falling back to the default when no
 * record has been written yet.
 *
 * Never throws. Both callers are reading it to do something else — compose a
 * piece, scan for one — and neither should stop because the template couldn't
 * be fetched; the wording the code already knows is a good enough answer for
 * both.
 */
export async function loadTemplate(agent, did) {
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: COLLECTIONS.ratioedTemplate,
      rkey: 'self',
    });
    return res?.data?.value?.text || DEFAULT_TEMPLATE;
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

/** The default template with a take number in it. */
export function pieceTemplate(take, opts) {
  return fillTemplate(DEFAULT_TEMPLATE, take, opts);
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
