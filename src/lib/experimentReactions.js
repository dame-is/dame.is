// /experimenting over the network: reading the experiments off my repo,
// gathering the reactions to them, and writing a visitor's own.
//
// Reactions have no database. A visitor writes an `is.dame.experiment.reaction`
// record on their OWN repo whose `subject` is the experiment, and this module
// puts them back together at read time, the way lib/guestbook.js does the book:
//
//   Constellation (who reacted?)  →  Slingshot (what did they say?)
//                                 →  AppView   (who are they, visually?)
//
// What they add up to (one per person, the tally, the notes) is worked out in
// lib/experiments.js, which has no network in it.

import { getBacklinks, backlinkRows } from './constellation.js';
import { getRecordCached } from './slingshot.js';
import { hasProfanity } from './profanity.js';
import { graphemeLength, isXrpcRecordNotFound } from './guestbook.js';
import {
  resolvePds,
  getRecord,
  listRecords,
  resolveProfiles,
  isRecordNotFound,
  toAtUri,
  rkeyFromAtUri,
} from './atproto.js';
import { annotateBlobUrl, annotateLeafletBlobs } from './feedBuilder.js';
import {
  REACTION_SOURCE,
  REACTION_TEXT_MAX_GRAPHEMES,
  experimentUri,
  reactionFor,
  scopeAllowsReaction,
} from './experiments.js';
import { ME_DID, EXPERIMENT_NSID, EXPERIMENT_REACTION_NSID } from '../config.js';

/* ── the experiments ──────────────────────────────────────────────────────── */

/** How many experiments a page reads. The collection is small by nature. */
const EXPERIMENTS_MAX = 200;

/**
 * Bake display URLs onto an experiment's blobs (its picture, and any images in
 * its write-up), as the feed builder does for the documents it reads. Mutates
 * the records it is given, which are always ones this module just fetched.
 */
export function annotateExperiments(records, pds, did = ME_DID) {
  for (const r of records || []) {
    const v = r?.value;
    if (!v) continue;
    annotateBlobUrl(v.image, pds, did);
    if (v.content) annotateLeafletBlobs(v.content, pds, did);
  }
  return records;
}

/** Every experiment record on my repo, drafts included, in the PDS's order. */
export async function fetchExperimentRecords({ pds } = {}) {
  const host = pds || (await resolvePds(ME_DID));
  const records = await listRecords(host, {
    repo: ME_DID,
    collection: EXPERIMENT_NSID,
    max: EXPERIMENTS_MAX,
  });
  return annotateExperiments(records, host);
}

/**
 * One experiment by record key, or null when the PDS says there is no such
 * record. Anything else (a timeout, a 5xx) throws, so a page can keep what it
 * already has rather than calling a slow PDS "not found".
 */
export async function fetchExperimentRecord(rkey, { pds } = {}) {
  const host = pds || (await resolvePds(ME_DID));
  try {
    const record = await getRecord(host, { repo: ME_DID, collection: EXPERIMENT_NSID, rkey });
    if (!record?.value) return null;
    annotateExperiments([record], host);
    return record;
  } catch (err) {
    if (isRecordNotFound(err)) return null;
    throw err;
  }
}

/* ── reading reactions ────────────────────────────────────────────────────── */

/** Constellation's page size for a reactions walk. */
const REACTION_PAGE = 100;

/**
 * The most reactions read for one experiment. Past this the tally says it is
 * a floor ("300+"), which for a quick concept on a personal site is a good
 * problem to have.
 */
export const REACTIONS_MAX = 300;

/** How many reaction records are fetched at once. */
const HYDRATE_AT_ONCE = 12;

/** The three profile fields a reaction's line shows. */
function leanProfile(did, profile) {
  if (!profile) return null;
  return {
    did,
    handle: profile.handle || '',
    displayName: profile.displayName || '',
    avatar: profile.avatar || '',
  };
}

