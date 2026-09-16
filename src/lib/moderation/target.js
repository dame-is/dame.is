// Turn whatever you pasted into an at:// URI.
//
// The moderation tool's front door takes a link from wherever you were when you
// decided to look: the Bluesky app, one of the forks, a waypoint, an aturi.to
// page, or an at:// URI copied out of a record viewer. All of them name the same
// post; only the last one names it in the form every downstream call needs.
//
// The client forks matter more than they look. bsky.app, deer.social, zeppelin,
// and the rest all serve the SAME `/profile/<actor>/post/<rkey>` shape, because
// they are all reading the same AppView — so this matches on the PATH and
// ignores the host entirely rather than keeping a list of domains that goes
// stale every time someone ships a new client. A host allowlist would reject a
// fork that shipped this morning; a path match will not.
//
// Handle-form links (`/profile/dame.is/post/abc`) carry a handle, not a DID, and
// a handle is a rented name — whoever holds it today is who the link resolves
// to. That is fine for a link you just copied and wrong for anything stored, so
// resolution happens HERE, once, at the edge, and everything downstream carries
// the DID.

import { APPVIEW } from '../../config.js';

/** `/profile/<actor>/post/<rkey>`, on any host, with or without trailing junk. */
const WEB_POST = /\/profile\/([^/?#]+)\/post\/([^/?#]+)/;

/** A bare at:// URI, with the collection left open so non-post targets parse. */
const AT_URI = /^at:\/\/(did:[^/]+)\/([^/]+)\/([^/?#]+)/;

/** `did:plc:...` / `did:web:...` — anything else is a handle. */
const DID = /^did:[a-z]+:/;

export class TargetError extends Error {}

/**
 * Resolve a handle to a DID through the AppView.
 *
 * Throws rather than returning null: a handle that will not resolve is a dead
 * link, and the caller pasted it deliberately, so silence would be the wrong
 * answer.
 */
export async function resolveHandle(handle, { fetchImpl = fetch } = {}) {
  const url = `${APPVIEW}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  } catch (cause) {
    throw new TargetError(`could not reach the AppView to resolve ${handle}`, {
      cause,
    });
  }
  if (!res.ok) throw new TargetError(`no account found for handle ${handle}`);
  const body = await res.json();
  if (!body?.did) throw new TargetError(`no DID in the response for ${handle}`);
  return body.did;
}

/**
 * Parse a pasted reference into `{ uri, did, collection, rkey }`.
 *
 * Accepts:
 *   at://did:plc:xxx/app.bsky.feed.post/3abc
 *   https://bsky.app/profile/dame.is/post/3abc      (and every fork)
 *   https://deer.social/profile/did:plc:xxx/post/3abc
 *
 * A waypoint href is NOT handled here — it can name several records at once, so
 * it resolves through `src/lib/waypoints.js` first and each result comes back
 * through this function individually.
 *
 * @param {string} input
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function resolveTarget(input, opts = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new TargetError('nothing to resolve');

  const at = raw.match(AT_URI);
  if (at) {
    const [, did, collection, rkey] = at;
    return { uri: `at://${did}/${collection}/${rkey}`, did, collection, rkey };
  }

  const web = raw.match(WEB_POST);
  if (web) {
    const [, actor, rkey] = web;
    const did = DID.test(actor)
      ? actor
      : await resolveHandle(decodeURIComponent(actor), opts);
    const collection = 'app.bsky.feed.post';
    return { uri: `at://${did}/${collection}/${rkey}`, did, collection, rkey };
  }

  throw new TargetError(
    'not a post link or at:// URI — paste a post URL from any Bluesky client, or the at:// URI itself',
  );
}

/**
 * True when `input` looks like something `resolveTarget` can take.
 *
 * Cheap and synchronous, for deciding whether a DM or a form field is a target
 * at all before spending a handle resolution on it. A `true` here is not a
 * promise that the record exists.
 */
export function looksLikeTarget(input) {
  const raw = String(input ?? '').trim();
  return AT_URI.test(raw) || WEB_POST.test(raw);
}

/**
 * Pull every candidate target out of a free-text message.
 *
 * The DM interface gets prose with a link somewhere in it ("what's the deal with
 * this one <url>"), so the message is scanned rather than parsed. Returns the
 * matched substrings in the order they appear, deduplicated, for the caller to
 * resolve.
 */
export function extractTargets(text) {
  const found = [];
  const seen = new Set();
  for (const token of String(text ?? '').split(/\s+/)) {
    const cleaned = token.replace(/[),.]+$/, '');
    if (!looksLikeTarget(cleaned) || seen.has(cleaned)) continue;
    seen.add(cleaned);
    found.push(cleaned);
  }
  return found;
}

/**
 * An actor reference (handle or DID) as a DID.
 *
 * Scoring is keyed by DID throughout — `score()` looks profiles up by the exact
 * string it was handed, so a handle passed straight in comes back as an
 * unresolved account rather than an error. Anything taking user input resolves
 * here first.
 */
export async function resolveActor(actor, opts = {}) {
  const raw = String(actor ?? '')
    .trim()
    .replace(/^@/, '');
  if (!raw) throw new TargetError('nothing to resolve');
  if (DID.test(raw)) return raw;
  return resolveHandle(raw, opts);
}
