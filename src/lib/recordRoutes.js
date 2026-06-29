// Mapping between gerund verbs, AT Protocol lexicon NSIDs, and the routes
// that render a single record from each. The verb-side surface is derived
// from `verbRegistry.js` so adding a new verb / NSID there is enough.
//
// Some legacy bookkeeping is preserved here for verbs that have a
// human-friendly path with a slug (`/blogging/:slug`, `/creating/:slug`)
// instead of the generic `/{nsid}/{rkey}` form.

import {
  VERB_REGISTRY,
  primaryNsid,
  NSIDS,
  VERB_LABELS as REGISTRY_LABELS,
} from './verbRegistry.js';
import { COLLECTIONS } from '../config.js';

/**
 * Verb → primary collection (NSID). For multi-source verbs (e.g. blogging,
 * which spans site.standard.document + pub.leaflet.document + …) this is
 * the first collection in the registry, used as the default for routes
 * like `/blogging/:rkey` that don't specify a source.
 */
export const VERB_TO_COLLECTION = Object.fromEntries(
  VERB_REGISTRY.map((v) => [v.verb, primaryNsid(v.verb)]).filter(([, n]) => n),
);

// A repost record on Dame's PDS lives at `app.bsky.feed.repost`, but the
// page actually *renders* the original post (the repost record's only
// payload is a pointer). The on-site URL form `/reposting/{rkey}` uses
// the *original post's* rkey because that's what the home feed snapshot
// is keyed by — we don't snapshot Dame's repost records directly.
VERB_TO_COLLECTION.reposting = 'app.bsky.feed.post';

/**
 * Inverse of VERB_TO_COLLECTION — collection → verb. For NSIDs that are
 * shared across verbs, the registry's first matching verb wins (so an
 * `app.bsky.feed.post` URI resolves to `posting`, not `reposting`).
 */
export const COLLECTION_TO_VERB = (() => {
  const out = {};
  for (const v of VERB_REGISTRY) {
    for (const c of v.collections) {
      if (!out[c.nsid]) out[c.nsid] = v.verb;
    }
  }
  return out;
})();

/**
 * The full set of route segments (verb + NSID) that resolve to the single
 * record page. Used both by the React router and by `useAtUri`.
 */
export const RECORD_ROUTE_SEGMENTS = [
  ...VERB_REGISTRY.map((v) => v.verb),
  ...NSIDS,
];

/**
 * Canonical "short" URL for a record — the verb-based form. Used for
 * timestamp links inside feed cards.
 *
 *   recordPath('posting', '3mlo67tnypc2u') → '/posting/3mlo67tnypc2u'
 */
export function recordPath(verb, rkey) {
  if (!verb || !rkey) return null;
  return `/${verb}/${encodeURIComponent(rkey)}`;
}

/**
 * Same as `recordPath` but takes an at:// URI. Returns null if the URI
 * isn't a record we know how to display.
 */
export function recordPathFromAtUri(atUri) {
  if (!atUri) return null;
  const m = String(atUri).match(/^at:\/\/[^/]+\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const [, collection, rkey] = m;
  // Leaflet docs ride the same /blogging route as our own posts, just
  // addressed by rkey instead of slug.
  if (collection === COLLECTIONS.leaflet) return recordPath('blogging', rkey);
  const verb = COLLECTION_TO_VERB[collection];
  if (!verb) return null;
  return recordPath(verb, rkey);
}

/**
 * Pretty label for a verb on the record page header.
 */
export const VERB_LABELS = {
  ...REGISTRY_LABELS,
  reposting: 'a repost',
};
