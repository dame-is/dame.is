/**
 * Collapse consecutive `listening` items into session batches.
 *
 * Listens merge into one session when they fall within
 * `LISTEN_BATCH_GAP_MS` of each other — the gap is measured
 * listen-to-listen, so non-listening items interleaved in a mixed feed
 * (a post mid-session, etc.) don't fragment the batch, and they pass
 * through to the output untouched. Day boundaries don't matter; a
 * session that crosses midnight still groups into one row.
 *
 * A batch keeps the first-seen play's fields (in a newest-first feed
 * that's the most recent play, so the batch sorts and dates like its
 * newest song) plus a `count` and a `plays` array of the underlying
 * records for expand/collapse.
 */
export const LISTEN_BATCH_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours

export function collapseListens(items) {
  const out = [];
  let openBatch = null;
  let lastListenTime = 0;
  for (const item of items) {
    if (item.verb === 'listening') {
      const t = Date.parse(item.createdAt) || 0;
      if (openBatch && Math.abs(lastListenTime - t) <= LISTEN_BATCH_GAP_MS) {
        openBatch.count = (openBatch.count || 1) + 1;
        openBatch.plays.push(item);
        lastListenTime = t;
        continue;
      }
      const batch = { ...item, count: 1, plays: [item] };
      openBatch = batch;
      lastListenTime = t;
      out.push(batch);
    } else {
      // Non-listening items pass through but DON'T close the batch — the
      // next listen within the gap window still merges into the session.
      out.push(item);
    }
  }
  return out;
}
