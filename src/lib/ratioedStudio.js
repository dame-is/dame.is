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
 * The line that starts a new reply.
 *
 * A post is 300 graphemes and what a piece has to say about itself as it ends
 * no longer fits in one: the blame sentence, the figures, how long it stood,
 * where the breaker's record is and where the replay is come to 338 characters
 * for a short handle and 418 for the longest in the roster. A thread is what a
 * person would do, so the template can say where it breaks.
 *
 * An explicit marker rather than splitting on length. Where a sentence lands is
 * a decision about writing, and a splitter that guessed would move the break
 * every time a handle changed length.
 */
export const ANNOUNCEMENT_BREAK = '---';

/**
 * A filled-in reply, cut into the posts it will be sent as.
 *
 * Always at least one, so a template with no marker in it is one reply and the
 * flow is unchanged.
 */
export function announcementParts(text) {
  return String(text ?? '')
    .split(/^\s*---\s*$/m)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The whole concluding reply, with the parts of it that are arithmetic left as
 * placeholders.
 *
 * It used to be one sentence, and the two paragraphs under it — the engagement
 * and the lifespan — were assembled in JS below. That made the record's promise
 * half true: the opening line could be rewritten without a deploy and nothing
 * else could, including whether the other paragraphs appeared at all. The whole
 * reply is the template now, so what a piece says about itself as it ends is
 * writing rather than code.
 *
 * "was to blame" is load-bearing and not decoration: `BLAME_RE` in
 * ratioedDiscovery parses the breaker back out of this reply, and for a piece
 * whose like was later deleted it is the only evidence the like ever existed.
 * So a rewrite that drops the phrase is refused rather than quietly breaking
 * the scan — see `announcementProblems`.
 */
export const DEFAULT_ANNOUNCEMENT = [
  'thanks for participating, piece {take} has now concluded, @{handle} was to blame for liking the post',
  '',
  'at completion time it had {counts}, and lasted {duration}',
  '',
  'view liker’s page: {participant}',
  '',
  'watch the replay: {link}',
].join('\n');

/**
 * Every placeholder the concluding reply understands, and what each becomes.
 *
 * Data rather than prose so the studio's hint and this module's filler cannot
 * drift apart: the editor lists exactly what `fillAnnouncement` will replace.
 */
export const ANNOUNCEMENT_TOKENS = [
  ['{handle}', 'the account whose like ended it'],
  ['{take}', 'the take number'],
  ['{engagement}', '“6 replies and 2 reposts”, or “zero engagement”'],
  ['{counts}', 'the same list without the “and”: “6 replies, 2 reposts”'],
  ['{duration}', 'how long it stood'],
  ['{rank}', '“, it is now the shortest piece in the series”, on a piece that is'],
  ['{participant}', 'the breaker’s page on this site'],
  ['{link}', 'the piece’s own page'],
];

/** A post's ceiling, in graphemes. Bluesky's, not ours. */
export const FEED_MAX = 300;

/**
 * The placeholders filled in. Anything else in braces is left as itself, so a
 * sentence about a `{placeholder}` reads as itself.
 *
 * A handle on its own is still accepted, since that is what this took for its
 * first sixteen takes. A figure that has not been measured is left as its own
 * placeholder rather than printed as a zero — an unmeasured piece has no
 * engagement, and "zero engagement" is a finding.
 */
export function fillAnnouncement(text, vars = {}) {
  const v = typeof vars === 'string' ? { handle: vars } : vars || {};
  const subs = {
    handle: v.handle || 'somebody',
    take: v.take,
    engagement: v.engagement,
    counts: v.counts,
    duration: v.duration,
    rank: v.rank ?? '',
    participant: v.participant,
    link: v.link,
  };
  return String(text || DEFAULT_ANNOUNCEMENT).replace(
    /\{(handle|take|engagement|counts|duration|rank|participant|link)\}/g,
    (whole, name) => (subs[name] == null ? whole : String(subs[name])),
  );
}

// The longest handle the project has drawn, and the longest take and figures it
// plausibly will. A template is checked against what it produces at its worst
// rather than at its shortest, because the piece it fails on is the one with
// the interesting participant in it.
const WORST = {
  handle: 'catblanketflower.yuwakisa.com',
  take: 99,
  engagement: '99 replies, 99 reposts and 99 quotes',
  counts: '99 replies, 99 reposts, 99 quotes',
  duration: '99m99s',
  rank: '',
};

/**
 * How long a filled-in reply runs, counted the way a post is.
 *
 * `Intl.Segmenter` where it exists, because a post's limit is graphemes and an
 * emoji in somebody's handle is one grapheme and several UTF-16 units. The
 * spread is the fallback, which at least counts astral pairs once.
 */
export function graphemes(text) {
  const t = String(text ?? '');
  try {
    return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(t)].length;
  } catch {
    return [...t].length;
  }
}

