// Mapping between gerund verbs, AT Protocol lexicon NSIDs, and the routes
// that render a single record from each. Anything that needs to know
// "what page does this record open on?" should go through here.

import { COLLECTIONS } from '../config.js';

/**
 * Verb → collection (NSID).
 * The verbs are how the site talks about its records; the NSIDs are how the
 * AT Protocol identifies them.
 */
export const VERB_TO_COLLECTION = {
  posting: 'app.bsky.feed.post',
  logging: COLLECTIONS.now,
  blogging: COLLECTIONS.blogging,
  creating: COLLECTIONS.creating,
  listening: COLLECTIONS.listen,
};

/**
 * Inverse of VERB_TO_COLLECTION — collection → verb.
 */
export const COLLECTION_TO_VERB = Object.fromEntries(
  Object.entries(VERB_TO_COLLECTION).map(([verb, nsid]) => [nsid, verb]),
);

/**
 * The full set of route segments (verb + NSID) that resolve to the single
 * record page. Used both by the React router and by `useAtUri`.
 *
 * `pub.leaflet.document` is included so the lexicon-form URL resolves
 * the AT URI for the debug overlay even though leaflet docs aren't in
 * `VERB_TO_COLLECTION` (they share the `blogging` verb with our own
 * lexicon and route through `BlogPost.jsx` rather than `Record.jsx`).
 */
export const RECORD_ROUTE_SEGMENTS = [
  ...Object.keys(VERB_TO_COLLECTION),
  ...Object.values(VERB_TO_COLLECTION),
  COLLECTIONS.leaflet,
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
  posting: 'a post',
  logging: 'a status',
  blogging: 'a blog post',
  creating: 'a work',
  listening: 'a play',
};
