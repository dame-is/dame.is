// Closing the record when someone comes off the list.
//
// A decision row that put someone on the list stays live until something says
// otherwise, and "undo last", the hub's Activity counts and the agent's intent
// check all read a live row as "still on the list because of this". So every
// path that takes someone off has to close the rows that put them on. The
// queue's Remove always did; a typed or agent "unblock" and the hub's bulk
// removal did not, which left "undo last" choosing a plan whose only account
// was already gone and answering "1 left, send undo again" on every try.
//
// Stamped undone, never deleted, as everywhere else: "was I ever on this list"
// stays answerable.

import { selectAll, upsert } from './modDb.js';

/** DIDs per filtered read, so the query string stays a sensible length. */
const CHUNK = 50;

/**
 * Stamp every live `list_add` decision for these accounts undone.
 *
 * @param {string|string[]} dids
 * @param {string} reason  why they came off, in the words of whoever asked
 * @returns {Promise<number>} how many decision rows were closed
 */
export async function closeAdds(dids, reason) {
  const wanted = [...new Set([dids].flat().filter(Boolean))];
  const now = new Date().toISOString();
  let closed = 0;
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const chunk = wanted.slice(i, i + CHUNK);
    const live = await selectAll('decision', {
      select: 'plan_id,did,band,acted_at',
      eq: { action: 'list_add' },
      where: {
        did: `in.(${chunk.map((d) => `"${d}"`).join(',')})`,
        acted_at: 'not.is.null',
        undone_at: 'is.null',
      },
      order: 'plan_id.asc,did.asc',
    });
    if (!live.length) continue;
    // Every column the row was written with, not only the two that change:
    // PostgREST's upsert inserts the payload before ON CONFLICT merges it, so
    // a partial row fails any NOT NULL column it leaves out.
    await upsert(
      'decision',
      live.map((r) => ({
        plan_id: r.plan_id,
        did: r.did,
        band: r.band,
        action: 'list_add',
        acted_at: r.acted_at,
        undone_at: now,
        undo_reason: reason,
      })),
    );
    closed += live.length;
  }
  return closed;
}