/** The length of each post a template will produce, at its worst. */
export function announcementLengths(text, vars = WORST) {
  const filled = fillAnnouncement(text, {
    ...vars,
    participant: `https://dame.is/creating/${RATIOED_PATH}/participant/${vars.handle}`,
    link: `https://dame.is/creating/${RATIOED_PATH}/${String(vars.take).padStart(2, '0')}`,
  });
  // Counted on the post rather than on the draft, because the post is what the
  // limit applies to and the two are different lengths — see shortenPost.
  return announcementParts(filled).map((part) => graphemes(shortenPost(part).text));
}

/**
 * What is wrong with a proposed concluding reply, in plain words.
 *
 * The length check is the one that bites in practice. A reply is a post and a
 * post is 300 graphemes; the moment this template grew two URLs it started
 * landing over that for a long handle and under it for a short one, which is a
 * failure you would otherwise meet at the moment of posting rather than at the
 * moment of writing.
 */
export function announcementProblems(text) {
  const out = [];
  const t = String(text || '');
  if (!t.trim()) out.push('The concluding reply cannot be empty.');
  if (!t.includes('{handle}')) out.push('It needs {handle}, which becomes the breaker’s account.');
  if (!/was to blame/i.test(t)) {
    out.push(
      'It has to keep the phrase “was to blame”: that is what the site reads the breaker back out ' +
        'of, and on a piece whose like was deleted it is the only evidence the like existed.',
    );
  }
  const lengths = announcementLengths(t);
  lengths.forEach((n, i) => {
    if (n <= FEED_MAX) return;
    const which = lengths.length > 1 ? `Reply ${i + 1} of ${lengths.length}` : 'Filled in';
    out.push(
      `${which} runs to ${n} characters for the longest handle in the roster, and a post is ` +
        `${FEED_MAX}. Shorten a line, drop one, or put a “${ANNOUNCEMENT_BREAK}” where it should ` +
        'become a second reply.',
    );
  });
  return out;
}

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
  const { text } = await loadTemplateRecord(agent, did);
  return text;
}

/**
 * The whole template record: the post body AND the concluding reply's opening
 * sentence.
 *
 * The second one was declared in the lexicon, described there as the wording
 * the site parses the breaker back out of, and read by nothing — the sentence
 * was hardcoded in JS, so the record's promise that it changes without a deploy
 * was true of `text` and false of `announcement`. Worse, the studio's save
 * wrote `{ $type, text, updatedAt }`, a whole-record replacement that would
 * have silently deleted anything hand-written into it.
 */
