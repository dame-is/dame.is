// Reading one /creating work back from the PDS.
//
// A work is addressed by its path (`/creating/red-blue-yellow`), which is a
// field inside the record rather than its key, so finding one live used to
// mean listing every standard document on the PDS — a couple of hundred
// records, bodies and all — and searching them. The page did that, and the
// footer's timestamp lookup did it again. But the snapshot both of them read
// first already says which record the path names; re-reading that one record
// confirms it in a single small request. Only a work the snapshot doesn't
// know (published since the build, or given a new path) still needs the list.

import { getRecord } from './atproto.js';
import { transformRecords } from './feedBuilder.js';
import { isDraft, showOnCreating, workSlug } from './publications.js';
import { ME_DID, COLLECTIONS } from '../config.js';

const STANDARD_DOC = 'site.standard.document';
const WORK_COLLECTIONS = new Set([STANDARD_DOC, COLLECTIONS.creating]);

/**
 * Does this record answer to `/creating/<slug>`? By its path, or by its rkey
 * (so URI-derived links resolve too); never as a draft, and a standard
 * document only when it is one /creating shows.
 */
export function isWorkAt(record, slug) {
  const v = record?.value;
  if (!v || !slug || isDraft(v)) return false;
  const m = /^at:\/\/[^/]+\/([^/]+)\/([^/?#]+)$/.exec(String(record.uri || ''));
  if (m?.[1] === STANDARD_DOC && !showOnCreating(v)) return false;
  return workSlug(v) === slug || m?.[2] === slug;
}

/**
 * The live copy of `known` — a record a snapshot found at `slug` — with blob
 * URLs and timestamps filled in as the snapshot's are. Null when there is
 * nothing to re-read (no record, or one that isn't the owner's work) or when
 * the live copy no longer answers to `slug`, so the caller falls back to
 * searching. Never rejects.
 */
export async function rereadWork(pds, known, slug) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(
    String(known?.uri || ''),
  );
  if (!pds || !m || m[1] !== ME_DID || !WORK_COLLECTIONS.has(m[2])) return null;
  const [, , collection, rkey] = m;
  const rec = await getRecord(pds, { repo: ME_DID, collection, rkey }).catch(
    () => null,
  );
  if (!rec?.value) return null;
  transformRecords([rec], collection, pds, ME_DID);
  return isWorkAt(rec, slug) ? rec : null;
}
