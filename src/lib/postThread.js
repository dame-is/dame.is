// A post's page shows the whole self-thread the post belongs to: every post
// of Dame's in the unbroken run of self-replies around it, from the one that
// starts it, with the replies other people left on each. These are the pure
// parts of that, over app.bsky.feed.getPostThread's `threadViewPost` nodes
// ({ post, parent?, replies? }); Record.jsx does the drawing.
//
// The approach is Anisota's traditional thread view (TraditionalThreadView,
// threadUtils.js): fetch the thread again from the post it starts with, keep
// the linked post to mark, walk the author's chain to its end with follow-up
// fetches when the view stops short, group everyone else's replies into
// conversations, most-liked first, and keep a linear back-and-forth at one
// indent.

const NOT_FOUND = 'app.bsky.feed.defs#notFoundPost';
const BLOCKED = 'app.bsky.feed.defs#blockedPost';

/** Levels of replies asked for below the post a request is anchored on. */
export const REPLY_DEPTH = 6;

/** Levels of parents asked for above the linked post: enough for any chain. */
export const PARENT_HEIGHT = 80;

/** Follow-up fetches allowed when a chain runs past what one view holds. */
export const MAX_CHAIN_PROBES = 20;

/** A reply the page can draw: a post, or the placeholder a deleted or blocked one leaves. */
export function isRenderableReply(node) {
  if (!node) return false;
  if (node.$type === NOT_FOUND || node.$type === BLOCKED) return true;
  return Boolean(node.post);
}

export function renderableReplies(node) {
  return (node?.replies || []).filter(isRenderableReply);
}

/**
 * Walk up from `node` through `authorDid`'s own posts. Returns the topmost of
 * them (`head`, a node of the same view, still carrying its `.parent`) and the
 * at:// URIs from it down to `node`, head first. `head` is null when `node`
 * isn't the author's.
 */
export function selfChainAbove(node, authorDid) {
  const path = [];
  const seen = new Set();
  let head = null;
  let cursor = node;
  while (
    cursor?.post?.uri &&
    cursor.post.author?.did === authorDid &&
    !seen.has(cursor.post.uri)
  ) {
    seen.add(cursor.post.uri);
    path.unshift(cursor.post.uri);
    head = cursor;
    cursor = cursor.parent;
  }
  return { head, path };
}

/**
 * The author's chain down from `root`, root first. While `path` lasts
 * (`path[0]` is the root) the chain follows it, which is how a post on one
 * branch of a branched thread stays in its own chain. Past it, the chain
 * carries on only through a node's single self-reply: none means the thread
 * ended, two or more mean it branched and which branch carries on is
 * ambiguous, so the chain stops and the branches stay replies.
 */
export function walkSelfChain(root, authorDid, path = []) {
  const chain = [];
  const seen = new Set();
  let cursor = root;
  while (cursor?.post?.uri && !seen.has(cursor.post.uri)) {
    seen.add(cursor.post.uri);
    chain.push(cursor);
    const replies = (cursor.replies || []).filter((r) => r?.post?.uri);
    const onPath = path[chain.length];
    let next = null;
    if (onPath) {
      next = replies.find((r) => r.post.uri === onPath) || null;
    } else {
      const own = replies.filter((r) => r.post.author?.did === authorDid);
      if (own.length === 1) next = own[0];
    }
    if (!next) break;
    cursor = next;
  }
  return chain;
}

/**
 * Whether a node's replies were cut off by the view's depth: the post says it
 * has replies and the view carries none. getPostThread has no flag for this.
 */
export function repliesCutOff(node) {
  return (
    Boolean(node?.post) &&
    (node.post.replyCount || 0) > 0 &&
    !node.replies?.length
  );
}

/**
 * walkSelfChain, then, while the chain's last post had its replies cut off,
 * fetch them (`fetchReplies(uri)` → reply nodes) and graft them on, as
 * Anisota's extendAuthorChain does. Mutates the view it's given, which is a
 * fresh response. A failed fetch ends the walk where it is.
 */
