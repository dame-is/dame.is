// Who a log row belongs to, when the logs disagree about how to say it.
//
// Ratioed has two kinds of event log and they name people differently. The
// harvest behind the first eleven pieces predates recorded DIDs and carries a
// handle alone; every log written since carries a DID and usually a handle too.
// Both are correct, and neither can be rewritten — the harvest is a finished
// measurement holding records that have since been deleted.
//
// So anything counting people across those logs was keying on
// `did || "h:" + handle`, which is not one key space but two, and the same
// person lands in both. It cost five separate wrong numbers on the site:
//
//   • the replay's counter read "people 0" beside a header saying 32, on the
//     nine pieces whose alive window is entirely harvest,
//   • the faces grid drew one account twice on a bundled take, and rang both
//     frames as the breaker,
//   • "first-timers" could not match anybody from takes 1–11 against anybody
//     from 12–17, so take 14 claimed 31 newcomers of 33 where the truth is 26,
//   • the project's median follower count counted ten people twice,
//   • and the roster merge summed the same act from both sides.
//
// The fix is small and belongs in one place: rows that carry BOTH a DID and a
// handle prove the two refer to one person, so a pass over everything that is
// known builds the link, and a did-less row is then resolved through it.
//
// This module knows nothing about pieces, records or the network. It is given
// rows and returns a function.

/** What a log writes when nothing could name the account behind a DID. */
export const UNRESOLVED = '(unresolvable)';

/**
 * A `who(row)` function: one stable key per person, across both log kinds.
 *
 * Build it from every row you are about to count — and, where the question
 * spans pieces, from every row in every piece, since the link that names a
 * did-less row may only exist in a different take's log.
 *
 * Three rules, in order:
 *   1. A DID is the answer whenever the row has one.
 *   2. A handle some other row has tied to a DID resolves to that DID.
 *   3. Anything else keys on the handle itself — still enough to tell two
 *      people apart within one log, which is the job.
 *
 * A handle claimed by two different DIDs is dropped from the link rather than
 * guessed at: that is a rename, or it is `(unresolvable)`, and crediting one
 * account with another's acts is worse than leaving them separate. For the same
 * reason `(unresolvable)` never links anything — it is the log saying it does
 * not know, and every row carrying it would otherwise collapse into one person.
 */
export function identify(rows) {
  const didFor = new Map();
  const ambiguous = new Set();
  for (const r of rows || []) {
    if (!r?.did || !r.h || r.h === UNRESOLVED) continue;
    const seen = didFor.get(r.h);
    if (seen && seen !== r.did) ambiguous.add(r.h);
    else didFor.set(r.h, r.did);
  }
  for (const h of ambiguous) didFor.delete(h);

  return function who(row) {
    if (!row) return null;
    if (row.did) return row.did;
    if (row.h && row.h !== UNRESOLVED) return didFor.get(row.h) || `h:${row.h}`;
    // A row that names nobody at all. Keyed by the record it is, so two
    // deactivated accounts in one log stay two people rather than collapsing
    // into one — an undercount is as wrong as an overcount.
    const at = row.rkey || `${row.k}:${row.offMs ?? row.off ?? ''}`;
    return at ? `row:${at}` : null;
  };
}

/**
 * The same thing over several logs at once.
 *
 * `logs` is anything iterable of row arrays — the values of a rkey→log map, or
 * a list of per-piece logs. The link is built from all of them together, which
 * is the point: take 17's log is what proves the handle in take 4's harvest
 * belongs to the DID take 17 recorded.
 */
export function identifyAcross(logs) {
  const all = [];
  for (const log of logs || []) for (const r of log || []) all.push(r);
  return identify(all);
}
