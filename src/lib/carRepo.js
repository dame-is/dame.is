// Whole-repo ingestion for the Analytics studio — com.atproto.sync.getRepo.
//
// A repo CAR is the PDS's own export format: every record in every collection
// in one download, as content-addressed blocks (a signed commit, the MST
// nodes that map `collection/rkey` paths to record CIDs, and the DAG-CBOR
// record bodies). Measured on the live repo: 62 MB, 120,336 records across
// 149 collections, fully parsed in under two seconds — where enumerating the
// same records over listRecords is hundreds of requests, period-clamped and
// page-capped. This is what makes the Atmosphere tab exact and all-time, and
// the outbound engagement archive complete.
//
// What a CAR does NOT carry: engagement counts (AppView aggregates), other
// people's records (followers), notifications. Those keep their own sweeps
// in analyticsSync.js — this module is a bulk source, not a replacement.
//
// Incremental syncs use `since=<rev>`: the PDS returns only blocks written
// after that revision. A diff CAR's MST nodes reference unchanged records
// whose blocks are deliberately absent, so the walk below treats a missing
// block as "already have it" and skips — the same code path reads full and
// diff CARs. Deletions never appear in a diff; the full re-pull (Rebuild)
// is the deletion story.
//
// The @atcute libraries (~50 KB total, dependency-light) are imported
// dynamically so they load with the first sync, not with the admin chunk.

import { tidToTimestamp } from './atproto.js';

/** How often the parse loops yield to the event loop. */
const YIELD_EVERY = 4000;

let _atcute = null;
async function atcute() {
  if (!_atcute) {
    const [car, cbor, cid] = await Promise.all([
      import('@atcute/car'),
      import('@atcute/cbor'),
      import('@atcute/cid'),
    ]);
    _atcute = { car, cbor, cid };
  }
  return _atcute;
}

/**
 * Download a repo CAR from the PDS — the whole repo, or only blocks since a
 * revision. Streamed so progress can be reported in real bytes; the result
 * is still one buffer, because the MST walk needs random access to blocks.
 *
 * @param {string} pds   PDS base URL, no trailing slash.
 * @param {string} did
 * @param {{since?: string|null, signal?: AbortSignal,
 *          onProgress?: (p:{bytes:number, total:number|null}) => void}} opts
 * @returns {Promise<Uint8Array>}
 */
export async function fetchRepoCar(pds, did, { since = null, signal, onProgress } = {}) {
  const params = new URLSearchParams({ did });
  if (since) params.set('since', since);
  const res = await fetch(`${pds}/xrpc/com.atproto.sync.getRepo?${params}`, { signal });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from getRepo${since ? ' (since diff)' : ''}`);
    err.status = res.status;
    throw err;
  }
  const total = Number(res.headers.get('content-length')) || null;
  if (!res.body?.getReader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.({ bytes: buf.byteLength, total: total ?? buf.byteLength });
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.byteLength;
    onProgress?.({ bytes, total });
  }
  const buf = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buf;
}

/**
 * Parse a repo CAR into records: index the blocks, decode the commit the
 * root names, walk the MST recovering the prefix-compressed
 * `collection/rkey` paths, and decode every record block that is present.
 *
 * Yields to the event loop as it goes — a full parse touches ~150k blocks
 * and must not freeze the tab it runs in.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{did:string, rev:string,
 *          entries:Array<{uri:string, collection:string, rkey:string, record:object}>}>}
 */
export async function readRepoCar(bytes) {
  const { car, cbor, cid } = await atcute();

  let ops = 0;
  const breathe = async () => {
    if (++ops % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
  };
  const linkKey = (link) => (link && typeof link.$link === 'string' ? link.$link : String(link));

  const reader = car.fromUint8Array(bytes);
  const blocks = new Map();
  for (const entry of reader) {
    blocks.set(cid.toString(entry.cid), entry.bytes);
    await breathe();
  }

  const root = reader.roots[0];
  if (!root) throw new Error('CAR has no root');
  const commitBytes = blocks.get(linkKey(root));
  if (!commitBytes) throw new Error('CAR root block missing');
  const commit = cbor.decode(commitBytes);
  if (!commit?.did || !commit?.rev || !commit?.data) throw new Error('CAR root is not a repo commit');

  // MST keys are byte strings; decode() hands them back as a Bytes wrapper.
  const keyBytes = (k) => (k instanceof Uint8Array ? k : cbor.fromBytes(k));
  const td = new TextDecoder();

  const paths = []; // { key, link }
  async function walk(link) {
    if (!link) return;
    const nodeBytes = blocks.get(linkKey(link));
    if (!nodeBytes) return; // diff CAR: unchanged subtree, already held
    await breathe();
    const node = cbor.decode(nodeBytes);
    await walk(node.l);
    let prevKey = '';
    for (const e of node.e || []) {
      const key = prevKey.slice(0, e.p) + td.decode(keyBytes(e.k));
      prevKey = key;
      paths.push({ key, link: e.v });
      await walk(e.t);
    }
  }
  await walk(commit.data);

  const entries = [];
  for (const { key, link } of paths) {
    const recordBytes = blocks.get(linkKey(link));
    if (!recordBytes) continue; // diff CAR: unchanged record, already held
    await breathe();
    const slash = key.indexOf('/');
    if (slash <= 0) continue;
    entries.push({
      uri: `at://${commit.did}/${key}`,
      collection: key.slice(0, slash),
      rkey: key.slice(slash + 1),
      record: cbor.decode(recordBytes),
    });
  }
  return { did: commit.did, rev: commit.rev, entries };
}

/**
 * One repo entry → one atmosphere row `{uri, collection, at}`, or null when
 * the record cannot be dated. The rkey TID wins — minted at creation and
 * immune to a backdated createdAt — then the record's own timestamps, most
 * intentional first. `connectedAt` earns its place by measurement: 9,675
 * arena-mirror connections (8% of the live repo) carry it and nothing else,
 * and it is when the connection actually happened on are.na, which is what
 * an activity chart should date it by. With the chain below, the genuinely
 * undatable remainder of the live repo is ~14 singleton records.
 */
export function atmosphereRowFromEntry(entry) {
  if (!entry?.uri || !entry.collection) return null;
  const value = entry.record || {};
  const at = Date.parse(
    tidToTimestamp(entry.rkey) ||
      value.createdAt ||
      value.connectedAt ||
      value.publishedAt ||
      value.updatedAt ||
      '',
  );
  if (!Number.isFinite(at)) return null;
  return { uri: entry.uri, collection: entry.collection, at };
}