/** Run `task` over `items`, at most `limit` at a time, keeping their order. */
async function mapPooled(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await task(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * A reaction as the pages hold it, from a record and where it was found:
 * `{ uri, cid, did, rkey, value: { subject, reaction, text?, createdAt? },
 * profile, flagged }`. `flagged` marks a note the language filter trips; the
 * verdict still counts, the note isn't shown (see ExperimentReactions).
 */
export function toReaction({ did, rkey, uri = null, cid = null, value }) {
  if (!did || !rkey || !value) return null;
  const reaction = String(value.reaction || '').trim();
  if (!reaction) return null;
  const text = String(value.text || '').trim();
  const lean = { subject: String(value.subject || ''), reaction };
  if (text) lean.text = text;
  if (value.createdAt) lean.createdAt = value.createdAt;
  return {
    uri: uri || toAtUri({ did, collection: EXPERIMENT_REACTION_NSID, rkey }),
    cid: cid ?? null,
    did,
    rkey,
    value: lean,
    profile: null,
    flagged: Boolean(text) && hasProfanity(text),
  };
}

/**
 * Fetch the record behind one Constellation ref: Slingshot first, the
 * reactor's own PDS on a miss. Null when it is gone, or no longer points at
 * `subject` (it may have been rewritten since it was indexed).
 */
async function hydrateRef(ref, subject) {
  const { did, collection, rkey } = ref || {};
  if (!did || !rkey || collection !== EXPERIMENT_REACTION_NSID) return null;
  let record = await getRecordCached({ repo: did, collection, rkey });
  if (!record) {
    try {
      const pds = await resolvePds(did);
      record = await getRecord(pds, { repo: did, collection, rkey });
    } catch {
      return null;
    }
  }
  const value = record?.value;
  if (!value || value.subject !== subject) return null;
  return toReaction({ did, rkey, uri: record.uri, cid: record.cid, value });
}

/**
 * Everyone's reactions to one experiment: `{ reactions, total, truncated }`,
 * every record found (more than one per person if they wrote more; see
 * standingReactions in lib/experiments.js for what counts). Null only when the
 * backlink index can't be reached at all.
 *
 * `known` is reactions already in hand, from the build's snapshot or an
 * earlier read. A reaction record is written once and replaced rather than
 * edited, so one whose at-uri is known is taken as read and not fetched again:
 * a visit then costs one backlinks request per experiment, plus a record fetch
 * for each reaction left since.
 */
export async function fetchReactions(subject, { known = [], max = REACTIONS_MAX, signal } = {}) {
  if (!subject) return null;
  const refs = [];
  let total = null;
  let cursor;
  let truncated = false;
  do {
    const page = await getBacklinks(subject, REACTION_SOURCE, {
      limit: REACTION_PAGE,
      cursor,
      signal,
    });
    if (!page) {
      // The first page failing is the index being down. A later one failing
      // leaves a partial list, which is still better than none.
      if (refs.length === 0) return null;
      truncated = true;
      break;
    }
    refs.push(...backlinkRows(page));
    if (typeof page.total === 'number') total = page.total;
    cursor = page.cursor || null;
  } while (cursor && refs.length < max);
  if (cursor) truncated = true;

  const knownByUri = new Map((known || []).filter((r) => r?.uri).map((r) => [r.uri, r]));
  const hydrated = await mapPooled(refs.slice(0, max), HYDRATE_AT_ONCE, (ref) => {
    const held = knownByUri.get(toAtUri(ref));
    // Copied, never handed back as-is: a snapshot's objects are shared by
    // every reader of that file.
    return held ? { ...held } : hydrateRef(ref, subject);
  });
  const reactions = hydrated.filter(Boolean);

  const faceless = reactions.filter((r) => !r.profile).map((r) => r.did);
  if (faceless.length) {
    const profiles = await resolveProfiles(faceless).catch(() => ({}));
    for (const r of reactions) {
      if (!r.profile) r.profile = leanProfile(r.did, profiles[r.did]);
    }
  }
  return { reactions, total: total ?? reactions.length, truncated };
}

/**
 * The signed-in visitor's own reactions, read straight off their repo:
 * a Map of experiment at-uri → their reactions to it, newest first.
 *
 * Their repo is the truth about what they said, and it answers at once; the
 * backlink index can trail a write or a delete by a few seconds, which on a
 * page whose buttons say "you chose this" is long enough to be wrong.
 */
export async function fetchMyReactions(did) {
  const mine = new Map();
  if (!did) return mine;
  const pds = await resolvePds(did);
  const records = await listRecords(pds, {
    repo: did,
    collection: EXPERIMENT_REACTION_NSID,
    max: REACTIONS_MAX,
  });
  for (const record of records) {
    const reaction = toReaction({
      did,
      rkey: rkeyFromAtUri(record?.uri),
      uri: record?.uri,
      cid: record?.cid,
      value: record?.value,
    });
    const subject = reaction?.value.subject;
    if (!subject) continue;
    if (!mine.has(subject)) mine.set(subject, []);
    mine.get(subject).push(reaction);
  }
  // listRecords is newest first already; a TID key sorts the same way, and
  // this doesn't depend on which the PDS chose.
  for (const list of mine.values()) list.sort((a, b) => (a.rkey < b.rkey ? 1 : -1));
  return mine;
}

/* ── writing a reaction ───────────────────────────────────────────────────── */

/**
 * Whether this OAuth session's grant covers writing a reaction. True when it
 * can't be told (an older client, a network hiccup): the write itself is then
 * the test, and `isScopeError` reads its refusal.
 */
export async function sessionCanReact(session) {
  if (!session) return false;
  try {
    const info = await session.getTokenInfo();
    if (!info?.scope) return true;
    return scopeAllowsReaction(info.scope);
  } catch {
    return true;
  }
}

/** Did a write fail because the session's grant doesn't cover it? */
export function isScopeError(err) {
  const code = String(err?.error || err?.data?.error || '');
  const message = String(err?.message || '');
  if (/scope/i.test(code) || /scope/i.test(message)) return true;
  return err?.status === 403 && /permission|forbidden|not allowed/i.test(`${code} ${message}`);
}

/**
 * React to an experiment: create an `is.dame.experiment.reaction` on the
 * reactor's repo (the PDS mints its TID key), then delete the reactions it
 * replaces. Created first, so a failed write leaves the old one standing; and
 * a delete that fails afterwards is no harm, since only a person's newest
 * reaction counts.
 *
 * Returns the new reaction in the shape the pages hold, for showing at once.
 */
export async function writeReaction(agent, { subject, reaction, text = '', replace = [] } = {}) {
  if (!agent) throw new Error('Sign in to react.');
  const verdict = String(reaction || '').trim();
  if (!reactionFor(verdict)) throw new Error('Pick a reaction first.');
  if (!String(subject || '').startsWith(`at://${ME_DID}/${EXPERIMENT_NSID}/`)) {
    throw new Error('That isn’t an experiment.');
  }
  const note = String(text || '').trim();
  if (graphemeLength(note) > REACTION_TEXT_MAX_GRAPHEMES) {
    throw new Error(`Notes max out at ${REACTION_TEXT_MAX_GRAPHEMES} characters.`);
  }

  const value = {
    $type: EXPERIMENT_REACTION_NSID,
    subject,
    reaction: verdict,
    createdAt: new Date().toISOString(),
  };
  if (note) value.text = note;

  const did = agent.assertDid;
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: EXPERIMENT_REACTION_NSID,
    record: value,
  });
  const uri = res.data.uri;
  const rkey = rkeyFromAtUri(uri);
  for (const old of replace || []) {
    if (!old || old === rkey) continue;
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: EXPERIMENT_REACTION_NSID,
        rkey: old,
      });
    } catch {
      // The newer record wins at read time either way.
    }
  }
  return toReaction({ did, rkey, uri, cid: res.data.cid, value });
}

