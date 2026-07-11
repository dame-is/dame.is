// Guestbook assembly + signing.
//
// The guestbook has no database: visitors write an `is.dame.guestbook.entry`
// record on their OWN repo pointing at the book singleton on mine, and this
// module rebuilds the book at read time —
//
//   Constellation (who signed?)  →  Slingshot (what did they write?)
//                                →  AppView   (who are they, visually?)
//
// Falls back to a direct DID-doc + PDS fetch per record when Slingshot is
// unavailable. See lexicons/GUESTBOOK.md for the full design.

import { getBacklinks } from './constellation.js';
import { getRecordCached } from './slingshot.js';
import { resolvePds, getRecord, toAtUri } from './atproto.js';
import { APPVIEW, GUESTBOOK_ENTRY_NSID, GUESTBOOK_SUBJECT } from '../config.js';

/** Constellation source tuple: which records/fields point at the book. */
export const GUESTBOOK_SOURCE = `${GUESTBOOK_ENTRY_NSID}:subject`;

/** Page size for the entries list. Also the Constellation page size. */
export const GUESTBOOK_PAGE_SIZE = 25;

// --- reading -----------------------------------------------------------------

/**
 * One page of the book.
 *
 * Returns `{ total, cursor, entries }` where each entry is
 * `{ uri, did, rkey, value, profile }` (profile may be null), newest first.
 * Returns `null` only when Constellation itself is unreachable; signatures
 * whose records can't be hydrated (deleted, PDS down) are dropped from the
 * page rather than failing it.
 */
export async function fetchGuestbookEntries({ limit = GUESTBOOK_PAGE_SIZE, cursor } = {}) {
  const page = await getBacklinks(GUESTBOOK_SUBJECT, GUESTBOOK_SOURCE, { limit, cursor });
  if (!page) return null;
  const refs = Array.isArray(page.records) ? page.records : [];

  const hydrated = await Promise.all(refs.map(hydrateEntry));
  const entries = hydrated.filter(Boolean);

  const profiles = await fetchProfiles(entries.map((e) => e.did));
  for (const entry of entries) {
    entry.profile = profiles.get(entry.did) || null;
  }

  return {
    total: page.total ?? null,
    cursor: page.cursor || null,
    entries,
  };
}

/**
 * Hydrate one Constellation ref (`{did, collection, rkey}`) into an entry.
 * Slingshot first; on a miss, resolve the signer's PDS and fetch directly.
 * Returns `null` when the record is gone or malformed.
 */
async function hydrateEntry(ref) {
  const { did, collection, rkey } = ref || {};
  if (!did || !collection || !rkey) return null;

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
  // Belt-and-braces: Constellation already filtered on subject, but a
  // record may have been rewritten to point elsewhere since indexing.
  if (!value || value.subject !== GUESTBOOK_SUBJECT) return null;

  return {
    uri: record.uri || toAtUri({ did, collection, rkey }),
    did,
    rkey,
    value,
    profile: null,
  };
}

/**
 * Batch-resolve signer profiles from the public AppView
 * (`app.bsky.actor.getProfiles`, 25 actors per call). Best-effort: a failed
 * batch just leaves those signers rendering by DID. Returns Map<did, profile>.
 */
async function fetchProfiles(dids) {
  const unique = [...new Set(dids.filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < unique.length; i += 25) {
    const chunk = unique.slice(i, i + 25);
    const params = new URLSearchParams();
    for (const did of chunk) params.append('actors', did);
    try {
      const res = await fetch(`${APPVIEW}/xrpc/app.bsky.actor.getProfiles?${params}`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const profile of data?.profiles || []) {
        if (profile?.did) out.set(profile.did, profile);
      }
    } catch {
      // leave this chunk unresolved
    }
  }
  return out;
}

// --- writing -----------------------------------------------------------------

/** Grapheme limits mirrored from lexicons/is.dame.guestbook.entry.json. */
export const ENTRY_TEXT_MAX_GRAPHEMES = 300;
export const ENTRY_NAME_MAX_GRAPHEMES = 64;

/**
 * Count user-perceived characters, so an emoji signature isn't over-charged.
 * Falls back to code points where Intl.Segmenter is missing.
 */
export function graphemeLength(s) {
  const str = String(s || '');
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    let n = 0;
    for (const _ of new Intl.Segmenter().segment(str)) n += 1;
    return n;
  }
  return [...str].length;
}

/**
 * Sign the book: create an `is.dame.guestbook.entry` on the signer's repo
 * (the PDS mints the TID rkey). At least one of `text` / `mark` must be
 * present — an empty signature says nothing, not even "I was here".
 * Returns `{ uri, cid, value }` for optimistic rendering.
 */
export async function signGuestbook(agent, { text, signature, mark, location } = {}) {
  if (!agent) throw new Error('Sign in to sign the guestbook.');
  const cleanText = String(text || '').trim();
  const cleanName = String(signature || '').trim();
  const cleanMark = String(mark || '').trim();
  const cleanLocation = String(location || '').trim();
  if (!cleanText && !cleanMark) {
    throw new Error('Write a note or pick a mark first.');
  }
  if (graphemeLength(cleanText) > ENTRY_TEXT_MAX_GRAPHEMES) {
    throw new Error(`Notes max out at ${ENTRY_TEXT_MAX_GRAPHEMES} characters.`);
  }
  if (graphemeLength(cleanName) > ENTRY_NAME_MAX_GRAPHEMES) {
    throw new Error(`Signatures max out at ${ENTRY_NAME_MAX_GRAPHEMES} characters.`);
  }
  if (cleanMark && graphemeLength(cleanMark) > 1) {
    throw new Error('A mark is a single character.');
  }

  const value = {
    $type: GUESTBOOK_ENTRY_NSID,
    subject: GUESTBOOK_SUBJECT,
    createdAt: new Date().toISOString(),
  };
  if (cleanText) value.text = cleanText;
  if (cleanName) value.signature = cleanName;
  if (cleanMark) value.mark = cleanMark;
  if (cleanLocation) value.location = cleanLocation;

  const did = agent.assertDid;
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: GUESTBOOK_ENTRY_NSID,
    record: value,
  });
  return { uri: res.data.uri, cid: res.data.cid, value };
}

/**
 * Remove one of the signer's own entries. Their record, their eraser —
 * Constellation drops the backlink once the delete propagates.
 */
export async function deleteGuestbookEntry(agent, rkey) {
  if (!agent) throw new Error('Sign in first.');
  await agent.com.atproto.repo.deleteRecord({
    repo: agent.assertDid,
    collection: GUESTBOOK_ENTRY_NSID,
    rkey,
  });
}
