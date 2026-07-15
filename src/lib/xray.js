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
