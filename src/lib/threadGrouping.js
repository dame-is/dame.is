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
//     anchorAt: createdAt of the newest post (used for day-grouping,
//               and the thread's folio in the ledger),
//     anchorAtUri: the atUri of that newest post (the folio's link),
//     firstAt: createdAt of the oldest post (where the thread began),
//     continuesPrev: true if this post's parent is the post directly
//                    above it in the rendered thread,
//     rootAtUri: the atUri of the oldest post in the thread (for keys),
//   }

import { compareIsoDesc, formatTime } from './time.js';
import { clockBeside, sameDay, shortDay } from './ledger.js';

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
    const sorted = [...groupIndices].sort(
      (a, b) => -compareIsoDesc(items[a].createdAt, items[b].createdAt),
    );
    const anchorAt = items[sorted[sorted.length - 1]].createdAt;
    const anchorAtUri = items[sorted[sorted.length - 1]].atUri || null;
    const firstAt = items[sorted[0]].createdAt;
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
          anchorAtUri,
          firstAt,
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

/**
 * A thread's folio in the ledger's time column. The feed files a thread at
 * its newest post, so the column shows that time and, beneath it, where the
 * thread began ("1:46 am" over "from 1:27"), and reads newest-first down the
 * page like every other row. A thread that began on another day says which
 * ("from Oct 26, 8:57 pm"). `{ at, from: { at, date, clock } }`; `date` is ''
 * when the thread began on the day it's filed under.
 */
export function threadFolio(thread) {
  const { anchorAt, firstAt } = thread || {};
  const crossDay = !sameDay(firstAt, anchorAt);
  return {
    at: anchorAt,
    from: {
      at: firstAt,
      date: crossDay ? shortDay(firstAt, anchorAt) : '',
      clock: crossDay ? formatTime(firstAt) : clockBeside(firstAt, anchorAt),
    },
  };
}

/**
 * A thread member's own time, as the small margin note beside its tick: a
 * bare "1:29" when it shares the folio's day and half of the clock, and its
 * date ("Oct 26 · 8:59 pm") when the thread crossed midnight to reach it.
 * `{ at, date, clock }`.
 */
export function threadMemberMark(item) {
  const at = item?.createdAt;
  const anchor = item?._thread?.anchorAt;
  const crossDay = Boolean(anchor) && !sameDay(at, anchor);
  return {
    at,
    date: crossDay ? shortDay(at, anchor) : '',
    clock: crossDay ? formatTime(at) : clockBeside(at, anchor),
  };
}

/**
 * Set of atUris that participate in a visible self-reply thread of 2+
 * posts (i.e., at least one self-reply edge between them is in the
 * feed window). Used by the feed filter to keep continuing-thread
 * members in the timeline while standalone replies get hidden — the
 * filter runs before `groupSelfReplyThreads`, so it can't read the
 * `_thread` annotation directly.
 *
 * Thread groups whose root post is itself a reply to someone else are
 * EXCLUDED — even though the chain is technically self-replies after
 * that root, the whole conversation is in a reply-to-other context,
 * so it reads as replies (and gets hidden) when the user has chosen
 * to filter replies out.
 */
export function selfThreadMembers(items, myDid) {
  if (!Array.isArray(items) || items.length < 2 || !myDid) return new Set();

  const indexByUri = new Map();
  items.forEach((item, i) => {
    if (item?.atUri) indexByUri.set(item.atUri, i);
  });

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

  for (let i = 0; i < items.length; i++) {
    const parentUri = selfReplyParentUri(items[i], myDid);
    if (!parentUri) continue;
    const pIdx = indexByUri.get(parentUri);
    if (pIdx === undefined) continue;
    union(i, pIdx);
  }

  const sizes = new Map();
  for (let i = 0; i < items.length; i++) {
    const r = find(i);
    sizes.set(r, (sizes.get(r) || 0) + 1);
  }

  // Mark groups whose root (= a member with no in-feed self-reply
  // parent) is itself a reply to someone other than me as "tainted".
  // Tainted groups don't get kept in the result, so their continuing
  // posts fall back to the reply bucket when filtering.
  const tainted = new Set();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item?.verb !== 'posting') continue;
    const parentUri = item.payload?.reply?.parent?.uri;
    if (!parentUri) continue;
    const selfParentUri = selfReplyParentUri(item, myDid);
    const selfParentInFeed =
      selfParentUri && indexByUri.has(selfParentUri);
    if (selfParentInFeed) continue; // not the root of its chain
    const parentDid = item.payload?.parent?.author?.did;
    const isReplyToOther = parentDid
      ? parentDid !== myDid
      : !parentUri.startsWith(`at://${myDid}/`);
    if (isReplyToOther) tainted.add(find(i));
  }

  const out = new Set();
  for (let i = 0; i < items.length; i++) {
    const r = find(i);
    if (tainted.has(r)) continue;
    if ((sizes.get(r) || 0) > 1 && items[i]?.atUri) {
      out.add(items[i].atUri);
    }
  }
  return out;
}
