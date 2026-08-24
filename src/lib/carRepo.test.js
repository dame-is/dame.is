// Round-trip invariants for the repo CAR reader. The fixtures are REAL CARs —
// built with the same @atcute encoders the atproto ecosystem uses, with real
// content-addressed CIDs — so what these tests pin is the actual wire format:
// the MST walk, its prefix-compressed keys, and the diff-CAR contract that a
// missing block means "unchanged, already held" rather than an error.

import { describe, expect, it } from 'vitest';
import { writeCarStream } from '@atcute/car';
import { encode, toBytes } from '@atcute/cbor';
import { create as createCid, toCidLink } from '@atcute/cid';
import { atmosphereRowFromEntry, readRepoCar } from './carRepo.js';
import { tidToTimestamp } from './atproto.js';

const DID = 'did:plc:carfixture';

/** Mint a real TID for a timestamp — same encoding tidToTimestamp reads. */
const B32 = '234567abcdefghijklmnopqrstuvwxyz';
function tidFor(ms) {
  let n = ((BigInt(Math.floor(ms)) * 1000n) << 10n) | 5n;
  let s = '';
  for (let i = 0; i < 13; i++) {
    s = B32[Number(n & 31n)] + s;
    n >>= 5n;
  }
  return s;
}

const te = new TextEncoder();

/** Encode a value, hash it into a real CID, return both. */
async function block(value) {
  const bytes = encode(value);
  const cid = await createCid(113, bytes);
  return { cid, bytes };
}

/**
 * Build a tiny but honest repo CAR: records, ONE MST node with
 * prefix-compressed keys (each entry stores how many bytes it shares with
 * the key before it), and a signed-shaped commit as the root.
 *
 * @param {Array<[key: string, record: object]>} records  MUST be key-sorted.
 * @param {{omit?: string}} opts  Leave one key's record block out of the CAR
 *                                (the diff-CAR case).
 */
async function buildRepoCar(records, { omit = null, rev = '3mttfixture22' } = {}) {
  const recordBlocks = new Map(); // key → {cid, bytes}
  for (const [key, value] of records) recordBlocks.set(key, await block(value));

  let prevKey = '';
  const entries = records.map(([key]) => {
    let p = 0;
    while (p < key.length && p < prevKey.length && key[p] === prevKey[p]) p++;
    prevKey = key;
    return { p, k: toBytes(te.encode(key.slice(p))), v: toCidLink(recordBlocks.get(key).cid), t: null };
  });
  const mst = await block({ l: null, e: entries });
  const commit = await block({
    did: DID,
    version: 3,
    data: toCidLink(mst.cid),
    rev,
    prev: null,
    sig: toBytes(new Uint8Array(64)),
  });

  const blocks = [
    { cid: commit.cid.bytes, data: commit.bytes },
    { cid: mst.cid.bytes, data: mst.bytes },
    ...records
      .filter(([key]) => key !== omit)
      .map(([key]) => ({ cid: recordBlocks.get(key).cid.bytes, data: recordBlocks.get(key).bytes })),
  ];
  const chunks = [];
  for await (const chunk of writeCarStream([toCidLink(commit.cid)], blocks)) chunks.push(chunk);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const NOW = Date.parse('2026-06-20T12:00:00.000Z');
const likeKey = `app.bsky.feed.like/${tidFor(NOW - 86_400_000)}`;
const postKey = `app.bsky.feed.post/${tidFor(NOW)}`;
const FIXTURE = [
  // Key-sorted, with real shared prefixes for the compression to bite on.
  [likeKey, { $type: 'app.bsky.feed.like', subject: { uri: 'at://did:plc:them/app.bsky.feed.post/x' }, createdAt: new Date(NOW - 86_400_000).toISOString() }],
  [postKey, { $type: 'app.bsky.feed.post', text: 'hello car', createdAt: new Date(NOW).toISOString() }],
  ['is.dame.page/about', { $type: 'is.dame.page', title: 'About', createdAt: new Date(NOW).toISOString() }],
];

describe('readRepoCar', () => {
  it('recovers every record with its collection and rkey, plus the rev', async () => {
    const car = await buildRepoCar(FIXTURE);
    const { did, rev, entries } = await readRepoCar(car);
    expect(did).toBe(DID);
    expect(rev).toBe('3mttfixture22');
    expect(entries.map((e) => `${e.collection}/${e.rkey}`)).toEqual(FIXTURE.map(([k]) => k));
    expect(entries[1].record.text).toBe('hello car');
    expect(entries[1].uri).toBe(`at://${DID}/${postKey}`);
    // The prefix-compressed key round-tripped — entry 2 shares 14 bytes
    // ('app.bsky.feed.') with entry 1 and must still come back whole.
    expect(entries[1].collection).toBe('app.bsky.feed.post');
  });

  it('treats a missing record block as "already held", exactly as a diff CAR needs', async () => {
    const car = await buildRepoCar(FIXTURE, { omit: likeKey });
    const { entries } = await readRepoCar(car);
    expect(entries.map((e) => `${e.collection}/${e.rkey}`)).toEqual([postKey, 'is.dame.page/about']);
  });

  it('refuses bytes that are not a repo CAR', async () => {
    await expect(readRepoCar(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});

describe('atmosphereRowFromEntry', () => {
  it('dates by rkey TID first, record createdAt second, and drops the undatable', async () => {
    const car = await buildRepoCar(FIXTURE);
    const { entries } = await readRepoCar(car);

    const post = atmosphereRowFromEntry(entries.find((e) => e.collection === 'app.bsky.feed.post'));
    expect(post.at).toBe(Date.parse(tidToTimestamp(postKey.split('/')[1])));
    expect(post.collection).toBe('app.bsky.feed.post');

    // Name-keyed record: no TID to read, so createdAt carries it.
    const page = atmosphereRowFromEntry(entries.find((e) => e.collection === 'is.dame.page'));
    expect(page.at).toBe(NOW);

    expect(atmosphereRowFromEntry({ uri: 'at://x/c/self', collection: 'c', rkey: 'self', record: {} })).toBeNull();
  });

  it('reads the arena mirror’s connectedAt when a record has no other date', () => {
    // 9,675 records on the live repo — 8% of it — carry connectedAt alone.
    const row = atmosphereRowFromEntry({
      uri: 'at://did:plc:me/is.dame.arena.mirror.connection/12345',
      collection: 'is.dame.arena.mirror.connection',
      rkey: '12345',
      record: { connectedAt: '2026-06-01T00:00:00.000Z' },
    });
    expect(row.at).toBe(Date.parse('2026-06-01T00:00:00.000Z'));
  });
});
