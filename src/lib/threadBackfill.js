// The earlier posts of a self-thread that the feed never loaded. A feed is
// cut somewhere (a capped fetch, the oldest page), and a thread that started
// before the cut would otherwise fold with its opening posts missing. Given
// the parent a loaded self-reply answers, the AppView's thread view of it
// walks back up the chain; this keeps the posts of Dame's on that walk, as
// the feed items the rest of the feed is made of.

import { blueskyPostToFeedItem } from './feedBuilder.js';

/**
 * Feed items for `node` (a `threadViewPost` from app.bsky.feed.getPostThread)
 * and each parent above it, for as long as they're Dame's: the walk stops at
 * the first post someone else wrote, or one that's gone or blocked. Newest
 * first, like a feed.
 */
export function selfAncestorsFromThread(node, myDid) {
  const out = [];
  const seen = new Set();
  let cur = node;
  while (cur?.post?.uri && cur.post.author?.did === myDid && !seen.has(cur.post.uri)) {
    seen.add(cur.post.uri);
    const parent = cur.parent?.post || null;
    const item = blueskyPostToFeedItem({
      post: cur.post,
      reply: parent ? { parent } : undefined,
    });
    if (item) out.push(item);
    cur = cur.parent;
  }
  return out;
}
