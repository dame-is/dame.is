// /experimenting: what an experiment is, and what a pile of reactions to one
// adds up to. Pure helpers, with nothing here that touches the network, so the
// pages, the build's snapshot, the edge and the tests all read an experiment
// the same way. Reading and writing reactions lives in experimentReactions.js.
//
// An experiment is an `is.dame.experiment` record on my repo: a title, the idea
// in a sentence or two, and whatever there is to show for it so far (a picture,
// a link to try, a longer write-up). It is posted to find out what people make
// of it before any more gets built, so the page's other half is the reactions:
// `is.dame.experiment.reaction` records on the REACTORS' repos, each pointing
// back at the experiment. See lexicons/EXPERIMENTING.md.

import { rkeyFromAtUri, tidToTimestamp } from './atproto.js';
import { compareIsoDesc } from './time.js';
import { ME_DID, EXPERIMENT_NSID, EXPERIMENT_REACTION_NSID } from '../config.js';
import { SITE_HOST } from './linkPreviews.js';

/** Where the experiments are listed. */
export const EXPERIMENTING_PATH = '/experimenting';

/** The page for one experiment: `/experimenting/{rkey}`. */
export function experimentPath(rkey) {
  return rkey ? `${EXPERIMENTING_PATH}/${encodeURIComponent(rkey)}` : EXPERIMENTING_PATH;
}

/**
 * Experiments that are pages of this site, built into it, rather than links
 * away from it. Each sits under the bench in the place an experiment's record
 * key would be, so the router and the edge both ask isExperimentPagePath
 * before treating such a path as a record: asked for as one it would 404. A
 * record key is a TID, and none of these is one.
 *
 * The first is /experimenting/culturing, a bench of simulated petri dishes.
 * Its experiment record points its "Try it" here. The second is
 * /experimenting/sunfarming, a small game about building a solar farm on an
 * island.
 *
 * Each is a package of its own under experiments/ (experiments/culturing,
 * experiments/sunfarming) that the site only imports; see
 * experiments/README.md for that arrangement.
 */
export const CULTURING_PATH = `${EXPERIMENTING_PATH}/culturing`;
export const SUNFARMING_PATH = `${EXPERIMENTING_PATH}/sunfarming`;
export const EXPERIMENT_PAGE_PATHS = Object.freeze([CULTURING_PATH, SUNFARMING_PATH]);

export function isExperimentPagePath(pathname) {
  return EXPERIMENT_PAGE_PATHS.includes(String(pathname || '').replace(/\/+$/, ''));
}

/** The at-uri reactions point at: the experiment record on my repo. */
export function experimentUri(rkey) {
  return `at://${ME_DID}/${EXPERIMENT_NSID}/${rkey}`;
}

/** Constellation source tuple: which records and field point at an experiment. */
export const REACTION_SOURCE = `${EXPERIMENT_REACTION_NSID}:subject`;

/* ── the vocabulary ───────────────────────────────────────────────────────── */

/**
 * The three verdicts, in the order they are offered. `label` is the button,
 * `tally` the same thing counted ("4 more of this"), and `said` how one
 * person's reaction reads beside their note.
 *
 * The lexicon leaves `reaction` an open string, so a record carrying anything
 * else is still a reaction; it just isn't one of these (see tallyReactions).
 */
export const REACTIONS = Object.freeze([
  Object.freeze({
    key: 'more',
    label: 'More of this',
    tally: 'more of this',
    said: 'wants more of this',
    hint: 'Build it. I’d want this.',
  }),
  Object.freeze({
    key: 'curious',
    label: 'Curious',
    tally: 'curious',
    said: 'is curious',
    hint: 'Interested, not sold yet.',
  }),
  Object.freeze({
    key: 'pass',
    label: 'Not for me',
    tally: 'not for me',
    said: 'says it’s not for them',
    hint: 'Doesn’t land for me.',
  }),
]);

const REACTION_BY_KEY = Object.fromEntries(REACTIONS.map((r) => [r.key, r]));

