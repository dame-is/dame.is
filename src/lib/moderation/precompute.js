// Build the reference data every scoring decision reads.
//
// One number does the work: for any account, how many of the people dame
// follows also follow them. Computing it per-candidate at decision time would
// mean an API call per account and a different answer every time the graph
// moved. Computing it ONCE per snapshot turns it into a dictionary lookup, and
// — the part that matters more — freezes it, so a decision made on Tuesday can
// be replayed against the graph as it stood on Tuesday.
//
// The work is ~234 follow lists, roughly 2,000 API calls, which does not fit in
// one serverless invocation. So it follows the arena-mirror pattern already in
// this repo: spend a time budget, stop cleanly, resume on the next firing. Edges
// are staged raw and aggregated in a single SQL statement at the end, so an
// interrupted run leaves a partial edge set (harmless) rather than a half-counted
// vouch table that looks finished and is wrong.

import { APPVIEW, ME_DID } from '../../config.js';

/** `getFollows` pages at 100. */
const PAGE = 100;

/**
 * Follow-list pages to read per circle member.
 *
 * At 100 per page this reads the first 1,500 accounts someone follows. A member
 * who follows more than that contributes a truncated set, which understates the
 * vouch count for accounts deep in their list. That is the right way to be
 * wrong: understating a vouch sends someone to review, overstating one waves
 * them through, and only one of those mistakes is recoverable.
 */
const MAX_PAGES = 15;

/** How many follow lists to fetch at once. */
const CONCURRENCY = 8;

/**
 * Fetch JSON, distinguishing a failure that will never succeed from one that
 * might.
 *
 * The distinction is load-bearing. An account you follow that has been
 * deactivated or taken down answers 400 from getFollows and always will;
 * retrying it forever is how a snapshot livelocks with everything else done.
 * A 429 or a 5xx is worth coming back for.
 *
 * @returns {{ body: object|null, permanent: boolean }}
 */
