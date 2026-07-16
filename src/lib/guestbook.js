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

import { getBacklinks, getBacklinkCount } from './constellation.js';
import { getRecordCached } from './slingshot.js';
import { hasProfanity } from './profanity.js';
import { resolvePds, getRecord, toAtUri, tidToTimestamp } from './atproto.js';
import { compareIsoDesc } from './time.js';
import {
  APPVIEW,
  ME_DID,
  GUESTBOOK_NSID,
  GUESTBOOK_ENTRY_NSID,
  GUESTBOOK_SUBJECT,
  LEGACY_GUESTBOOK_ENTRY_NSID,
  LEGACY_GUESTBOOK_SUBJECT,
} from '../config.js';

/** Constellation source tuple: which records/fields point at the book. */
export const GUESTBOOK_SOURCE = `${GUESTBOOK_ENTRY_NSID}:subject`;

/**
 * Constellation source for the retired "lofi" guestbook. Its signatures are
 * `a.guestbook.i.signed` records that link the old book through a `guestbook`
 * field (not `subject`). The book is closed, so this source only ever shrinks.
 */
export const LEGACY_GUESTBOOK_SOURCE = `${LEGACY_GUESTBOOK_ENTRY_NSID}:guestbook`;

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
 * One page of the book, newest first.
 *
 * Two backlink sources feed the book: the current `is.dame.guestbook.entry`
 * records and the retired `a.guestbook.i.signed` ones (the old "lofi" book).
 * The modern source paginates through Constellation as usual; the legacy book
 * is a small *closed* set, so once the modern pages run out its signatures are
 * loaded in one shot and merged onto the tail. Because every legacy signature
 * predates the modern book, "modern pages, then the legacy tail" is already
 * chronological — no cross-source interleaving is needed. The compound `cursor`
 * that threads this two-phase walk is opaque to callers (they pass it back).
 *
 * Returns `{ total, publicTotal, hiddenCount, flaggedCount, cursor, entries, book }`
 * where each entry is
 * `{ uri, cid, did, rkey, collection, legacy, value, profile, hidden, flagged }`,
 * newest first. `value` is normalized so both record shapes render through one
 * row (a legacy `message` surfaces as `text`, and a missing `createdAt` is
 * recovered from the TID rkey where possible). `hidden` reflects the book's
 * moderation list — which may name legacy at-uris too, so hiding spans both
 * books. `flagged` marks a signature the language filter auto-hides from public
 * display (see src/lib/profanity.js); `flaggedCount` is how many on this page
 * (excluding ones already hidden). Returns `null` only when the backlink index
 * is unreachable with nothing to show; individual records that can't be
 * hydrated are dropped from the page rather than failing it.
 */
