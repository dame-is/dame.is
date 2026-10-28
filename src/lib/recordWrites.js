// Small, pure answers the admin's writers need about what the PDS handed back:
// did a write lose a compare-and-swap, did a read or delete find nothing, and
// which blob is this — plus the one read built on them. Kept free of React so
// vitest can pin them in `node`.

/**
 * Did this write fail because the record changed underneath it?
 *
 * `putRecord` with `swapRecord` is a compare-and-swap: the PDS refuses with an
 * `InvalidSwap` XRPC error (`@atproto/api` raises it as `InvalidSwapError`)
 * when the record's current CID is not the one the caller loaded — or, for a
 * `swapRecord: null`, when a record is there at all. The PDS's own message for
 * it is "Record was at <cid>", which is the fallback for a client that loses
 * the error code on the way through.
 */
export function isSwapConflict(err) {
  const code = err?.error || err?.data?.error || '';
  if (code === 'InvalidSwap') return true;
  if (err?.name === 'InvalidSwapError') return true;
  return /^record was at /i.test(err?.message || '');
}

/**
 * Did this read or delete fail because the record is not there? The broad
 * one of the site's not-found tests, on purpose (atproto.js's
 * isRecordNotFound says which to use where).
 *
 * The same three shapes `RecordEditor` matches on a failed load: an XRPC
 * `RecordNotFound` (some PDS builds say `NotFound` or answer a bare 404), and
 * the PDS's prose "Could not locate record". Used where a missing record is the
 * EXPECTED answer — deleting the other namespace's copy of a play, which most
 * plays never had — so the broad match is the safe direction.
 */
export function isRecordMissing(err) {
  const code = err?.error || err?.data?.error || '';
  if (code === 'RecordNotFound' || code === 'NotFound') return true;
  if (err?.status === 404) return true;
  return /could not locate record|record not found/i.test(err?.message || '');
}

/**
 * `getRecord` for a record that may legitimately not exist yet — the admin's
 * singletons (the sky override, the nav override) and the page records. Resolves
 * the response, or `null` when the PDS said there is no such record, and
 * REJECTS on anything else.
 *
 * The distinction is the whole point. These editors seed defaults when there is
 * no record, and every one of them used to treat any failed read as "no record":
 * a network blip, an expired session or a 5xx opened the built-in defaults as
 * though they were the saved state, one Save away from writing them over the
 * real record. None of those errors match `isRecordMissing`, so they reach the
 * caller, which can say so and keep Save out of reach. Pair a `null` with a
 * create-only write (`swapRecord: null`), so a record that turns up after all
 * fails the write rather than being replaced.
 *
 * @param {{ com: { atproto: { repo: { getRecord: Function } } } }} agent
 * @param {{ repo: string, collection: string, rkey: string }} params
 */
export async function getRecordIfExists(agent, params) {
  try {
    return await agent.com.atproto.repo.getRecord(params);
  } catch (err) {
    if (isRecordMissing(err)) return null;
    throw err;
  }
}

/**
 * The CID string of a blob reference, in either of the two forms the editors
 * hold one in.
 *
 * A blob read back out of a saved record is plain JSON — `{ ref: { $link } }`.
 * One fresh from `uploadBlob` is NOT: the XRPC client parses its response with
 * `jsonStringToLex`, so `data.blob` is a live `BlobRef` whose `ref` is a CID
 * instance, and a CID has neither `$link` nor `cid` on it — only `toString()`.
 * Reading `ref.$link` alone is how a just-uploaded photo kept its "No preview"
 * box until the page was reloaded. `asCID === ref` is the CID class's own
 * self-identification, which a plain object's inherited `toString` (and its
 * "[object Object]") never passes.
 *
 * @returns {string|null}
 */
export function blobCid(blob) {
  const ref = blob?.ref;
  if (typeof ref?.$link === 'string') return ref.$link;
  if (ref && typeof ref === 'object' && ref.asCID === ref)
    return ref.toString();
  if (typeof blob?.cid === 'string') return blob.cid;
  return null;
}
