// Deep links from a DM into the portal.
//
// The DM and the portal do different halves of the same job: one is where a
// decision gets made in seconds, the other is where a corpus gets read. A link
// is the seam between them, and without one the seam is "go and find it", which
// on a phone means not going.
//
// WHY THE FACET MATCHER IS SCOPED TO OUR OWN ADMIN URLS. A general "linkify any
// URL in the text" pass would eventually put a facet on a URL that came out of
// somebody else's bio or post, because the analyst quotes those. A link facet is
// less dangerous than a mention facet -- nobody gets notified -- but it would
// still mean this account hand-rendering a stranger's link as tappable inside a
// moderation report about them. These links are generated here, from values this
// codebase computed, and nothing else matches.

/** Where the portal lives. */
export const SITE = 'https://dame.is';

/**
 * A link into one surface of the moderation hub.
 *
 * Query params rather than path segments because that is what the admin route
 * already is, for a reason documented there: Vercel treats a path segment
 * containing dots as a static file, and this admin browses arbitrary NSIDs.
 */
export function adminUrl(params = {}) {
  const q = new URLSearchParams({ view: 'moderation' });
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  }
  return `${SITE}/admin?${q}`;
}

/** One plan, optionally already filtered to what the message was about. */
export function planLink(code, { label, band, state } = {}) {
  return adminUrl({ tab: 'plans', code, label, band, state });
}

/** Why one account is on the list. */
export function whyLink(actor) {
  return adminUrl({ tab: 'why', actor: String(actor ?? '').replace(/^@/, '') });
}

/** The list itself. */
export function listLink() {
  return adminUrl({ tab: 'list' });
}

/**
 * The bsky.app URL for an at:// post URI.
 *
 * A plan's source is stored as an at:// URI because that is what identifies a
 * record, and it is unreadable as an answer to "what was this batch about".
 * Returns null rather than a broken link for anything that is not a post.
 */
export function postWebUrl(atUri, { handle = null } = {}) {
  const m = /^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/.exec(
    String(atUri ?? ''),
  );
  if (!m) return null;
  // A handle when there is one, because a link in a DM is read by a person and
  // `bsky.app/profile/did:plc:3guzz.../post/...` tells them nothing about whose
  // post they are about to open. Handles are rented and a DID is not, so this
  // is the wrong trade for anything stored and the right one for a link that
  // gets tapped within the hour.
  //
  // Constrained to the DNS shape a handle actually is, so nothing that could
  // carry a path separator or a query gets rendered into a URL this account
  // then marks as tappable.
  const who = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/i.test(
    String(handle ?? ''),
  )
    ? String(handle).toLowerCase()
    : m[1];
  return `https://bsky.app/profile/${who}/post/${m[2]}`;
}

/** The account in a bsky.app post URL this module built. */
export function handleInPostUrl(url) {
  const m = /^https:\/\/bsky\.app\/profile\/([^/]+)\/post\/[^/?#]+$/.exec(
    String(url ?? ''),
  );
  return m ? m[1] : null;
}

/** Matches only links this module builds. */
const OWN_LINK = /https:\/\/dame\.is\/admin\?[^\s)\]]+/g;

/**
 * Link facets for our own admin URLs in a message.
 *
 * atproto counts facet ranges in UTF-8 BYTES, not JS string indices, so an
 * emoji or an accented handle earlier in the message shifts every offset after
 * it. TextEncoder rather than Buffer so this file stays importable in the
 * browser, which everything under src/ has to be.
 */
export function ownLinkFacets(text, { allow = [] } = {}) {
  const s = String(text ?? '');
  const enc = new TextEncoder();
  const facets = [];

  // An EXACT-MATCH ALLOWLIST, not a second pattern.
  //
  // A digest cites posts, and a bsky.app URL this codebase built out of an
  // at:// URI is indistinguishable by shape from one the analyst copied out of
  // a stranger's post text -- which is the failure the comment at the top of
  // this file is about. So the caller passes the exact URLs it built, from the
  // URIs the digest tool actually returned, and nothing else is matched. The
  // set is per message and computed from a tool result, never from prose.
  const exact = [...new Set(allow.filter(Boolean).map(String))];
  const patterns = [OWN_LINK];
  if (exact.length) {
    patterns.push(
      new RegExp(
        exact.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
        'g',
      ),
    );
  }

  for (const m of patterns.flatMap((re) => [...s.matchAll(re)])) {
    const byteStart = enc.encode(s.slice(0, m.index)).length;
    const byteEnd = byteStart + enc.encode(m[0]).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }],
    });
  }
  // Two passes over one string produce facets out of order, and a range that
  // overlaps another is a record the server is entitled to reject.
  return facets
    .sort((a, b) => a.index.byteStart - b.index.byteStart)
    .filter(
      (f, i, all) => i === 0 || f.index.byteStart >= all[i - 1].index.byteEnd,
    );
}
