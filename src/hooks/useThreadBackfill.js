import { useEffect, useMemo, useState } from 'react';
import { getPostThread } from '../lib/atproto.js';
import { missingSelfParents } from '../lib/threadGrouping.js';
import { selfAncestorsFromThread } from '../lib/threadBackfill.js';
import { compareIsoDesc } from '../lib/time.js';

// How far up one fetch walks. A thread that runs on further behind the cut
// fills in over another fetch, from the post this one stopped at.
const PARENT_HEIGHT = 80;

// One fetch per missing parent for the life of the page: a feed refreshes
// every half minute, and the same gap shouldn't ask the AppView again.
const fetched = new Map(); // parent at:// URI → Promise<feed items>

function fetchAncestors(uri, myDid) {
  if (!fetched.has(uri)) {
    fetched.set(
      uri,
      getPostThread(uri, { parentHeight: PARENT_HEIGHT })
        .then((res) => selfAncestorsFromThread(res?.thread, myDid))
        .catch(() => {
          // Gone, blocked or unreachable: nothing to add this time, but let
          // a later look try again.
          fetched.delete(uri);
          return [];
        }),
    );
  }
  return fetched.get(uri);
}

/**
 * The posts of Dame's that self-replies in `items` answer but that the feed
 * never loaded (`known` is everything it did). Fetches each missing chain
 * once and returns what's come back so far, newest first. The caller adds
 * them to the threads they belong to (completeSelfThreads), never to the
 * feed by themselves.
 */
export function useThreadBackfill(items, known, myDid) {
  const [found, setFound] = useState(() => new Map()); // parent URI → items
  const posts = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const list of found.values()) {
      for (const post of list) {
        if (seen.has(post.atUri)) continue;
        seen.add(post.atUri);
        out.push(post);
      }
    }
    return out.sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt));
  }, [found]);
  // What came back counts as asked-about too, so a chain longer than one
  // fetch reaches carries on from where that fetch stopped.
  const missing = useMemo(
    () => missingSelfParents([...(items || []), ...posts], known, myDid).join(' '),
    [items, posts, known, myDid],
  );
  useEffect(() => {
    if (!missing) return undefined;
    let cancelled = false;
    for (const uri of missing.split(' ')) {
      fetchAncestors(uri, myDid).then((list) => {
        if (cancelled || !list.length) return;
        setFound((prev) => (prev.has(uri) ? prev : new Map(prev).set(uri, list)));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [missing, myDid]);
  return posts;
}