/** The vocabulary entry for a reaction key, or null for one it doesn't know. */
export function reactionFor(key) {
  return REACTION_BY_KEY[String(key || '')] || null;
}

/** Grapheme limits mirrored from lexicons/is.dame.experiment.reaction.json. */
export const REACTION_TEXT_MAX_GRAPHEMES = 300;

/**
 * Where an experiment stands. `open` is the default and the only one that
 * invites reactions; the other two say how it came out.
 */
export const STATUSES = Object.freeze({
  open: Object.freeze({ key: 'open', label: 'Taking reactions' }),
  pursuing: Object.freeze({ key: 'pursuing', label: 'Being built' }),
  shelved: Object.freeze({ key: 'shelved', label: 'Shelved' }),
});

/** An experiment's status: a known one, or `open` for anything else. */
export function experimentStatus(value) {
  return STATUSES[String(value?.status || '')] || STATUSES.open;
}

/** Whether the page should ask for reactions to this experiment. */
export function takesReactions(value) {
  return experimentStatus(value).key === 'open';
}

/** How far along it is, in the record's own word; '' when it doesn't say. */
export function experimentKind(value) {
  return String(value?.kind || '').trim().toLowerCase();
}

/* ── reading an experiment ────────────────────────────────────────────────── */

/** Hidden from the public page until its author says otherwise. */
export function isDraftExperiment(value) {
  return value?.draft === true;
}

/** When it was posted: the record's own date, or its record key's. */
export function experimentDate(record) {
  const own = record?.value?.createdAt;
  if (own && !Number.isNaN(Date.parse(own))) return own;
  return tidToTimestamp(rkeyFromAtUri(record?.uri)) || null;
}

/** The picture's address and alt text, or null when it has none to show. */
export function experimentImage(value) {
  const url = value?.image?._url;
  if (!url) return null;
  return { url, alt: String(value?.imageAlt || '').trim() };
}

/** The host this page is being read at, when there is a page. */
function hostHere() {
  return typeof window === 'undefined' ? '' : window.location.host;
}

/**
 * The link to try it at, when it is one a page should offer: http(s) only, so
 * a record can't put a `javascript:` address behind "Try it".
 *
 * `local` says the link is to this site: the site's own host, or the host the
 * page is being read at (`here`; a preview deployment, a dev server). Such a
 * link is a page here, at `path`. It opens in place, and it isn't said to be
 * "at" anywhere: that would name the site the reader is already on.
 */
export function experimentLink(value, { here = hostHere() } = {}) {
  const raw = String(value?.url || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.host.replace(/^www\./, '');
    const local = host === SITE_HOST || (Boolean(here) && url.host === here);
    return {
      href: url.href,
      host,
      local,
      path: local ? `${url.pathname}${url.search}${url.hash}` : null,
    };
  } catch {
    return null;
  }
}

/**
 * Whether there is a longer write-up beyond the pitch. The block editor seeds
 * a body with one empty text block, and that shell survives a save, so "the
 * field is present" isn't the question; "does a block say anything" is. (The
 * same test as lexicons.js's hasLeafletContent, kept here so this module stays
 * light enough for the edge to import.)
 */
export function hasWriteUp(value) {
  for (const page of value?.content?.pages || []) {
    for (const wrap of page?.blocks || []) {
      const block = wrap?.block;
      if (!block) continue;
      if (block.$type !== 'pub.leaflet.blocks.text') return true;
      if (String(block.plaintext || '').trim()) return true;
    }
  }
  return false;
}

/**
 * The experiments a page lists, newest first. Records without a title are
 * dropped (nothing to show), and drafts unless `includeDrafts` (the owner's
 * view). Never mutates `records`.
 */
export function listExperiments(records, { includeDrafts = false } = {}) {
  return (Array.isArray(records) ? records : [])
    .filter((r) => r?.uri && String(r?.value?.title || '').trim())
    .filter((r) => includeDrafts || !isDraftExperiment(r.value))
    .slice()
    .sort((a, b) => compareIsoDesc(experimentDate(a), experimentDate(b)));
}

