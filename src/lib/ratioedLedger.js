// A live Ratioed piece, said in sentences.
//
// The studio's panel and the piece's own page used to report a running piece
// as a dashboard: a clock in the corner, a sentence under a bar, five figures in
// a grid, and a feed whose rows were icons, faces and stamps. On a phone that
// was a third of a screen of instruments before the first reply, and the one
// reading that changes from moment to moment (how far behind the stream is)
// had nowhere to sit and wrapped onto a line of its own.
//
// The ledger says the same things the way the site's own feeds do: a sentence
// for how long it has stood, one for how it compares, one for what it has
// drawn, and a list where each row reads "replied · @someone · +31m36s". These
// are those sentences, kept here so the studio and the page cannot say them
// differently and so the plurals and the zero cases have a test.

import { fmtDuration } from './ratioed.js';
import { tallyWitness } from './ratioedLive.js';

/** What a row's record did, in the ledger's margin. */
export const KIND_VERB = { like: 'liked', repost: 'reposted', quote: 'quoted', reply: 'replied' };

/**
 * The margin word for one row. The artist's own records are named as theirs
 * rather than by what they did: they are in the log and in none of the counts,
 * and the margin is where a reader looks to tell the two apart.
 */
export function rowVerb(row, { selfDid = null } = {}) {
  if (selfDid && row?.did === selfDid) return 'the artist';
  return KIND_VERB[row?.k] || row?.k || '';
}

/** "a", "a and b", "a, b and c". */
export function listJoin(items) {
  const list = (items || []).filter(Boolean);
  if (list.length < 2) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const NOUN = {
  reply: ['reply', 'replies'],
  repost: ['repost', 'reposts'],
  quote: ['quote', 'quotes'],
  like: ['like', 'likes'],
  person: ['person', 'people'],
};

/** `3 replies`, `1 reply`. */
export function countOf(n, noun) {
  const [one, many] = NOUN[noun] || [noun, `${noun}s`];
  return `${n} ${n === 1 ? one : many}`;
}

const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * What the piece has drawn, as a run of short sentences.
 *
 * Returned as segments rather than one string because the likes sentence is
 * the one that matters and is drawn differently: `none` while there are none
 * (the piece succeeding), `like` once there is one (the piece over), and `gone`
 * for one that was cast and taken back. Everything else has no tone.
 *
 *   21 replies, 5 reposts and 3 quotes, from 25 people. No likes.
 *   21 replies, 5 reposts and 3 quotes, from 26 people. One like.
 *   21 replies, 5 reposts and 3 quotes, from 25 people. One like, taken back.
 *
 * The artist's own records are left out, the rule every figure on the project
 * follows. `people` counts everyone standing, the likers included.
 */
export function countsSentence(rows, { selfDid = null } = {}) {
  const list = rows || [];
  const tally = tallyWitness(list, { selfDid });
  const theirs = list.filter((r) => !(selfDid && r.did === selfDid));
  const gone = { like: 0, reply: 0, repost: 0, quote: 0 };
  for (const r of theirs) if (r.goneMs != null && r.k in gone) gone[r.k] += 1;

  if (tally.total === 0 && tally.withdrawn === 0) {
    return [{ text: 'Nothing has touched it yet.' }];
  }

  const out = [];
  const drawn = [
    tally.replies && countOf(tally.replies, 'reply'),
    tally.reposts && countOf(tally.reposts, 'repost'),
    tally.quotes && countOf(tally.quotes, 'quote'),
  ];
  if (drawn.some(Boolean)) {
    out.push({ text: `${listJoin(drawn)}, from ${countOf(tally.people, 'person')}.` });
  }

  if (tally.likes === 0) out.push({ text: 'No likes.', tone: 'none' });
  else if (tally.likes === 1) out.push({ text: 'One like.', tone: 'like' });
  else out.push({ text: `${tally.likes} likes.`, tone: 'like' });

  if (gone.like === 1) out.push({ text: 'One like, taken back.', tone: 'gone' });
  else if (gone.like > 1) out.push({ text: `${gone.like} likes, taken back.`, tone: 'gone' });

  const goneElse = listJoin([
    gone.reply && countOf(gone.reply, 'reply'),
    gone.repost && countOf(gone.repost, 'repost'),
    gone.quote && countOf(gone.quote, 'quote'),
  ]);
  if (goneElse) out.push({ text: `${capitalise(goneElse)} deleted.` });

  return out;
}

/**
 * How the piece is doing against the longest one so far.
 *
 *   20m31s short of take 27’s record of 54m01s, and longer than 38 of the 41 before it.
 *   4m10s past take 27’s record of 54m01s: the longest piece in the series.
 *
 * `passed` is how many of the other finished pieces it has outlived and `total`
 * how many finished pieces there are, the record among them. Null without a
 * record, which is the state take 1 was in.
 */
export function recordSentence({ elapsedMs = 0, record = null, passed = 0, total = 0 } = {}) {
  const target = record?.lifespanMs || 0;
  if (!target) return null;
  const take = String(record.take ?? '').padStart(2, '0');
  const mark = `take ${take}’s record of ${fmtDuration(target)}`;
  if (elapsedMs >= target) {
    return `${fmtDuration(elapsedMs - target)} past ${mark}: the longest piece in the series.`;
  }
  const outlived = passed > 0 && total > 0 ? `, and longer than ${passed} of the ${total} before it` : '';
  return `${fmtDuration(target - elapsedMs)} short of ${mark}${outlived}.`;
}
