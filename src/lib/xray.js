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

/**
 * A compact, ordered field map for a record value: `[{ path, value }]`.
 * Top-level keys only, formatted to a single short line each, capped at
 * `max`. `$type` is surfaced first when present (it names the lexicon).
 */
export function substrateFields(value, max = 5) {
  if (!value || typeof value !== 'object') return [];
  const out = [];
  const push = (key) => {
    if (out.length >= max) return;
    if (!(key in value)) return;
    out.push({ path: `value.${key}`, value: formatFieldValue(value[key]) });
  };

  if (typeof value.$type === 'string') {
    out.push({ path: 'value.$type', value: value.$type });
  }
  // A friendly priority so the most telling fields lead, then fill from the rest.
  const priority = [
    'text', 'status', 'title', 'name', 'displayName', 'trackName', 'artistName',
    'scientificName', 'subject', 'createdAt', 'publishedAt', 'playedTime', 'observedAt',
  ];
  for (const key of priority) push(key);
  for (const key of Object.keys(value)) {
    if (key === '$type') continue;
    push(key);
  }
  return out.slice(0, max);
}

/** Format one field value to a short single-line string for the substrate view. */
export function formatFieldValue(v) {
  if (v == null) return String(v);
  if (typeof v === 'string') {
    const s = v.trim().replace(/\s+/g, ' ');
    const quoted = /^(at:\/\/|did:|https?:\/\/)/.test(s) ? s : `"${s}"`;
    return quoted.length > 48 ? `${quoted.slice(0, 47)}…` : quoted;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every((x) => typeof x === 'string')) {
      const joined = JSON.stringify(v);
      return joined.length > 40 ? `[${v.length} items]` : joined;
    }
    return `[${v.length} items]`;
  }
  if (typeof v === 'object') {
    if (typeof v.$type === 'string') return `{ ${v.$type} }`;
    if (typeof v.uri === 'string') return v.uri.length > 44 ? `${v.uri.slice(0, 43)}…` : v.uri;
    const keys = Object.keys(v);
    return keys.length ? `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }` : '{}';
  }
  return String(v);
}

/**
 * The depth stack for a record — the layers you're looking down through, from
 * the pixels on screen to the PDS the record lives on. `{ handle, pds }` are
 * optional decorations. Returns `[{ lead, key, value }]`, indentation baked in.
 */
export function depthStack(atUri, { handle, pds, leadField } = {}) {
  const { did, collection, rkey } = parseAtUri(atUri);
  const rows = [];
  rows.push({ lead: '', key: leadField ? '◦ the element you tapped' : '◦ this view', value: '' });
  if (leadField) rows.push({ lead: ' └ ', key: leadField, value: '' });
  const base = leadField ? '   ' : ' ';
  rows.push({ lead: `${base}└ `, key: 'record', value: rkey || '' });
  rows.push({ lead: `${base}  └ `, key: 'collection', value: collection || '' });
  rows.push({ lead: `${base}    └ `, key: 'repo', value: handle ? `@${handle}` : shortenDid(did) });
  rows.push({ lead: `${base}      └ `, key: 'pds', value: pds || '…' });
  return rows;
}