/**
 * The published experiment whose "Try it" leads to `path` on this site, or
 * null. It is how a built-in experiment's page finds its own record, and so
 * the reactions to it: by the address the record gives, whatever host it was
 * written with. The newest wins if two point at one page.
 */
export function experimentForPage(records, path) {
  const want = String(path || '').replace(/\/+$/, '');
  if (!want) return null;
  return (
    listExperiments(records).find((r) => {
      const link = experimentLink(r.value);
      if (!link) return false;
      try {
        return new URL(link.href).pathname.replace(/\/+$/, '') === want;
      } catch {
        return false;
      }
    }) || null
  );
}

/** The experiment with this record key among `records`, or null. */
export function findExperiment(records, rkey, opts) {
  if (!rkey) return null;
  return listExperiments(records, opts).find((r) => rkeyFromAtUri(r.uri) === rkey) || null;
}

/**
 * Each public experiment's number, by at-uri: the oldest is 1, the newest the
 * count. Drafts have none and don't use one up, so the numbers a visitor sees
 * never skip. They describe the list as it stands, the way the guestbook's
 * line numbers do: delete an experiment and the later ones each move down one.
 */
export function experimentNumbers(records) {
  const numbers = new Map();
  const listed = listExperiments(records);
  listed.forEach((r, i) => numbers.set(r.uri, listed.length - i));
  return numbers;
}

/**
 * The facts line under an experiment's title, as parts to be joined:
 * "Experiment 7", "prototype". The status is left to the caller, which sets
 * it as a tag.
 */
export function experimentFacts(record, number = null) {
  const parts = [];
  if (number) parts.push(`Experiment ${number}`);
  const kind = experimentKind(record?.value);
  if (kind) parts.push(kind);
  return parts;
}

/* ── what the reactions add up to ─────────────────────────────────────────── */

/** When a reaction was left: its own date, or its record key's. */
export function reactionDate(reaction) {
  const own = reaction?.value?.createdAt;
  if (own && !Number.isNaN(Date.parse(own))) return own;
  return tidToTimestamp(reaction?.rkey) || null;
}

/**
 * One reaction per person: the newest each account left, newest first.
 *
 * Nothing stops an account from writing several records at one experiment (the
 * page replaces the old one when a reaction is changed, but a record can be
 * written straight to a PDS). Counting them all would let one person be a
 * crowd, so only the latest stands, here, where every reader goes through.
 */
export function latestPerPerson(reactions) {
  const sorted = (Array.isArray(reactions) ? reactions : [])
    .filter((r) => r?.did && r?.value)
    .slice()
    .sort((a, b) => compareIsoDesc(reactionDate(a), reactionDate(b)));
  const seen = new Set();
  const out = [];
  for (const r of sorted) {
    if (seen.has(r.did)) continue;
    seen.add(r.did);
    out.push(r);
  }
  return out;
}

/**
 * The reactions that count: one per person, minus the ones the host has
 * hidden (`hiddenUris`, the experiment record's `hidden` list). A person whose
 * newest reaction is hidden doesn't fall back to an older one.
 */
export function standingReactions(reactions, hiddenUris = null) {
  const hidden = hiddenUris instanceof Set ? hiddenUris : new Set(hiddenUris || []);
  return latestPerPerson(reactions).filter((r) => !hidden.has(r.uri));
}

/**
 * Counts by verdict: `{ total, more, curious, pass, other }`. `total` is
 * everyone who reacted; `other` is reactions in a word this page doesn't
 * offer, counted but not named.
 */
export function tallyReactions(standing) {
  const tally = { total: 0, other: 0 };
  for (const r of REACTIONS) tally[r.key] = 0;
  for (const reaction of standing || []) {
    tally.total += 1;
    const known = reactionFor(reaction?.value?.reaction);
    if (known) tally[known.key] += 1;
    else tally.other += 1;
  }
  return tally;
}

/**
 * A tally in words: "4 more of this · 2 curious". Verdicts nobody chose are
 * left out, and with no reactions at all it is ''.
 */
