import { useEffect, useRef, useState } from 'react';
import { getPosts } from '../lib/atproto.js';

/** `app.bsky.feed.getPosts` takes 25 URIs a call, and no more. */
const BATCH = 25;

/**
 * How long to sit on a changed list before asking. The live feed re-renders on
 * every arrival, and a piece can take four replies in a second; without this
 * each one is its own round trip. At 400ms a burst is one call.
 */
const SETTLE_MS = 400;

/**
 * How long to wait before asking again about a post the AppView did not have.
 *
 * This is the whole reason there is a retry at all. The stream is faster than
 * the index — that is what the stream is FOR — so a reply written two seconds
 * ago is reliably absent from the AppView on the first ask. Asked once and
 * given up on, every row that arrived live would be the one row with no embed
 * on it, which is precisely backwards.
 */
const RETRY_MS = 6000;

/**
 * How many times to ask about one post before letting it go. Four asks spread
 * over about twenty seconds covers the index lag; past that the post is
 * deleted, blocked, or from an account the AppView will not serve, and asking
 * again forever is how a page left open all afternoon becomes a poller.
 */
const MAX_ASKS = 4;

/**
 * Hydrate a set of post URIs from the AppView, as they show up and as they
 * resolve.
 *
 * Returns `{ [uri]: { cid, did, handle, text, embed } }` — see
 * lib/atproto.js#getPosts. A URI that has not resolved yet is simply absent, so
 * a caller renders what it has and gets the rest on a later render; nothing
 * here blocks anything, and nothing here throws.
 *
 * Unauthenticated and public: the same AppView the piece's own page already
 * reads, asked for nothing that is not already public.
 *
 * @param {string[]} uris  post URIs. Pass a memoised array — a fresh array with
 *   the same contents costs a settle timer rather than a round trip, but there
 *   is no reason to spend even that.
 */
export default function usePostViews(uris) {
  const [posts, setPosts] = useState({});
  // What to ask about, what is already known, and how many times each URI has
  // been asked. Refs, because the sweep is a timer that outlives the render
  // that armed it and must read the current answer rather than that render's —
  // and because a fetch count that caused a render would schedule its own next
  // sweep forever. Written from effects, never during render.
  const want = useRef([]);
  const have = useRef({});
  const asks = useRef(new Map());
  useEffect(() => {
    have.current = posts;
  }, [posts]);

  const [sweep, setSweep] = useState(0);
  // A changed list is worth a look. Cheap when there is nothing new in it: the
  // sweep works out what is missing and, finding nothing, makes no request.
  useEffect(() => {
    want.current = uris || [];
    setSweep((n) => n + 1);
  }, [uris]);

  useEffect(() => {
    let alive = true;
    let again;
    const settle = setTimeout(async () => {
      const missing = [];
      const seen = new Set();
      for (const uri of want.current) {
        if (!uri || seen.has(uri) || have.current[uri]) continue;
        if ((asks.current.get(uri) || 0) >= MAX_ASKS) continue;
        seen.add(uri);
        missing.push(uri);
      }
      // What this pass resolved, tracked here rather than read back off
      // `have`: setState has not re-rendered by the time the re-arm below runs,
      // so `have` is still one pass behind and every sweep would re-arm.
      const done = new Set();
      if (missing.length) {
        for (const uri of missing) asks.current.set(uri, (asks.current.get(uri) || 0) + 1);
        for (let i = 0; i < missing.length && alive; i += BATCH) {
          // Never throws: a batch the AppView refuses leaves those rows
          // unhydrated and retryable, and the feed itself unharmed.
          const got = await getPosts(missing.slice(i, i + BATCH)).catch(() => ({}));
          if (!alive) return;
          const keys = Object.keys(got);
          if (!keys.length) continue;
          for (const k of keys) done.add(k);
          setPosts((p) => ({ ...p, ...got }));
        }
      }
      // Re-arm only while something is still worth asking about, so a feed
      // that is fully hydrated holds no timer at all.
      const pending = want.current.some(
        (uri) =>
          uri &&
          !have.current[uri] &&
          !done.has(uri) &&
          (asks.current.get(uri) || 0) < MAX_ASKS,
      );
      if (alive && pending) again = setTimeout(() => setSweep((n) => n + 1), RETRY_MS);
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(settle);
      clearTimeout(again);
    };
  }, [sweep]);

  return posts;
}