async function getJson(url, fetchImpl, signal, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (res.ok) return { body: await res.json(), permanent: false };
      if (![429, 502, 503, 504].includes(res.status)) {
        return { body: null, permanent: true };
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return { body: null, permanent: false };
}

/**
 * Every account `did` follows, up to MAX_PAGES.
 *
 * Reads the AppView rather than the PDS: `getFollows` needs no auth, needs no
 * PLC lookup to find the host, and is cached. The AppView's viewer-filtering
 * problem that rules it out for harvesting does not apply here, because these
 * calls are unauthenticated and so have no viewer to filter for.
 */
export async function followsOf(
  did,
  { fetchImpl = fetch, signal, appview = APPVIEW, deadline = Infinity } = {},
) {
  const out = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Checked per PAGE, not per member. A member following 1,500 accounts is
    // fifteen sequential requests with retries behind each one, so a budget
    // enforced only between members can overrun by tens of seconds — which is
    // how a 45s budget produced a 60s function timeout.
    if (Date.now() >= deadline)
      return { dids: out, complete: false, aborted: true, permanent: false };
    const url =
      `${appview}/xrpc/app.bsky.graph.getFollows?actor=${encodeURIComponent(did)}&limit=${PAGE}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const { body, permanent } = await getJson(url, fetchImpl, signal);
    if (!body) return { dids: out, complete: false, aborted: false, permanent };
    for (const f of body.follows || []) if (f?.did) out.push(f.did);
    cursor = body.cursor;
    if (!cursor)
      return { dids: out, complete: true, aborted: false, permanent: false };
  }
  return { dids: out, complete: false, aborted: false, permanent: false };
}

/**
 * Read the accounts dame follows, straight from the PDS.
 *
 * The PDS rather than the AppView here because this is the authoritative list
 * and it is small: a follow record that exists but has not been indexed yet
 * should still count, since dame made it.
 */
export async function readCircle({
  pds,
  did = ME_DID,
  fetchImpl = fetch,
  signal,
} = {}) {
  const out = [];
  let cursor;
  for (let page = 0; page < 40; page += 1) {
    const url =
      `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}` +
      `&collection=app.bsky.graph.follow&limit=100` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const { body } = await getJson(url, fetchImpl, signal);
    if (!body) break;
    for (const r of body.records || []) {
      if (r?.value?.subject) out.push(r.value.subject);
    }
    cursor = body.cursor;
    if (!cursor) break;
  }
  return [...new Set(out)];
}

/**
 * Index the follow lists of circle members that have not been done yet.
 *
 * Pure orchestration: the caller supplies `pending` (members still to do) and
 * two sinks, so this runs identically against Supabase in a cron and against a
 * Map in a test. Stops when the time budget is spent and reports what is left.
 *
 * @param {object} opts
 * @param {string[]} opts.pending           circle members with no follow list yet
 * @param {(edges: Array<{member: string, target: string}>) => Promise<void>} opts.writeEdges
 * @param {(member: string) => Promise<void>} opts.markDone
 * @param {number} [opts.budgetMs]          wall-clock budget for this run
 * @returns {Promise<{indexed: number, remaining: number, edges: number, partial: string[], unreadable: Array<{member: string, permanent: boolean}>}>}
 */
export async function indexCircleFollows({
  pending,
  writeEdges,
  markDone,
  budgetMs = 45_000,
  fetchImpl = fetch,
  signal,
  onProgress,
}) {
  const started = Date.now();
  const queue = [...pending];
  const partial = [];
  const unreadable = [];
  let indexed = 0;
  let edges = 0;
  let stopped = false;

  const deadline = started + budgetMs;

  async function worker() {
    while (!stopped) {
      if (Date.now() >= deadline) {
        stopped = true;
        return;
      }
      const member = queue.shift();
      if (!member) return;
      const { dids, complete, aborted, permanent } = await followsOf(member, {
        fetchImpl,
        signal,
        deadline,
      });
      if (aborted) {
        // Ran out of budget mid-member. Write nothing and mark nothing: a
        // partial follow list recorded as complete would understate this
        // member's vouches for the life of the snapshot, and understating a
        // vouch is the mistake that sends someone to review who did not need
        // it. Leaving the row pending costs one retry.
        stopped = true;
        return;
      }
      if (!complete && dids.length === 0) {
        // Could not read them at all. A permanent failure is reported so the
        // caller can stop asking: an account that is deactivated or taken down
        // answers 400 forever, and leaving it pending blocks the snapshot for
        // good. A transient one is simply left for the next firing.
        unreadable.push({ member, permanent });
        continue;
      }
      if (!complete) partial.push(member);
      const rows = [...new Set(dids)].map((target) => ({ member, target }));
      await writeEdges(rows);
      await markDone(member);
      indexed += 1;
      edges += rows.length;
      onProgress?.({ indexed, remaining: queue.length, member });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker),
  );

  return { indexed, remaining: queue.length, edges, partial, unreadable };
}

/**
 * Everyone on a curation list dame maintains.
 *
 * These are the protected set alongside the follows, and they belong there for
 * a reason worth stating: putting someone on "Noticing" or "Contemporary Art"
 * is a deliberate act of curation. An account dame went out of their way to
 * collect should never be swept up by a tool reacting to one post, and the fact
 * that dame follows only 234 accounts while curating hundreds more means the
 * follow graph alone would miss most of them.
 *
 * Moderation lists are deliberately excluded — a modlist is the opposite claim.
 */
export async function readCurationMembers({
  pds,
  did = ME_DID,
  fetchImpl = fetch,
  signal,
} = {}) {
  const pages = async (collection) => {
    const out = [];
    let cursor;
    for (let i = 0; i < 200; i += 1) {
      const url =
        `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}` +
        `&collection=${collection}&limit=100` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const { body } = await getJson(url, fetchImpl, signal);
      if (!body) break;
      out.push(...(body.records || []));
      cursor = body.cursor;
      if (!cursor) break;
    }
    return out;
  };

  const lists = await pages('app.bsky.graph.list');
  const curation = new Set(
    lists
      .filter((r) => r.value?.purpose === 'app.bsky.graph.defs#curatelist')
      .map((r) => r.uri),
  );
  const nameByUri = new Map(
    lists.map((r) => [r.uri, r.value?.name || 'untitled']),
  );

  const items = await pages('app.bsky.graph.listitem');
  const out = new Map();
  for (const r of items) {
    const listUri = r.value?.list;
    const subject = r.value?.subject;
    if (!subject || !curation.has(listUri)) continue;
    // First list wins the reason, so the label stays stable rather than
    // flipping with listRecords ordering between runs.
    if (!out.has(subject)) {
      out.set(subject, `list:${nameByUri.get(listUri)}`);
    }
  }
  return out;
}

/**
 * Turn a finalised snapshot into the lookup structures the scorer takes.
 *
 * @param {Array<{did: string, vouches: number}>} vouchRows
 * @param {string[]} circleDids
 * @param {Array<{did: string, reason: string}>} protectedRows
 */
export function referenceFrom({
  vouchRows = [],
  circleDids = [],
  protectedRows = [],
  listedDids = [],
} = {}) {
  return {
    vouches: new Map(vouchRows.map((r) => [r.did, r.vouches])),
    circle: new Set(circleDids),
    protectedSet: new Map(protectedRows.map((r) => [r.did, r.reason])),
    // Everyone any circle member follows is, by definition, one hop out. The
    // vouch table already enumerates exactly that set, so distance 2 comes free
    // rather than needing its own crawl.
    neighbourhood: new Set(vouchRows.map((r) => r.did)),
    alreadyListed: new Set(listedDids),
  };
}

/**
 * What a precompute run should do next.
 *
 * Extracted and made pure because the inline version of this decision produced
 * three separate bugs: a budget that let workers overrun the function timeout,
 * a progress count that reported the in-memory queue instead of the database,
 * and an `idle` branch that fired on a snapshot which had been collected but
 * never aggregated — answering "ready · 0 scored", which is a finished-looking
 * reply for a snapshot nothing can be scored against.
 *
 * The rule that ties it together: COLLECTED IS NOT FINALISED. A snapshot with
 * every member read and no vouch rows is halfway, and halfway must never look
 * done.
 *
 * @param {object} state
 * @param {number} state.pending   circle members with no follow list yet
 * @param {number} state.vouches   vouch rows for this snapshot (0 = not aggregated)
 * @param {number} state.ageDays   age of the snapshot
 * @param {number} [state.maxAgeDays]
 * @param {boolean} [state.exists] is there a snapshot at all
 * @param {boolean} [state.restart] forced rebuild
 * @returns {'start'|'collect'|'finalise'|'idle'}
 */
export function nextAction({
  pending,
  vouches,
  ageDays,
  maxAgeDays = 7,
  exists = true,
  restart = false,
}) {
  if (restart || !exists) return 'start';
  if (pending > 0) return 'collect';
  if (vouches === 0) return 'finalise';
  return ageDays >= maxAgeDays ? 'start' : 'idle';
}
