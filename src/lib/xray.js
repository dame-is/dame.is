// Helpers for the atmosphere x-ray mode — turning a record's AT URI and value
// into the compact "substrate" a revealed element shows: the address (with its
// collection highlighted), the content hash, a short field map, and the
// pixel → field → record → collection → repo → PDS depth stack.
//
// All pure + framework-free so the reveal components, the ledger row, and the
// reticule can share one vocabulary.

/** Split an AT URI into `{ did, collection, rkey }` (any part may be null). */
export function parseAtUri(atUri) {
  const m = String(atUri || '').match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  if (!m) return { did: null, collection: null, rkey: null };
  return { did: m[1], collection: m[2], rkey: m[3] };
}

/** `did:plc:gq4fo3u6tqzzdkjlwzpb23tj` → `did:plc:gq4f…23tj` (handles + web DIDs pass through short). */
export function shortenDid(did) {
  const s = String(did || '');
  if (!s.startsWith('did:plc:')) return s;
  const key = s.slice('did:plc:'.length);
  if (key.length <= 10) return s;
  return `did:plc:${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** A CID trimmed for a one-line cell: `bafyreib7q…q4a`. */
export function shortenCid(cid) {
  const s = String(cid || '');
  if (s.length <= 14) return s;
  return `${s.slice(0, 9)}…${s.slice(-3)}`;
}

/**
 * The blob under a picture or a video in a post, for x-ray's plate over it:
 * `{ cid, mimeType, size }`. The record's own blob ref says all three. Without
 * one (an AppView view with no record beside it), the CID is read out of the
 * CDN URL, whose path carries it, and the type and size stay unknown. Null
 * when neither names a blob.
 */
export function blobFacts(blob, url) {
  const ref = blob?.ref;
  const cid =
    (typeof ref?.$link === 'string' && ref.$link) ||
    // The legacy blob shape, `{ cid, mimeType }`.
    (typeof blob?.cid === 'string' && blob.cid) ||
    cidFromUrl(url);
  if (!cid) return null;
  return {
    cid,
    mimeType: typeof blob?.mimeType === 'string' ? blob.mimeType : null,
    size: Number.isFinite(blob?.size) ? blob.size : null,
  };
}

/** The CIDv1 a CDN path carries: `…/plain/did:plc:…/bafkrei…@jpeg`, `…/watch/did:plc:…/bafkrei…/thumbnail.jpg`. */
function cidFromUrl(url) {
  const m = /\/(baf[a-z2-7]{20,})(?=[@/?#]|$)/.exec(String(url || ''));
  return m ? m[1] : null;
}

/** Indices as runs, for a field path: `[7, 8, 9, 12]` → `7–9, 12`. */
export function indexSpans(indices) {
  const sorted = [...new Set(indices)].filter(Number.isInteger).sort((a, b) => a - b);
  const runs = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
}

/** `1768328` → `1.8 MB`, `48213` → `48 kB`, in decimal units. */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${Math.round(n / 1000)} kB`;
  return `${(n / 1e6).toFixed(1)} MB`;
}

/**
 * The AT URI broken into display segments so the collection (nsid) can be
 * highlighted inside it: `at://<did>/<nsid>/<rkey>`, with the DID shortened.
 * Returns `{ prefix, nsid, rkey }` where prefix is `at://<shortDid>/`.
 */
export function atUriParts(atUri) {
  const { did, collection, rkey } = parseAtUri(atUri);
  if (!collection) return null;
  return {
    prefix: `at://${shortenDid(did)}/`,
    nsid: collection,
    rkey: rkey ? `/${rkey}` : '',
  };
}

/**
 * The attributes that make an element a record in x-ray's eyes: the row and
 * HUD machinery read `data-atproto` / `data-at-uri`, and `data-xray-nsid`
 * prints the collection beside an inline record (the chrome's live signals,
 * the hero's phrases) as a dotted-underlined gloss. Empty for no URI.
 */
export function xrayRecordAttrs(atUri) {
  const m = /^at:\/\/[^/]+\/([^/]+)\//.exec(String(atUri || ''));
  if (!m) return {};
  return { 'data-atproto': '', 'data-at-uri': atUri, 'data-xray-nsid': m[1] };
}

/** For a signal that isn't a record: x-ray says so, and says what it is. */
export function xrayNotARecord(what) {
  return { 'data-xray-note': `not a record · ${what}` };
}

/**
 * What a reference record points at, for the x-ray tree's subject level:
 * `{ uri, cid, handle }`, or null when the record isn't a reference (or
 * points at an account rather than a record). Reads the feed payload's
 * `subjectUri` / `subjectCid` (reposts) or a raw `subject` strong ref (likes).
 */
export function subjectOfRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const ref = value.subjectRef || (typeof value.subject === 'object' ? value.subject : null);
  const uri = value.subjectUri || ref?.uri || null;
  if (!uri || !String(uri).startsWith('at://')) return null;
  const { did } = parseAtUri(uri);
  const handle = value.author?.did && value.author.did === did ? value.author.handle || null : null;
  return { uri, cid: value.subjectCid || ref?.cid || null, handle };
}

/**
 * A page's records counted by collection, most numerous first:
 * `{ total, collections: [{ nsid, did, count }] }`. A record shown twice
 * (a pinned post that's also in the feed) counts once.
 */
export function recordCensus(uris) {
  const seen = new Set();
  const byKey = new Map();
  for (const uri of uris || []) {
    if (!uri || seen.has(uri)) continue;
    const { did, collection } = parseAtUri(uri);
    if (!collection) continue;
    seen.add(uri);
    const key = `${did}/${collection}`;
    const entry = byKey.get(key) || { nsid: collection, did, count: 0 };
    entry.count += 1;
    byKey.set(key, entry);
  }
  const collections = [...byKey.values()].sort((a, b) => b.count - a.count || a.nsid.localeCompare(b.nsid));
  return { total: seen.size, collections };
}

/** "60 records in 4 collections", "1 record", "no records". */
export function censusLine({ total, collections }) {
  if (!total) return 'no records on this page';
  const nsids = new Set(collections.map((c) => c.nsid)).size;
  const records = `${total.toLocaleString('en-US')} ${total === 1 ? 'record' : 'records'}`;
  if (nsids <= 1) return `${records} in ${collections[0].nsid}`;
  return `${records} in ${nsids} collections`;
}