export async function loadTemplateRecord(agent, did) {
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: COLLECTIONS.ratioedTemplate,
      rkey: 'self',
    });
    const v = res?.data?.value || {};
    return {
      text: v.text || DEFAULT_TEMPLATE,
      announcement: v.announcement || DEFAULT_ANNOUNCEMENT,
    };
  } catch {
    return { text: DEFAULT_TEMPLATE, announcement: DEFAULT_ANNOUNCEMENT };
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
export function engagementPhrase(preSeal, { and = true } = {}) {
  const parts = [];
  const add = (n, one, many) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(preSeal?.threadPosts || 0, 'reply', 'replies');
  add(preSeal?.reposts || 0, 'repost', 'reposts');
  add(preSeal?.quotes || 0, 'quote', 'quotes');
  if (!parts.length) return 'zero engagement';
  if (parts.length === 1) return parts[0];
  // A list that ends in "and" is a sentence; a bare list is a clause somebody
  // else's sentence continues. Both are wanted, in different templates.
  if (!and) return parts.join(', ');
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
export function announcementDraft({ handle, piece, others, announcement, origin = 'dame.is' }) {
  const rank = typeof piece?.lifespanMs === 'number' ? lifespanRank(piece.lifespanMs, others) : null;
  const take = piece?.take;
  return fillAnnouncement(announcement || DEFAULT_ANNOUNCEMENT, {
    handle,
    take,
    engagement: piece?.preSeal ? engagementPhrase(piece.preSeal) : null,
    counts: piece?.preSeal ? engagementPhrase(piece.preSeal, { and: false }) : null,
    duration: typeof piece?.lifespanMs === 'number' ? fmtDuration(piece.lifespanMs) : null,
    rank: rank ? `, it is now the ${rank} piece in the series` : '',
    // Whole URLs, scheme and all. The draft is what a person reads and edits,
    // and a link they cannot see the end of is not one they can check; the post
    // carries the short form and the whole URL in a facet beside it, which is
    // where the characters are saved. See shortenPost.
    participant: handle ? `https://${origin}/creating/${RATIOED_PATH}/participant/${handle}` : null,
    link: take ? `https://${origin}/creating/${RATIOED_PATH}/${String(take).padStart(2, '0')}` : null,
  });
}

/* ------------------------------------------------------------------ */
/* Links, the way a post carries them                                   */
/* ------------------------------------------------------------------ */

/**
 * A URL as Bluesky shows it in a post: the host and path, no scheme, cut at
 * thirty characters.
 *
 * This is not decoration. A post's 300-character limit is counted against the
 * text of the record, and the client that composes these posts puts the
 * SHORTENED string there and the whole URL in a facet beside it. So a link
 * costs about thirty characters however long it really is — which is the
 * difference between a concluding reply that fits for a seven-character handle
 * and one that fits for every handle in the roster, because the participant
 * link contains the handle and stops growing at the cut.
 */
export function shortUrl(url) {
  const raw = String(url || '');
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const shown = u.host + (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
    return shown.length > 30 ? `${shown.slice(0, 29)}…` : shown;
  } catch {
    return raw;
  }
}

// Bare enough to catch what a person writes and no more: a scheme or a bare
// host, run to the first whitespace, with trailing punctuation left out of the
// link the way every linkifier does — a URL at the end of a sentence is not
// meant to swallow the full stop.
const URL_RE = /\b(?:https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s]*)/gi;
const TRAILING = /[.,;:!?)\]}'"…]+$/;

const utf8 = (s) => new TextEncoder().encode(s).length;

/**
 * A draft, rewritten as the post it will become.
 *
 * Returns the shortened text and where its links are, in the UTF-8 byte offsets
 * a facet is measured in. The caller detects mentions on the returned text and
 * keeps these spans for itself: a shortened URL is still a plausible-looking
 * host, and a detector run over it would link it to itself rather than to where
 * it goes.
 */
export function shortenPost(text) {
  const src = String(text ?? '');
  let out = '';
  let last = 0;
  const links = [];
  for (const m of src.matchAll(URL_RE)) {
    const whole = m[0];
    const trail = (whole.match(TRAILING) || [''])[0];
    const uri = whole.slice(0, whole.length - trail.length);
    if (!uri) continue;
    out += src.slice(last, m.index);
    const start = utf8(out);
    out += shortUrl(uri);
    links.push({ start, end: utf8(out), uri: /^https?:\/\//i.test(uri) ? uri : `https://${uri}` });
    out += trail;
    last = m.index + whole.length;
  }
  out += src.slice(last);
  return { text: out, links };
}
