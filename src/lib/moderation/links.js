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
export function ownLinkFacets(text) {
  const s = String(text ?? '');
  const enc = new TextEncoder();
  const facets = [];
  for (const m of s.matchAll(OWN_LINK)) {
    const byteStart = enc.encode(s.slice(0, m.index)).length;
    const byteEnd = byteStart + enc.encode(m[0]).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }],
    });
  }
  return facets;
}
