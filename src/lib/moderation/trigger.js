// Does this firehose event mean "analyst, look at this"?
//
// Pure, and deliberately so. This function IS the security boundary for the
// public path — everything downstream of a `true` here posts to the network
// under the moderator account's name — and a boundary you cannot exercise in a
// test is a boundary you are hoping about. `nextAction` in precompute.js is
// already the cautionary tale for leaving a decision like this inline.
//
// TWO INDEPENDENT AUTHOR CHECKS, on purpose. The consumer subscribes to
// Jetstream with `dids=[owner]`, so in normal operation only dame's own posts
// ever arrive — but that filter is a bandwidth decision made by the transport,
// and a dropped query parameter, a proxy that rewrites the URL, or someone
// widening the subscription to debug something would silently turn "only dame
// is answered" off. So the author is checked again here, where it is a rule
// rather than an optimisation.
//
// Note what is NOT a trigger: anyone else mentioning the bot. The bot is
// mentionable by the whole network, and the analyst reads its input as
// instructions, so a stranger's mention is discarded without a reply — not even
// an error, which would itself be a reply.

import { looksLikeTarget } from './target.js';

const MENTION = 'app.bsky.richtext.facet#mention';
const LINK = 'app.bsky.richtext.facet#link';

/** The DID in `at://did:plc:xxx/collection/rkey`, or null. */
export function authorOf(uri) {
  const m = /^at:\/\/(did:[^/]+)\//.exec(String(uri ?? ''));
  return m ? m[1] : null;
}

/** The quoted post's URI, across both embed shapes that can carry one. */
export function quotedUri(record) {
  const embed = record?.embed;
  if (!embed) return null;
  if (embed.$type === 'app.bsky.embed.record') return embed.record?.uri ?? null;
  if (embed.$type === 'app.bsky.embed.recordWithMedia') {
    return embed.record?.record?.uri ?? null;
  }
  return null;
}

/**
 * Every post reference the message points at, best candidate first.
 *
 * Facet links come before text tokens because the client TRUNCATES the visible
 * text of a pasted URL — `bsky.app/profile/dame.is/pos...` is what the record
 * says and the whole URI is only in the facet. Reading the text alone finds a
 * mangled link or none at all, which looks exactly like "dame didn't paste one".
 */
export function linkCandidates(record) {
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const s = String(v ?? '').trim();
    if (!s || seen.has(s) || !looksLikeTarget(s)) return;
    seen.add(s);
    out.push(s);
  };

  for (const facet of record?.facets || []) {
    for (const feature of facet?.features || []) {
      if (feature?.$type === LINK) push(feature.uri);
    }
  }
  for (const token of String(record?.text ?? '').split(/\s+/)) {
    push(token.replace(/[),.]+$/, ''));
  }
  return out;
}

/** True when any facet mentions `did`. */
export function mentions(record, did) {
  for (const facet of record?.facets || []) {
    for (const feature of facet?.features || []) {
      if (feature?.$type === MENTION && feature.did === did) return true;
    }
  }
  return false;
}

/**
 * Classify one Jetstream commit event.
 *
 * @param {object} event  a Jetstream commit envelope
 * @param {object} opts
 * @param {string} opts.ownerDid  the only account whose posts are answered
 * @param {string} opts.botDid    the moderator account
 * @returns {{
 *   trigger: boolean,
 *   reason: string,
 *   uri?: string,
 *   cid?: string,
 *   text?: string,
 *   target?: string|null,
 *   targetSource?: 'link'|'quote'|'parent'|null,
 *   reply?: { root: {uri:string,cid:string}, parent: {uri:string,cid:string} },
 *   isFollowUp?: boolean,
 * }}
 */
export function classify(event, { ownerDid, botDid }) {
  if (event?.kind !== 'commit')
    return { trigger: false, reason: 'not-a-commit' };

  const commit = event.commit || {};
  if (commit.collection !== 'app.bsky.feed.post') {
    return { trigger: false, reason: 'wrong-collection' };
  }
  // Only creates. An edit of an old post would otherwise re-trigger the whole
  // analysis, and a delete carries no record to read at all.
  if (commit.operation !== 'create') {
    return { trigger: false, reason: 'not-a-create' };
  }
  if (event.did !== ownerDid) {
    return { trigger: false, reason: 'not-the-owner' };
  }

  const record = commit.record || {};
  if (typeof record.text !== 'string') {
    return { trigger: false, reason: 'no-text' };
  }

  const parentUri = record.reply?.parent?.uri ?? null;
  const quoted = quotedUri(record);

  const addressed =
    mentions(record, botDid) ||
    authorOf(parentUri) === botDid ||
    authorOf(quoted) === botDid;
  if (!addressed) return { trigger: false, reason: 'not-addressed-to-the-bot' };

  const uri = `at://${event.did}/${commit.collection}/${commit.rkey}`;
  const self = { uri, cid: commit.cid };

  // What to analyse, best evidence first. A pasted link is an explicit request.
  // Failing that, the post dame is quoting or replying to is the thing in front
  // of her — unless it is the bot's own post, which is a follow-up in an
  // existing conversation rather than a new subject.
  let target = null;
  let targetSource = null;
  const [link] = linkCandidates(record);
  if (link) {
    target = link;
    targetSource = 'link';
  } else if (quoted && authorOf(quoted) !== botDid) {
    target = quoted;
    targetSource = 'quote';
  } else if (parentUri && authorOf(parentUri) !== botDid) {
    target = parentUri;
    targetSource = 'parent';
  }

  return {
    trigger: true,
    reason: 'addressed',
    uri,
    cid: commit.cid,
    text: record.text,
    target,
    targetSource,
    // Threaded under the same root, so the answer lands where the question was
    // asked rather than starting a new top-level post about someone.
    reply: {
      root: record.reply?.root ?? self,
      parent: self,
    },
    isFollowUp: authorOf(parentUri) === botDid,
  };
}