export function tallyLine(tally) {
  if (!tally?.total) return '';
  const parts = REACTIONS.filter((r) => tally[r.key] > 0).map((r) => `${tally[r.key]} ${r.tally}`);
  if (tally.other > 0) parts.push(`${tally.other} other`);
  return parts.join(' · ');
}

/** "1 reaction", "12 reactions", or '' for none. */
export function reactionCountLabel(total) {
  if (!total) return '';
  return `${total.toLocaleString('en-US')} ${total === 1 ? 'reaction' : 'reactions'}`;
}

/** The standing reactions that came with a note, newest first. */
export function reactionNotes(standing) {
  return (standing || []).filter((r) => String(r?.value?.text || '').trim());
}

/* ── the reactor's session ────────────────────────────────────────────────── */

/**
 * Does an OAuth grant's scope let its holder write a reaction? The owner's
 * broad scope does; so does the granular one for the reaction collection, in
 * any of the spellings an authorization server may echo it back in.
 *
 * A visitor who signed the guestbook before /experimenting existed holds a
 * session that can write guestbook entries and nothing else. Asking first
 * means they are sent to approve the one new permission, instead of having a
 * write refused and reading it as the site being broken.
 */
export function scopeAllowsReaction(scope) {
  return scopeAllowsCollection(scope, EXPERIMENT_REACTION_NSID);
}

/**
 * The same question for any collection: does this grant let its holder write
 * records of `nsid` to their own repo?
 */
export function scopeAllowsCollection(scope, nsid) {
  const tokens = String(scope || '').split(/\s+/).filter(Boolean);
  return tokens.some((t) => {
    if (t === 'transition:generic') return true;
    if (!t.startsWith('repo:') && !t.startsWith('repo?')) return false;
    const [head, query = ''] = t.split('?');
    const named = head.slice('repo:'.length);
    const collections = [
      ...(named ? [named] : []),
      ...new URLSearchParams(query).getAll('collection'),
    ];
    return collections.some((c) => c === '*' || c === nsid);
  });
}

/* ── a reaction that has to wait for a sign-in ────────────────────────────── */

/** Where a reaction waits while its author is away approving it on their PDS. */
export const PENDING_REACTION_KEY = 'dame.experiment.pending';

// How long a waiting reaction is good for. The hop to a PDS and back takes a
// minute; one found hours later belongs to a sign-in that was abandoned, and
// must not fire on whatever that tab does next.
const PENDING_MAX_AGE_MS = 15 * 60_000;

function storage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Keep `{ subject, reaction, text }` for the return from the PDS. */
export function savePendingReaction({ subject, reaction, text = '' } = {}, now = Date.now()) {
  if (!subject || !reaction) return;
  try {
    storage()?.setItem(
      PENDING_REACTION_KEY,
      JSON.stringify({ subject, reaction, text: String(text || ''), at: now }),
    );
  } catch {
    // Storage blocked (a private window): the reaction just won't survive the hop.
  }
}

/** The waiting reaction, or null when there is none or it has gone stale. */
export function readPendingReaction(now = Date.now()) {
  try {
    const raw = storage()?.getItem(PENDING_REACTION_KEY);
    if (!raw) return null;
    return parsePendingReaction(raw, now);
  } catch {
    return null;
  }
}

/** What a stored string says is waiting, or null. Split out so it can be tested. */
export function parsePendingReaction(raw, now = Date.now()) {
  let pending;
  try {
    pending = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!pending || typeof pending !== 'object') return null;
  const subject = String(pending.subject || '');
  const reaction = String(pending.reaction || '');
  if (!subject.startsWith(`at://${ME_DID}/${EXPERIMENT_NSID}/`) || !reaction) return null;
  const at = Number(pending.at);
  if (!Number.isFinite(at) || now - at > PENDING_MAX_AGE_MS || at - now > 60_000) return null;
  return { subject, reaction, text: String(pending.text || '') };
}

export function clearPendingReaction() {
  try {
    storage()?.removeItem(PENDING_REACTION_KEY);
  } catch {
    // Nothing was stored, then.
  }
}
