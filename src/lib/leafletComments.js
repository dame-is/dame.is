import { fetchSnapshot } from './snapshot.js';

/**
 * Convention-based comments lookup for `pub.leaflet.document` records.
 *
 * Leaflet docs don't carry their own `commentsUri`, so we treat a
 * Bluesky post that links to the document as the canonical comment
 * thread — replies on that post become the comments. We find that post
 * by scanning the author's snapshot for a link facet whose URI contains
 * the document's rkey.
 *
 * Heuristics, in order:
 *   1. A link facet whose `uri` contains the rkey (most leaflet web
 *      front-ends embed the rkey directly in their permalink).
 *   2. A post whose plain text contains the rkey.
 *
 * Returns the at:// URI of the first match, or `null` if none. The
 * caller should treat `null` as "no comments yet" rather than an error.
 */
export async function findLeafletCommentsPost(rkey) {
  if (!rkey) return null;
  const posts = await fetchSnapshot('posts');
  if (!Array.isArray(posts)) return null;

  // Pass 1 — link facets. These are the strongest signal because the
  // user actively chose to link to the doc.
  for (const item of posts) {
    const uri = item?.post?.uri;
    if (!uri) continue;
    const facets = item?.post?.record?.facets || [];
    for (const facet of facets) {
      for (const feature of facet?.features || []) {
        if (feature?.$type !== 'app.bsky.richtext.facet#link') continue;
        if (typeof feature.uri !== 'string') continue;
        if (feature.uri.includes(rkey)) return uri;
      }
    }
  }

  // Pass 2 — plain-text fallback for posts that quote a leaflet URL
  // without a facet (rare, but cheap to check).
  for (const item of posts) {
    const uri = item?.post?.uri;
    const text = item?.post?.record?.text;
    if (!uri || typeof text !== 'string') continue;
    if (text.includes(rkey)) return uri;
  }

  return null;
}
