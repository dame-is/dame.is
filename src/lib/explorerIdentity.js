// Repo identity for the atproto explorer (/exploring), plus the two bits of
// input/output handling around it: turning what someone typed into a route, and
// turning a failed fetch into a sentence.
//
// Why a cache: every level of the explorer is its own <Route>, and the route
// transition keys on the pathname, so going repo → collection → record remounts
// the page each time. Without a memory of the last resolve, every click blanked
// the page behind "Resolving dame.is…" and re-ran handle → DID → PDS →
// describeRepo before the thing actually clicked on could even start loading.
// Identity barely moves — a handle change is rare and a PDS migration rarer —
// so a few minutes of memory costs nothing a visitor would notice.

import {
  describeRepo,
  explorerPathFromAtUri,
  resolveHandle,
  resolvePds,
} from './atproto.js';

const IDENTITY_TTL_MS = 5 * 60_000;

/** key (lowercased handle, or DID) → { identity, ts } */
const _identityCache = new Map();
/** key → in-flight resolve, so two mounts racing share one request chain. */
const _inflight = new Map();

function cacheKey(input) {
  const s = String(input || '')
    .trim()
    .replace(/^@/, '');
  // Handles are case-insensitive; DIDs are compared as written.
  return s.startsWith('did:') ? s : s.toLowerCase();
}

/**
 * The identity a recent resolve found for `input`, or null. Synchronous, so the
 * explorer can paint a repo it has already seen without a placeholder frame.
 */
export function peekRepoIdentity(input) {
  const hit = _identityCache.get(cacheKey(input));
  if (!hit) return null;
  if (Date.now() - hit.ts > IDENTITY_TTL_MS) {
    _identityCache.delete(cacheKey(input));
    return null;
  }
  return hit.identity;
}

/**
 * Resolve a handle or DID to `{ did, handle, claimedHandle, pds, collections }`.
 * Throws when the repo can't be found or reached.
 *
 * `handle` is only set when describeRepo vouches for it (`handleIsCorrect`). A
 * repo can claim a handle that no longer resolves back to it, and every link
 * the explorer builds addresses the repo by `handle || did` — so trusting the
 * claim meant a broken-handle repo could be browsed exactly until the first
 * click. The claim is kept as `claimedHandle` for display.
 *
 * `collections` is describeRepo's list (sorted), or null when that call failed;
 * the collections views use it instead of asking again.
 */
export async function resolveRepoIdentity(input) {
  const key = cacheKey(input);
  if (!key) throw new Error('Enter a handle or a DID.');
  const cached = peekRepoIdentity(key);
  if (cached) return cached;
  if (_inflight.has(key)) return _inflight.get(key);

  const run = (async () => {
    const did = key.startsWith('did:') ? key : await resolveHandle(key);
    if (!did) throw new Error(`Could not resolve handle ${key}`);
    const pds = await resolvePds(did);
    let desc = null;
    try {
      desc = await describeRepo(pds, did);
    } catch {
      // Non-fatal: the repo can still be browsed by DID.
    }
    const claimedHandle = typeof desc?.handle === 'string' ? desc.handle : null;
    const identity = {
      did,
      handle:
        claimedHandle && desc.handleIsCorrect !== false ? claimedHandle : null,
      claimedHandle,
      pds,
      collections: Array.isArray(desc?.collections)
        ? [...desc.collections].sort()
        : null,
    };
    const entry = { identity, ts: Date.now() };
    _identityCache.set(key, entry);
    _identityCache.set(did, entry);
    if (identity.handle)
      _identityCache.set(identity.handle.toLowerCase(), entry);
    return identity;
  })();

  _inflight.set(key, run);
  try {
    return await run;
  } finally {
    _inflight.delete(key);
  }
}

/** Forget every cached identity. For tests. */
export function clearRepoIdentityCache() {
  _identityCache.clear();
  _inflight.clear();
}

/**
 * Repo path segments carry colons (DIDs) and dots (handles). Both are safe in a
 * path segment unencoded, and encoding `:` would make DID URLs unreadable, so
 * only the characters that would end the path are escaped.
 */
export function encodeRepoSegment(input) {
  return String(input || '').replace(/[?#]/g, encodeURIComponent);
}

/**
 * Where the explorer's lookup box should go for what was typed: a handle (with
 * or without its `@`), a DID, or an at:// URI at any depth — a repo, a
 * collection, or a record. Returns null for input that names nothing.
 */
export function explorerSearchPath(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  // Every depth of at:// URI, not just a full record address. Treated as a
  // bare handle, `at://dame.is` became the path `/exploring/at://dame.is`,
  // which the router collapses to a repo named `at:`.
  if (/^at:\/\//i.test(v))
    return explorerPathFromAtUri(v.replace(/^at:\/\//i, 'at://'));
  const repo = v.replace(/^@/, '');
  return repo ? `/exploring/${encodeRepoSegment(repo)}` : null;
}

/**
 * A failed explorer fetch, as a sentence a visitor can act on plus the raw text
 * for anyone who wants it. The raw message from atproto.js carries the full
 * request URL and the first 200 bytes of the response body — useful, but not
 * something to lead with.
 *
 *   kind: 'repo' | 'collection' | 'record' | 'plc'   — what was being loaded
 *   subject: the handle, NSID or rkey, for the copy
 */
export function explainExplorerError(err, { kind, subject } = {}) {
  const detail = err?.message || String(err ?? '');
  const status = typeof err?.status === 'number' ? err.status : null;
  const named = subject ? `“${subject}”` : null;

  let message;
  if (
    status === 400 ||
    status === 404 ||
    /could not resolve handle|no pds endpoint/i.test(detail)
  ) {
    switch (kind) {
      case 'repo':
        message = named
          ? `Couldn’t find a repo for ${named}.`
          : 'Couldn’t find that repo.';
        break;
      case 'collection':
        message = named
          ? `Couldn’t list ${named} on this repo.`
          : 'Couldn’t list that collection.';
        break;
      case 'record':
        message =
          'There’s no record at this address. It may have been deleted.';
        break;
      case 'plc':
        message = 'The PLC directory has no entry for this DID.';
        break;
      default:
        message = 'Not found.';
    }
  } else if (status && status >= 500) {
    message = 'The server had a problem answering. Try again in a moment.';
  } else if (!status && isNetworkError(err)) {
    message = 'Couldn’t reach the server. Try again in a moment.';
  } else {
    message = 'Something went wrong loading this.';
  }
  return { message, detail };
}

function isNetworkError(err) {
  const name = err?.name;
  return (
    name === 'TypeError' || name === 'AbortError' || name === 'TimeoutError'
  );
}
