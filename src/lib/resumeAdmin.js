// Admin-side mutations for the resume graph that go beyond editing one record.
//
// AT Protocol keys a record immutably by its rkey, so "renaming" a job or
// education slug is really a move: create the record under the new key, repoint
// every resume backlink from the old at:// URI to the new one, then delete the
// old record. Ordering (create → repoint → delete) guarantees no resume ever
// references a key that doesn't exist mid-flight.

import { rkeyFromAtUri } from './atproto.js';
import { COLLECTIONS } from '../config.js';

const RKEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._~:-]{0,511}$/;

/** Whether a string is a syntactically valid AT record key. */
export function isValidRkey(rkey) {
  return typeof rkey === 'string' && rkey !== '.' && rkey !== '..' && RKEY_RE.test(rkey);
}

/**
 * Count the resume versions that backlink to a record URI through the given
 * lists (e.g. jobs via `entries[].job`). Used to warn before a rename.
 */
export function countBacklinks(resumes, recordUri, backlinks) {
  const rkeys = new Set();
  for (const rec of resumes || []) {
    for (const { listKey, refKey } of backlinks || []) {
      const list = rec?.value?.[listKey];
      if (Array.isArray(list) && list.some((e) => e?.[refKey] === recordUri)) {
        rkeys.add(rkeyFromAtUri(rec.uri));
      }
    }
  }
  return rkeys.size;
}

/**
 * Move a record to a new rkey, repointing resume backlinks.
 *
 *   agent, did      — the signed-in PDS agent + repo DID
 *   collection      — the record's NSID (job / education / resume)
 *   fromRkey/toRkey — old and new keys (caller validates + checks availability)
 *   value           — the record's current value (moved verbatim, updatedAt bumped)
 *   resumes         — the loaded resume bundle, scanned for backlinks
 *   backlinks       — [{ listKey, refKey }] pairs to rewrite (empty for resumes)
 *
 * Returns `{ newUri, updatedResumes }` — the rkeys of the resumes rewritten.
 */
export async function renameRecordKey({
  agent,
  did,
  collection,
  fromRkey,
  toRkey,
  value,
  resumes,
  backlinks = [],
}) {
  const oldUri = `at://${did}/${collection}/${fromRkey}`;
  const newUri = `at://${did}/${collection}/${toRkey}`;
  const now = new Date().toISOString();

  // 1. Create the record under the new key (same facts, bumped updatedAt).
  const record = { ...(value || {}), $type: value?.$type || collection, updatedAt: now };
  if (!record.createdAt) record.createdAt = now;
  await agent.com.atproto.repo.putRecord({ repo: did, collection, rkey: toRkey, record });

  // 2. Repoint every resume backlink from the old URI to the new one.
  const updatedResumes = [];
  for (const rec of resumes || []) {
    const v = rec?.value;
    if (!v) continue;
    let changed = false;
    const nextValue = { ...v };
    for (const { listKey, refKey } of backlinks) {
      const list = v[listKey];
      if (!Array.isArray(list)) continue;
      let listChanged = false;
      const nextList = list.map((entry) => {
        if (entry?.[refKey] === oldUri) {
          listChanged = true;
          return { ...entry, [refKey]: newUri };
        }
        return entry;
      });
      if (listChanged) {
        nextValue[listKey] = nextList;
        changed = true;
      }
    }
    if (changed) {
      const rkey = rkeyFromAtUri(rec.uri);
      // eslint-disable-next-line no-await-in-loop
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: COLLECTIONS.resume,
        rkey,
        record: { ...nextValue, updatedAt: now },
      });
      updatedResumes.push(rkey);
    }
  }

  // 3. Delete the old record last — nothing points at it anymore.
  await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey: fromRkey });

  return { newUri, updatedResumes };
}

/** The backlink lists that reference each canonical collection from a resume. */
export function backlinksFor(collection) {
  if (collection === COLLECTIONS.resumeJob) return [{ listKey: 'entries', refKey: 'job' }];
  if (collection === COLLECTIONS.resumeEducation) return [{ listKey: 'education', refKey: 'education' }];
  return [];
}
