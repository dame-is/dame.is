// What a Jetstream frame means to this service.
//
// Four things matter here and everything else on the stream is dropped:
//
//   put      a block record was created, or rewritten in place
//   delete   a block record was deleted. This is the unblock, and it arrives
//            with no record in it: only whose repo and which key. Who had
//            been blocked is something the index has to already know.
//   void     a block record was written that blocks nobody (its subject is
//            not an account, or is its own author)
//   gone     an account was deleted outright, and its records with it
//
// Two wire formats are read, because Bluesky runs two generations of
// Jetstream side by side (bsky.network/docs/jetstream):
//
//   v1  { did, time_us, kind: 'commit', commit: { operation, collection,
//         rkey, record } }
//   v2  { $type: 'message', payload: { $type: '...#commit', did, seq, time,
//         operation, collection, rkey, record } }
//
// The v1 shape is the one the mod-consumer beside this has been reading in
// production. The v2 shape is written from the documentation and its published
// example, and had not been run against the live service when this was
// written: the sandbox it was built in cannot open a WebSocket.

import { isDid } from './dids.js';

export const BLOCK_NSID = 'app.bsky.graph.block';

// A record key, as the syntax spec has it.
const RKEY = /^[A-Za-z0-9._:~-]{1,512}$/;

/** Unix seconds from v1's microseconds or v2's RFC 3339 string. */
function eventSeconds(timeUs, time) {
  if (Number.isFinite(timeUs) && timeUs > 0) return Math.floor(timeUs / 1e6);
  const ms = Date.parse(time || '');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** The two shapes, flattened to one. */
function flatten(frame) {
  if (!frame || typeof frame !== 'object') return null;
  const payload = frame.payload;
  if (payload && typeof payload === 'object') {
    const type = String(payload.$type || '');
    const kind = type.slice(type.lastIndexOf('#') + 1);
    return {
      kind,
      did: payload.did,
      // On v2 the cursor is the sequence number.
      cursor: frame.cursor ?? payload.seq ?? null,
      at: eventSeconds(null, payload.time),
      commit: kind === 'commit' ? payload : null,
      account: payload.account || null,
    };
  }
  return {
    kind: frame.kind,
    did: frame.did,
    // On v1 the cursor is the event's own timestamp.
    cursor: frame.cursor ?? frame.time_us ?? null,
    at: eventSeconds(frame.time_us, null),
    commit: frame.commit || null,
    account: frame.account || null,
  };
}

function eventOf(e) {
  if (!isDid(e.did) || e.at == null) return null;
  const base = { did: e.did, at: e.at };

  if (e.kind === 'account') {
    // Only an outright deletion. A deactivated, suspended or taken-down
    // account can come back, and its blocks are still its blocks.
    if (e.account?.active === false && e.account?.status === 'deleted') {
      return { type: 'gone', ...base };
    }
    return null;
  }

  if (e.kind !== 'commit' || e.commit?.collection !== BLOCK_NSID) return null;
  const { operation, rkey, record } = e.commit;
  if (typeof rkey !== 'string' || !RKEY.test(rkey)) return null;

  if (operation === 'delete') return { type: 'delete', ...base, rkey };

  if (operation === 'create' || operation === 'update') {
    const subject = record?.subject;
    // The subject is whatever the author typed. One that is not a DID blocks
    // nobody, and neither does a block of oneself. That is still worth
    // saying: if this key used to hold a real block, it no longer does.
    if (!isDid(subject) || subject === e.did) return { type: 'void', ...base, rkey };
    return { type: 'put', ...base, rkey, subject };
  }
  return null;
}

/**
 * Read one parsed frame.
 *
 * @returns {{
 *   cursor: number|string|null,
 *   event: null | {
 *     type: 'put' | 'delete' | 'void' | 'gone',
 *     did: string, at: number, rkey?: string, subject?: string,
 *   },
 * }}
 * `cursor` is there for every frame that carries one, including the many this
 * service has no other use for, so the resume point keeps moving through
 * them. `at` is Jetstream's clock in unix seconds, never the record's own
 * `createdAt`, which is whatever its author's client claimed.
 */
export function readFrame(frame) {
  const e = flatten(frame);
  if (!e) return { cursor: null, event: null };
  return { cursor: e.cursor, event: eventOf(e) };
}
