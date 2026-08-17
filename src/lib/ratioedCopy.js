// The words on a Ratioed piece's page, editable without a deploy.
//
// The same argument the post template makes: the project's account of itself
// has drifted across sixteen takes — the essay was rewritten, "experimental"
// was dropped from the post, the live page was three paragraphs and is now one
// — and the wording is the artist's, not the build's. So it lives in a record
// (is.dame.creating.ratioed.copy, a singleton at "self") and the studio edits
// it.
//
// What this is NOT is the figures. Nothing in this file can change what a piece
// measured; the numbers, the log, the reaction time and the roster all come
// from the piece's own record and are compiled into the sentences around them
// by the page. A caption is writing; a measurement is evidence.
//
// Every field defaults to the sentence the site shipped with, so an absent
// record, an empty field or an unreachable PDS all render the same page as
// before it existed.

import { fetchSnapshot } from './snapshot.js';
import { getRecord } from './atproto.js';
import { COLLECTIONS, ME_DID } from '../config.js';

/**
 * The built-in wording, and the fallback for every field.
 *
 * Keep these as prose rather than as fragments: they are what a reader sees
 * when nothing has been written, and the site should read as finished in that
 * state rather than as a form waiting to be filled in.
 */
export const DEFAULT_COPY = {
  liveLede:
    'Take {take} is up right now. The goal is zero likes: the first one ends it, and the seconds between that like and the artist closing replies are the measurement.',
  liveNote: 'No need to reload. This page reads the piece’s record and changes when it is sealed.',
  deckAlive: 'Nobody has liked it. The goal is zero likes, so everything below is the piece succeeding.',
  deckLiked:
    'It has been liked, so it is over. The clock above runs until the artist closes replies by hand; where it stops is the measurement.',
  deckWithdrawn: 'Somebody liked it and took it back. Nothing stands against it now.',
  deckStream:
    'Your browser is testing every record on the network against this post, about 166 KB/s. It pauses in a background tab and stops at {budget} MB.',
  deckRecord: 'Reading the piece’s own record, a few seconds behind.',
  replay: 'The rule is the threadgate. Everything past it landed on a finished post.',
  witnessed:
    'Written as it happened rather than measured afterwards, so it is the only place a deleted record still appears.',
  roster: 'In the order they arrived. Portraits are current; the counts under them are not.',
  hidden: 'A threadgate hides replies at the appview. It does not stop the records being made.',
  log: 'Every record pointing at this piece, timed from the moment it went up, as counted at measurement time.',
  reach:
    'Followers of everyone who touched it, weighted by what they did: a repost or quote counts as a whole following, a reply a tenth, a like a fiftieth.',
};

/**
 * The fields in the order the studio shows them, with what each one is for.
 *
 * Data rather than markup so the form is one map and adding a field is one
 * entry here plus one in the lexicon — the same shape `surfaces.js` uses for
 * the same reason.
 */
export const COPY_FIELDS = [
  { key: 'liveLede', label: 'Live piece: opening', hint: 'The first paragraph while a piece is up. {take} becomes the take number.' },
  { key: 'liveNote', label: 'Live piece: under the dashboard', hint: 'What happens to this page when the piece ends.' },
  { key: 'deckAlive', label: 'Dashboard: nobody has liked it', hint: 'The state a piece spends almost all of its life in.' },
  { key: 'deckLiked', label: 'Dashboard: it has been liked', hint: 'The piece is over and the reaction time is running.' },
  { key: 'deckWithdrawn', label: 'Dashboard: the like was taken back', hint: 'Cast and deleted, so nothing is standing against it.' },
  { key: 'deckStream', label: 'Dashboard: reading the firehose', hint: 'What the reader’s own browser is doing. {budget} becomes the MB cap.' },
  { key: 'deckRecord', label: 'Dashboard: reading the record', hint: 'The cheap reader, which is the default on a phone.' },
  { key: 'replay', label: 'Sealed piece: replay', hint: 'Over the replay of a finished piece.' },
  { key: 'witnessed', label: 'Sealed piece: the dashboard as it ran', hint: 'Over the log the studio kept while it was up.' },
  { key: 'roster', label: 'Sealed piece: who was there', hint: 'Over the faces.' },
  { key: 'hidden', label: 'Sealed piece: replies hidden by the threadgate', hint: 'Written into a thread that was already closed.' },
  { key: 'log', label: 'Sealed piece: the log', hint: 'The site appends how many breaking likes have since been deleted.' },
  { key: 'reach', label: 'Sealed piece: reach', hint: 'The site appends what it could not resolve, and when followers were read.' },
];

/** The record's fields folded over the defaults, empties ignored. */
export function mergeCopy(value) {
  const out = { ...DEFAULT_COPY };
  for (const { key } of COPY_FIELDS) {
    const written = value?.[key];
    if (typeof written === 'string' && written.trim()) out[key] = written.trim();
  }
  return out;
}

/**
 * `{take}` and `{budget}` filled in. Anything else in braces is left alone —
 * a sentence about a `{placeholder}` should read as itself.
 */
export function fillCopy(text, vars = {}) {
  return String(text || '').replace(/\{(take|budget)\}/g, (whole, name) =>
    vars[name] == null ? whole : String(vars[name]),
  );
}

/**
 * The copy as it stands: the build's snapshot first so the page paints with the
 * right words, then the PDS, which is the only place a rewrite from ten minutes
 * ago exists. Never throws — every failure lands on the defaults.
 */
export async function loadCopy(pds) {
  const snap = await fetchSnapshot('ratioedCopy').catch(() => null);
  const fromSnap = snap?.value || (Array.isArray(snap) ? snap[0]?.value : null);
  if (!pds) return mergeCopy(fromSnap);
  const live = await getRecord(pds, {
    repo: ME_DID,
    collection: COLLECTIONS.ratioedCopy,
    rkey: 'self',
  }).catch(() => null);
  return mergeCopy(live?.value || fromSnap);
}