export async function fetchGuestbookEntries({ limit = GUESTBOOK_PAGE_SIZE, cursor } = {}) {
  const state = decodeGuestbookCursor(cursor);
  const book = await fetchGuestbookBook();
  const hiddenUris = new Set(book?.value?.hidden || []);

  // Phase 2: the legacy tail. Reached inline once the modern pages are spent
  // (below), or as a standalone retry if the legacy index was briefly down on
  // the page that should have appended it.
  if (state?.phase === 'legacy') {
    const legacy = await fetchLegacyEntries(hiddenUris);
    if (!legacy) return null;
    return finalizePage({
      entries: sortByCreatedAt(legacy.entries),
      total: (state.modernTotal ?? 0) + legacy.total,
      hiddenUris,
      book,
      cursor: null,
    });
  }

  // Phase 1: the modern book, paginated by Constellation.
  const page = await getBacklinks(GUESTBOOK_SUBJECT, GUESTBOOK_SOURCE, {
    limit,
    cursor: state?.modernCursor,
  });
  if (!page) return null;
  const modernRefs = Array.isArray(page.records) ? page.records : [];
  const modernEntries = await hydrateEntries(modernRefs, hydrateModernRef, hiddenUris);
  const modernTotal = page.total ?? modernEntries.length;

  // Still more modern pages to come — leave the legacy book untouched for now,
  // but fold its count into the total so the signature caption is honest.
  if (page.cursor) {
    const legacyCount = await getBacklinkCount(LEGACY_GUESTBOOK_SUBJECT, LEGACY_GUESTBOOK_SOURCE);
    return finalizePage({
      entries: modernEntries,
      total: modernTotal + (legacyCount?.total ?? 0),
      hiddenUris,
      book,
      cursor: encodeGuestbookCursor({ phase: 'modern', modernCursor: page.cursor }),
    });
  }

  // Modern book exhausted — append the legacy tail on this same page.
  const legacy = await fetchLegacyEntries(hiddenUris);
  if (!legacy) {
    // Legacy index momentarily down. Hand back a legacy-phase cursor so
    // "earlier signatures" can retry the tail — unless there's nothing at all
    // to show, in which case report the index as unreachable.
    if (modernEntries.length === 0) return null;
    return finalizePage({
      entries: modernEntries,
      total: modernTotal,
      hiddenUris,
      book,
      cursor: encodeGuestbookCursor({ phase: 'legacy', modernTotal }),
    });
  }
  return finalizePage({
    entries: sortByCreatedAt([...modernEntries, ...legacy.entries]),
    total: modernTotal + legacy.total,
    hiddenUris,
    book,
    cursor: null,
  });
}

/** Assemble the public return shape shared by every page and phase. */
function finalizePage({ entries, total, hiddenUris, book, cursor }) {
  // Signatures the language filter auto-hides on THIS page (that aren't already
  // on the manual hidden list, so the two counts don't overlap). Unlike the
  // manual list — known in full from the book record — flagged entries surface
  // one page at a time as records hydrate, so a caller's running tally is exact
  // only once every page has loaded. Same best-effort spirit as the
  // hidden-but-deleted approximation below.
  const flaggedCount = entries.reduce((n, e) => n + (e.flagged && !e.hidden ? 1 : 0), 0);
  return {
    total,
    // Approximate when a hidden record has since been deleted by its signer
    // (the backlink drops out of `total` but its uri lingers in the list);
    // close enough for a count caption.
    publicTotal: total != null ? Math.max(0, total - hiddenUris.size - flaggedCount) : null,
    hiddenCount: hiddenUris.size,
    flaggedCount,
    cursor: cursor || null,
    entries,
    book,
  };
}

/**
 * Every signature on the retired legacy book, hydrated + profiled. The old
 * book is closed and tiny, so there's no legacy cursor — one Constellation
 * page (limit 100) holds every `a.guestbook.i.signed` record. Returns
 * `{ entries, total }`, or `null` if Constellation is unreachable.
 */
async function fetchLegacyEntries(hiddenUris) {
  const page = await getBacklinks(LEGACY_GUESTBOOK_SUBJECT, LEGACY_GUESTBOOK_SOURCE, { limit: 100 });
  if (!page) return null;
  const refs = Array.isArray(page.records) ? page.records : [];
  const entries = await hydrateEntries(refs, hydrateLegacyRef, hiddenUris);
  return { entries, total: page.total ?? entries.length };
}

/**
 * Hydrate a list of Constellation refs with `hydrate`, drop the misses, flag
 * the hidden ones, and attach signer profiles. Shared by both books.
 */
async function hydrateEntries(refs, hydrate, hiddenUris) {
  const hydrated = (await Promise.all(refs.map(hydrate))).filter(Boolean);
  for (const entry of hydrated) {
    entry.hidden = hiddenUris.has(entry.uri); // host-curated hidden list
    entry.flagged = entryHasProfanity(entry.value); // language filter
  }
  const profiles = await fetchProfiles(hydrated.map((e) => e.did));
  for (const entry of hydrated) entry.profile = profiles.get(entry.did) || null;
  return hydrated;
}