/** Take back one's own reactions to an experiment: every record named. */
export async function deleteReactions(agent, rkeys) {
  if (!agent) throw new Error('Sign in first.');
  for (const rkey of rkeys || []) {
    if (!rkey) continue;
    await agent.com.atproto.repo.deleteRecord({
      repo: agent.assertDid,
      collection: EXPERIMENT_REACTION_NSID,
      rkey,
    });
  }
}

/* ── moderation (host only) ───────────────────────────────────────────────── */

/**
 * Hide or unhide a reaction by editing the experiment's `hidden` list. The
 * reactor's record is untouched (it is theirs); this only decides whether the
 * page counts and shows it. Only the host's agent can write it, and the write
 * is a compare-and-swap on the record's CID, so two edits racing each other
 * fail loudly instead of one silently undoing the other. A record that can't
 * be read is never written over.
 */
export async function setReactionHidden(agent, experimentRkey, reactionUri, hide) {
  if (!agent) throw new Error('Sign in first.');
  if (!experimentRkey || !reactionUri) throw new Error('Nothing to hide.');
  const repo = agent.assertDid;
  let existing;
  try {
    existing = await agent.com.atproto.repo.getRecord({
      repo,
      collection: EXPERIMENT_NSID,
      rkey: experimentRkey,
    });
  } catch (err) {
    if (isXrpcRecordNotFound(err)) throw new Error('That experiment no longer exists.');
    throw err;
  }
  const value = existing?.data?.value;
  if (!value) throw new Error('That experiment no longer exists.');

  const hidden = new Set(Array.isArray(value.hidden) ? value.hidden : []);
  if (hide) hidden.add(reactionUri);
  else hidden.delete(reactionUri);
  const record = { ...value };
  if (hidden.size > 0) record.hidden = [...hidden];
  else delete record.hidden;

  await agent.com.atproto.repo.putRecord({
    repo,
    collection: EXPERIMENT_NSID,
    rkey: experimentRkey,
    record,
    swapRecord: existing.data.cid,
  });
  return [...hidden];
}

/** The experiment a reaction's subject names, as a record key; null if not one. */
export function experimentRkeyOf(subject) {
  const rkey = rkeyFromAtUri(subject);
  return rkey && subject === experimentUri(rkey) ? rkey : null;
}