export async function extendSelfChain(
  root,
  authorDid,
  { path = [], fetchReplies = null, maxProbes = MAX_CHAIN_PROBES } = {},
) {
  let chain = walkSelfChain(root, authorDid, path);
  for (let probes = 0; fetchReplies && probes < maxProbes; probes++) {
    const tail = chain[chain.length - 1];
    if (!repliesCutOff(tail)) break;
    let replies = null;
    try {
      replies = await fetchReplies(tail.post.uri);
    } catch {
      break;
    }
    if (!Array.isArray(replies) || replies.length === 0) break;
    tail.replies = replies;
    const longer = walkSelfChain(root, authorDid, path);
    const grew = longer.length > chain.length;
    chain = longer;
    if (!grew) break;
  }
  return chain;
}

/**
 * The chain above `linked` rebuilt from its own `.parent` walk, `steps` posts
 * up, each holding only the post below it. The fallback when the thread
 * can't be fetched from its first post: the posts are all there, only the
 * replies to the earlier ones are missing.
 */
export function chainFromAncestors(linked, steps) {
  let node = linked;
  let cursor = linked?.parent;
  for (let i = 0; i < steps && cursor?.post; i++) {
    node = { $type: cursor.$type, post: cursor.post, replies: [node] };
    cursor = cursor.parent;
  }
  return node;
}

/**
 * Everything a post's page needs from its thread. `fetchThread(uri, { depth,
 * parentHeight })` is getPostThread. One request when the post starts its
 * chain (or stands alone); one more, from the chain's first post, when it
 * doesn't, sized so the linked post still gets REPLY_DEPTH levels under it;
 * and a follow-up per REPLY_DEPTH posts the chain runs past that.
 *
 * Returns null when the post isn't there, else:
 *   linked      the linked post's node, from the first request
 *   above       the node whose `.parent` walk is the context above the chain
 *               (someone else's post the chain answers, if any)
 *   chain       the chain's nodes, first post first
 *   linkedIndex where the linked post sits in `chain`
 *   groups      repliesByPost(chain)
 */
export async function loadPostThread(
  uri,
  { fetchThread, authorDid = null } = {},
) {
  const first = await fetchThread(uri, {
    depth: REPLY_DEPTH,
    parentHeight: PARENT_HEIGHT,
  });
  const linked = first?.thread;
  if (!linked?.post) return null;
  const did = authorDid || linked.post.author?.did;
  const { head, path } = selfChainAbove(linked, did);
  const fetchReplies = async (replyUri) => {
    const probe = await fetchThread(replyUri, {
      depth: REPLY_DEPTH,
      parentHeight: 0,
    });
    return probe?.thread?.replies || [];
  };

  let root = linked;
  let chainPath = path.length ? path : [linked.post.uri];
  if (head && head !== linked) {
    let fromHead = null;
    try {
      fromHead = await fetchThread(head.post.uri, {
        depth: path.length - 1 + REPLY_DEPTH,
        parentHeight: 0,
      });
    } catch {
      /* falls back to the chain as the linked post's parents describe it */
    }
    root = fromHead?.thread?.post
      ? fromHead.thread
      : chainFromAncestors(linked, path.length - 1);
  }

  let chain = await extendSelfChain(root, did, {
    path: chainPath,
    fetchReplies,
  });
  let linkedIndex = chain.findIndex((n) => n.post?.uri === linked.post.uri);
  if (linkedIndex < 0) {
    // The view from the first post lost the way down (a post on the path
    // missing from it); the parents still know it.
    root = chainFromAncestors(linked, path.length - 1);
    chainPath = path;
    chain = walkSelfChain(root, did, chainPath);
    linkedIndex = chain.findIndex((n) => n.post?.uri === linked.post.uri);
  }

  return {
    linked,
    above: head || linked,
    chain,
    linkedIndex: Math.max(0, linkedIndex),
    groups: repliesByPost(chain),
  };
}

/** Likes across a conversation: its first reply and everything under it. */
export function conversationLikes(node, seen = new Set()) {
  if (!node?.post?.uri || seen.has(node.post.uri)) return 0;
  seen.add(node.post.uri);
  let likes = node.post.likeCount || 0;
  for (const reply of node.replies || [])
    likes += conversationLikes(reply, seen);
  return likes;
}

function postedAt(node) {
  const t = Date.parse(
    node?.post?.record?.createdAt || node?.post?.indexedAt || '',
  );
  return Number.isFinite(t) ? t : Infinity;
}

/**
 * Conversations with the most likes between them first; a tie goes to the
 * one that started first. Placeholders for deleted or blocked posts sink.
 */
