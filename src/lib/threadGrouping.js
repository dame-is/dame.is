// Detect chains of self-replies inside a unified feed (e.g. Dame replying
// to her own posts to thread an idea) and rearrange them into linear,
// oldest -> newest reading order. The thread floats up to the position of
// its newest post — so its position relative to the rest of the feed
// matches what a reverse-chronological reader expects, but inside the
// run, posts read top-down like the conversation was written.
//
// Items not in a thread (singletons, or replies whose parent isn't
// visible in the current feed window) are passed through unchanged.
//
// Each item in a thread is decorated with a `_thread` block that the
// renderer uses to suppress the redundant "replying to @dame.is" hint on
// continuation posts and to draw a connector between members:
//
//   {
//     length: total posts in this thread,
//     position: 0-based index, 0 = oldest
//     isFirst, isLast,
//     anchorAt: createdAt of the newest post (used for day-grouping),
//     continuesPrev: true if this post's parent is the post directly
//                    above it in the rendered thread,
//     rootAtUri: the atUri of the oldest post in the thread (for keys),
//   }

const POSTING_VERB = 'posting';

function selfReplyParentUri(item, myDid) {
  if (item?.verb !== POSTING_VERB) return null;
  const parentUri = item.payload?.reply?.parent?.uri;
  if (!parentUri) return null;
  const parentDid = item.payload?.parent?.author?.did;
  if (parentDid && parentDid !== myDid) return null;
  // No author hydrated — fall back to URI inspection. AT URIs are
  // `at://<did>/<collection>/<rkey>`.
  if (!parentDid && !parentUri.startsWith(`at://${myDid}/`)) return null;
  return parentUri;
}

export function groupSelfReplyThreads(items, myDid) {
  if (!Array.isArray(items) || items.length < 2 || !myDid) return items;

  // Fast index of feed-visible items by their atUri so we can walk
  // child -> parent edges without a quadratic scan.
  const indexByUri = new Map();
  items.forEach((item, i) => {
    if (item?.atUri) indexByUri.set(item.atUri, i);
  });

  // Union-find over feed indices. Each set is a thread.
  const parent = items.map((_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // childIdx -> parentIdx (only when the parent is also in the feed)
  const directParent = new Map();
  for (let i = 0; i < items.length; i++) {
    const parentUri = selfReplyParentUri(items[i], myDid);
    if (!parentUri) continue;
    const pIdx = indexByUri.get(parentUri);
    if (pIdx === undefined) continue;
    union(i, pIdx);
    directParent.set(i, pIdx);
  }

  // Bucket items by root.
  const groups = new Map();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  // Walk the feed in original (newest-first) order. The first time we
  // hit any member of a thread, emit the whole thread in chronological
  // (oldest-first) order anchored at the newest post's position.
  const consumed = new Set();
  const output = [];
  for (let i = 0; i < items.length; i++) {
    if (consumed.has(i)) continue;
    const root = find(i);
    const groupIndices = groups.get(root);
    if (groupIndices.length === 1) {
      output.push(items[i]);
      consumed.add(i);
      continue;
    }
    const groupSet = new Set(groupIndices);
    const sorted = [...groupIndices].sort((a, b) => {
      const aT = items[a].createdAt || '';
      const bT = items[b].createdAt || '';
      if (aT === bT) return 0;
      return aT < bT ? -1 : 1;
    });
    const anchorAt = items[sorted[sorted.length - 1]].createdAt;
    const rootAtUri = items[sorted[0]].atUri || null;
    sorted.forEach((idx, pos) => {
      const parentIdx = directParent.get(idx);
      const continuesPrev =
        parentIdx !== undefined && groupSet.has(parentIdx);
      output.push({
        ...items[idx],
        _thread: {
          length: sorted.length,
          position: pos,
          isFirst: pos === 0,
          isLast: pos === sorted.length - 1,
          anchorAt,
          continuesPrev,
          rootAtUri,
        },
      });
      consumed.add(idx);
    });
  }

  return output;
}

/**
 * Day-grouping key picker that pulls thread posts onto the newest
 * member's day, so a thread that crosses midnight stays together under
 * the most recent day header instead of splitting in two.
 */
export function threadAwareDateKey(item) {
  return item?._thread?.anchorAt || item?.createdAt || null;
}