/**
 * Whether any of the signer's own free-text fields (the note, the sign-as
 * name, the "signing from" location) trips the language filter. This drives
 * the read-time auto-hide: a flagged signature is curated out of the public
 * view exactly like one on the book's `hidden` list — but computed per render
 * rather than written to the book, so it needs no host write and covers even
 * records authored straight to a PDS. See src/lib/profanity.js.
 */
function entryHasProfanity(value) {
  if (!value) return false;
  return (
    hasProfanity(value.text) || hasProfanity(value.signature) || hasProfanity(value.location)
  );
}

/**
 * Fetch the record for one Constellation ref (`{did, collection, rkey}`) —
 * Slingshot first, direct PDS on a miss. Returns the raw getRecord shape or
 * `null` when the record is gone; the per-book hydrators below normalize it.
 */
async function fetchRefRecord(ref) {
  const { did, collection, rkey } = ref || {};
  if (!did || !collection || !rkey) return null;
  const cached = await getRecordCached({ repo: did, collection, rkey });
  if (cached) return cached;
  try {
    const pds = await resolvePds(did);
    return await getRecord(pds, { repo: did, collection, rkey });
  } catch {
    return null;
  }
}

/** Hydrate a modern `is.dame.guestbook.entry` ref into an entry. */
async function hydrateModernRef(ref) {
  const record = await fetchRefRecord(ref);
  const value = record?.value;
  // Belt-and-braces: Constellation already filtered on subject, but a record
  // may have been rewritten to point elsewhere since indexing.
  if (!value || value.subject !== GUESTBOOK_SUBJECT) return null;
  return {
    uri: record.uri || toAtUri(ref),
    cid: record.cid ?? null,
    did: ref.did,
    rkey: ref.rkey,
    collection: GUESTBOOK_ENTRY_NSID,
    legacy: false,
    value,
    profile: null,
  };
}

/**
 * Hydrate a legacy `a.guestbook.i.signed` ref into the same entry shape. The
 * old lexicon carried the note in `message` and rarely set `createdAt`, so we
 * surface `message` as `text` and fall back to the TID rkey for a timestamp
 * (the couple of human-chosen rkeys just stay timeless).
 */
async function hydrateLegacyRef(ref) {
  const record = await fetchRefRecord(ref);
  const raw = record?.value;
  if (!raw || raw.guestbook !== LEGACY_GUESTBOOK_SUBJECT) return null;
  const message = typeof raw.message === 'string' ? raw.message : '';
  const createdAt = normalizeIso(raw.createdAt) || tidToTimestamp(ref.rkey) || undefined;
  return {
    uri: record.uri || toAtUri(ref),
    cid: record.cid ?? null,
    did: ref.did,
    rkey: ref.rkey,
    collection: LEGACY_GUESTBOOK_ENTRY_NSID,
    legacy: true,
    value: { ...raw, text: message, createdAt },
    profile: null,
  };
}

/** Sort entries newest-first by their (normalized) createdAt; timeless last. */
function sortByCreatedAt(entries) {
  return entries.slice().sort((a, b) => compareIsoDesc(a.value?.createdAt, b.value?.createdAt));
}

/** ISO string if `value` parses as a date, else `null`. */
function normalizeIso(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// The read walk spans two books (modern pages, then the legacy tail); the
// cursor threading them is just JSON handed back to callers opaquely.
function encodeGuestbookCursor(state) {
  try {
    return encodeURIComponent(JSON.stringify(state));
  } catch {
    return null;
  }
}

function decodeGuestbookCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(decodeURIComponent(cursor));
  } catch {
    return null;
  }
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
 * Constellation drops the backlink once the delete propagates. `collection`
 * defaults to the modern entry NSID but is passed through from the entry, so
 * a legacy `a.guestbook.i.signed` signature deletes from the right collection.
 */
export async function deleteGuestbookEntry(agent, rkey, collection = GUESTBOOK_ENTRY_NSID) {
  if (!agent) throw new Error('Sign in first.');
  await agent.com.atproto.repo.deleteRecord({
    repo: agent.assertDid,
    collection,
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
