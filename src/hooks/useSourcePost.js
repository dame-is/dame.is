import { useEffect, useState } from 'react';
import { resolveBskyPosts } from '../lib/subjectResolver.js';

/**
 * The AppView view of one Bluesky post, by at:// URI — for cards that hold a
 * backlink and need the post behind it (an Anisota redaction is an erasure OF
 * a post, so it has to show whose words it blacked out).
 *
 * The home feed hydrates those backlinks in bulk while it builds (see
 * `hydrateSubjects`), so this is the fallback for the surfaces that don't:
 * the single-record page fetches one record and knows nothing of subjects.
 * Pass `null` when the view is already in hand — the hook then does nothing,
 * which keeps the call unconditional at the top of a component.
 *
 * Resolution goes through the module-shared subject resolver, so a post
 * already fetched this session comes back from its cache with no round trip.
 * Returns the post view, or null while pending / when the post is gone.
 */
export function useSourcePost(atUri) {
  const [view, setView] = useState(null);

  useEffect(() => {
    if (!isBskyPostUri(atUri)) {
      setView(null);
      return undefined;
    }
    let cancelled = false;
    setView(null);
    resolveBskyPosts([atUri])
      .then((map) => {
        if (!cancelled) setView(map.get(atUri) || null);
      })
      .catch(() => {
        /* a missing source post degrades to the piece's own snapshot */
      });
    return () => {
      cancelled = true;
    };
  }, [atUri]);

  return view;
}

/** Only `app.bsky.feed.post` URIs resolve through the AppView's getPosts. */
function isBskyPostUri(atUri) {
  return /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/]+$/.test(String(atUri || ''));
}