export function mostLikedFirst(nodes) {
  return nodes
    .map((node, i) => ({
      node,
      i,
      likes: conversationLikes(node),
      at: postedAt(node),
    }))
    .sort((a, b) => b.likes - a.likes || a.at - b.at || a.i - b.i)
    .map((x) => x.node);
}

/**
 * A copy of `node` with the replies under it, at every level, oldest first,
 * so a conversation reads in the order it was had.
 */
export function withRepliesOldestFirst(node, depth = 0) {
  if (!node?.replies?.length || depth > 64) return node;
  const replies = node.replies
    .map((r, i) => ({ r, i, at: postedAt(r) }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map(({ r }) => withRepliesOldestFirst(r, depth + 1));
  return { ...node, replies };
}

/**
 * For each post in the chain, the replies other people (and Dame, off the
 * chain) left on it: everything but the chain carrying on. Conversations are
 * most-liked first, and read oldest first within.
 */
export function repliesByPost(chain) {
  return chain.map((node, index) => {
    const next = chain[index + 1]?.post?.uri || null;
    const replies = renderableReplies(node).filter(
      (r) => !next || r.post?.uri !== next,
    );
    return {
      node,
      index,
      replies: mostLikedFirst(replies).map((r) => withRepliesOldestFirst(r)),
    };
  });
}

/**
 * A run of replies where each has exactly one reply, starting at `first`:
 * a back-and-forth the replies tree draws at one indent rather than stepping
 * right at every turn (Anisota's flattenLinearThread). The run's last node has
 * no replies or several.
 */
export function linearRun(first) {
  const run = [first];
  const seen = new Set([first?.post?.uri]);
  let cursor = first;
  for (;;) {
    const replies = renderableReplies(cursor);
    if (replies.length !== 1) break;
    const next = replies[0];
    if (next.post?.uri && seen.has(next.post.uri)) break;
    seen.add(next.post?.uri);
    run.push(next);
    cursor = next;
  }
  return run;
}

/**
 * A post's opening words for a heading, cut at a word near `max` characters;
 * a post without words is named by what it holds.
 */
export function postExcerpt(post, max = 64) {
  const text = String(post?.record?.text || '')
    .replace(/\uFFFC/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text) {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
  }
  const type = String(post?.embed?.$type || post?.record?.embed?.$type || '');
  if (type.includes('images')) return 'a picture';
  if (type.includes('video')) return 'a video';
  if (type.includes('external')) return 'a link';
  if (type.includes('record')) return 'a quote';
  return 'a post';
}

/** How many posts stay in view at the end of a long conversation above a reply. */
export const CONTEXT_KEEP_LAST = 2;

/**
 * The conversation above a reply, oldest first, split for drawing: `start`
 * (the post it began with), `folded` (the middle, out of sight until asked
 * for) and `end` (the last few before the reply). It folds only when that
 * hides two or more posts; hiding one saves nothing, so a short conversation
 * comes back whole in `start`.
 */
export function foldConversation(ancestors, keepLast = CONTEXT_KEEP_LAST) {
  const posts = (ancestors || []).filter(Boolean);
  const hidden = posts.length - 1 - keepLast;
  if (hidden < 2) return { start: posts, folded: [], end: [] };
  return {
    start: posts.slice(0, 1),
    folded: posts.slice(1, posts.length - keepLast),
    end: posts.slice(posts.length - keepLast),
  };
}

/**
 * Who wrote the posts in a folded stretch, as @handles, each once, in the
 * order they first spoke. Deleted and blocked posts have no author to name.
 */
export function foldVoices(posts) {
  const seen = new Set();
  const voices = [];
  for (const post of posts || []) {
    const handle = post?.author?.handle;
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    voices.push(`@${handle}`);
  }
  return voices;
}

/** "@a", "@a and @b", "@a, @b and @c"; past four, "@a, @b, @c and 2 others". */
export function voicesInProse(voices, max = 4) {
  if (voices.length <= 1) return voices[0] || '';
  if (voices.length > max) {
    const rest = voices.length - (max - 1);
    return `${voices.slice(0, max - 1).join(', ')} and ${rest} others`;
  }
  return `${voices.slice(0, -1).join(', ')} and ${voices[voices.length - 1]}`;
}
