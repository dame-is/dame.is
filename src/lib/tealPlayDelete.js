// Deleting a play has to delete it in BOTH teal.fm namespaces.
//
// The namespace move kept rkeys, so an rkey under both `fm.teal.alpha.feed.play`
// and `fm.teal.feed.play` is one play written twice — and every reader on the
// site (teal.js `dedupePlaysByRkey`) shows the production copy and quietly drops
// the alpha one. Deleting only the copy on screen therefore looked like a
// successful delete and was not: on the next read the alpha twin was the only
// copy left, nothing was shadowing it any more, and the play came straight back,
// in the admin and on /listening alike.
//
// Which plays HAVE a twin is not knowable from a list: the reader that would
// know has already deduped it away, and the two namespaces page independently,
// so a twin is as likely to sit on a page nobody has loaded. So every copy is
// asked for, and a copy that was never there is the expected answer rather than
// a failure — the PDS treats deleting a missing record as a no-op, and the few
// builds that answer "not found" instead are told apart by `isRecordMissing`.

import { TEAL_PLAY_NSIDS } from './teal.js';
import { isRecordMissing } from './recordWrites.js';

/**
 * Every collection a record at `collection` may also live in — itself first,
 * then the other teal play namespaces. Anything that is not a teal play is only
 * ever itself.
 *
 * @param {string} collection
 * @returns {string[]}
 */
export function playCopiesOf(collection) {
  if (!TEAL_PLAY_NSIDS.includes(collection)) return [collection];
  return [collection, ...TEAL_PLAY_NSIDS.filter((nsid) => nsid !== collection)];
}

/**
 * Delete one record, and — for a teal play — its copy in every other namespace.
 *
 * The record the caller named is deleted first and its failure is the caller's
 * to handle, exactly as a plain `deleteRecord` would be. The twins follow one at
 * a time rather than in parallel, for the same reason the bulk deletes that call
 * this are serial: a burst of writes against one repo is how a PDS starts
 * refusing them.
 *
 * @param {object} agent  an @atproto/api Agent
 * @param {{repo: string, collection: string, rkey: string}} target
 */
export async function deleteEveryCopy(agent, { repo, collection, rkey }) {
  const [own, ...twins] = playCopiesOf(collection);
  await agent.com.atproto.repo.deleteRecord({ repo, collection: own, rkey });
  for (const twin of twins) {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo,
        collection: twin,
        rkey,
      });
    } catch (err) {
      if (!isRecordMissing(err)) throw err;
    }
  }
}
