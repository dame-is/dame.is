import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteScroll } from './useInfiniteScroll.js';

// The home feed's window sizes: a step comfortably taller than a viewport, so
// one reveal pushes the sentinel back out of range.
const INITIAL_VISIBLE = 100;
const LOAD_MORE_STEP = 100;

/**
 * Client-side pagination for a feed page, the same arrangement Home uses:
 * render the first `INITIAL_VISIBLE` of `items` and grow by `LOAD_MORE_STEP`
 * as the reader nears the bottom. The rest is already in memory, so a reveal
 * is instant.
 *
 * The feed pages used to render everything they had — 500 status records as
 * animated rows on /logging, a second-long main-thread stall on a phone — for
 * a reader who mostly looks at the top. Search and filters still run over the
 * whole list; only what's drawn is windowed. `resetKey` (the query, say) puts
 * the window back to the top when the view changes underneath it.
 *
 * `weigh` (stable — module-level or memoized) counts an item as more than one
 * row, for a list of groups: /mothing windows whole nights, and a night is as
 * many tiles as it caught moths. The window then takes items until their
 * weight reaches the count, so each reveal still adds about a step's worth.
 *
 * Returns `{ visible, hasMore, loadMore, sentinelRef }`: attach `sentinelRef`
 * to an element after the list while `hasMore`, and offer `loadMore` as a
 * button where IntersectionObserver isn't available (`canObserve`).
 */
export function useFeedWindow(items, resetKey, { weigh } = {}) {
  const [count, setCount] = useState(INITIAL_VISIBLE);
  useEffect(() => {
    setCount(INITIAL_VISIBLE);
  }, [resetKey]);
  const visible = useMemo(
    () => windowOf(items || [], count, weigh),
    [items, count, weigh],
  );
  const hasMore = (items || []).length > visible.length;
  const loadMore = useCallback(() => setCount((n) => n + LOAD_MORE_STEP), []);
  // `version` rebuilds the observer with each reveal, as Home's does, so a
  // sentinel still in range after one (a reveal shorter than the margin)
  // reveals again rather than waiting for the reader to scroll away and back.
  const sentinelRef = useInfiniteScroll(loadMore, {
    enabled: hasMore,
    version: count,
  });
  return { visible, hasMore, loadMore, sentinelRef, canObserve };
}

const canObserve = typeof IntersectionObserver !== 'undefined';

/** The leading items of `list` that fill `count` rows (see `weigh` above). */
export function windowOf(list, count, weigh) {
  if (!weigh) return list.slice(0, count);
  let end = 0;
  for (let rows = 0; end < list.length && rows < count; end += 1) {
    rows += Math.max(1, weigh(list[end]) || 0);
  }
  return list.slice(0, end);
}
