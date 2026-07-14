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
import {
  APPVIEW,
  ME_DID,
  GUESTBOOK_NSID,
  GUESTBOOK_ENTRY_NSID,
  GUESTBOOK_SUBJECT,
} from '../config.js';

/** Constellation source tuple: which records/fields point at the book. */
export const GUESTBOOK_SOURCE = `${GUESTBOOK_ENTRY_NSID}:subject`;

/** Page size for the entries list. Also the Constellation page size. */
export const GUESTBOOK_PAGE_SIZE = 25;

// --- reading -----------------------------------------------------------------

/**
 * The book record itself (`is.dame.guestbook/self` on my repo) — Slingshot
 * first, direct PDS fallback. Returns `{ uri, cid, value }` or `null` when
 * the book hasn't been opened yet (entries still work; the book is mostly a
 * backlink target). The `hidden` list on it drives moderation.
 */
export async function fetchGuestbookBook() {
  const parts = { repo: ME_DID, collection: GUESTBOOK_NSID, rkey: 'self' };
  const cached = await getRecordCached(parts);
  if (cached) return cached;
  try {
    const pds = await resolvePds(ME_DID);
    return await getRecord(pds, parts);
  } catch {
    return null;
  }
}

/**
 * One page of the book.
 *
 * Returns `{ total, publicTotal, hiddenCount, cursor, entries, book }` where
 * each entry is `{ uri, did, rkey, value, profile, hidden }` (profile may be
 * null), newest first. `hidden` reflects the book's moderation list; callers
 * decide whether to render hidden entries (the public page filters them, the
 * moderation surfaces show them dimmed). `publicTotal` is the backlink total
 * minus the hidden list, for the public signature count.
 * Returns `null` only when Constellation itself is unreachable; signatures
 * whose records can't be hydrated (deleted, PDS down) are dropped from the
 * page rather than failing it.
 */
export async function fetchGuestbookEntries({ limit = GUESTBOOK_PAGE_SIZE, cursor } = {}) {
  const [page, book] = await Promise.all([
    getBacklinks(GUESTBOOK_SUBJECT, GUESTBOOK_SOURCE, { limit, cursor }),
    fetchGuestbookBook(),
  ]);
  if (!page) return null;
  const refs = Array.isArray(page.records) ? page.records : [];
  const hiddenUris = new Set(book?.value?.hidden || []);

  const hydrated = await Promise.all(refs.map(hydrateEntry));
  const entries = hydrated.filter(Boolean);
  for (const entry of entries) {
    entry.hidden = hiddenUris.has(entry.uri);
  }

  const profiles = await fetchProfiles(entries.map((e) => e.did));
  for (const entry of entries) {
    entry.profile = profiles.get(entry.did) || null;
  }

  const total = page.total ?? null;
  return {
    total,
    // Approximate when a hidden record has since been deleted by its signer
    // (the backlink drops out of `total` but its uri lingers in the list);
    // close enough for a count caption.
    publicTotal: total != null ? Math.max(0, total - hiddenUris.size) : null,
    hiddenCount: hiddenUris.size,
    cursor: page.cursor || null,
    entries,
    book,
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
    throw new Error('Write a note first.');
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

// --- coarse location ("signing from") ------------------------------------------

/**
 * Ask the browser for location and resolve it to a coarse, town-free label —
 * "North Carolina, United States", "Bavaria, Germany", or just a country.
 * Privacy posture, matching the site's no-location rule elsewhere:
 *   - runs only on an explicit click; the browser permission prompt is the consent,
 *   - coordinates are blurred to ~11 km before they leave the device,
 *   - only state/region + country are kept — never a town, city, or coordinates,
 *   - the label lands in the form input for review; nothing auto-submits.
 * Reverse geocoding via BigDataCloud's free client endpoint (keyless, CORS).
 */
export async function detectCoarseRegion() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('Location is not available in this browser.');
  }
  const pos = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => {
        reject(
          new Error(
            err?.code === 1
              ? 'Location permission was declined.'
              : 'Could not read your location.',
          ),
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  });
  const lat = Math.round(pos.coords.latitude * 10) / 10;
  const lon = Math.round(pos.coords.longitude * 10) / 10;
  const res = await fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
  );
  if (!res.ok) throw new Error('Could not look up a region.');
  const data = await res.json();
  const region = String(data?.principalSubdivision || '').trim();
  // Country: prefer the tidy Intl name for the ISO code over the endpoint's
  // formal styling ("United States of America (the)").
  let country = '';
  const code = String(data?.countryCode || '').trim();
  if (code) {
    try {
      country = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || '';
    } catch {
      // Intl.DisplayNames missing — fall through to countryName.
    }
  }
  if (!country || country === code) {
    country = String(data?.countryName || '').replace(/\s*\(the\)\s*$/i, '').trim();
  }
  const parts = [region, country].filter(Boolean);
  if (parts.length === 0) throw new Error('Could not resolve a region.');
  return parts.join(', ');
}

// --- moderation (host only) ---------------------------------------------------

/**
 * Hide or unhide a signature from public display by editing the book's
 * `hidden` list. The signer's record is untouched — this is curation, not
 * deletion. Only the host's agent can do this (the PDS rejects writes to a
 * repo you don't own). Uses a CID swap so two moderation clicks racing each
 * other fail loudly instead of silently dropping one.
 *
 * If the book record doesn't exist yet (someone signed before
 * scripts/create-guestbook.mjs ran), it's created on the spot with default
 * chrome so the hide isn't lost.
 */
export async function setEntryHidden(agent, entryUri, hide) {
  if (!agent) throw new Error('Sign in first.');
  const repo = agent.assertDid;
  const now = new Date().toISOString();

  let existing = null;
  try {
    existing = await agent.com.atproto.repo.getRecord({
      repo,
      collection: GUESTBOOK_NSID,
      rkey: 'self',
    });
  } catch {
    // No book yet — fall through to creating one.
  }

  const value = existing?.data?.value || {
    $type: GUESTBOOK_NSID,
    title: 'guestbook',
    createdAt: now,
  };
  const hidden = new Set(Array.isArray(value.hidden) ? value.hidden : []);
  if (hide) hidden.add(entryUri);
  else hidden.delete(entryUri);

  const record = { ...value, updatedAt: now };
  if (hidden.size > 0) record.hidden = [...hidden];
  else delete record.hidden;

  await agent.com.atproto.repo.putRecord({
    repo,
    collection: GUESTBOOK_NSID,
    rkey: 'self',
    record,
    ...(existing?.data?.cid ? { swapRecord: existing.data.cid } : {}),
  });
}
