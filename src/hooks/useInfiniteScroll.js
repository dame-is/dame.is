import { useEffect, useRef } from 'react';

/**
 * Auto-reveal-on-scroll. Watches a sentinel element and calls `onReach`
 * whenever it scrolls within `rootMargin` of the viewport, as long as
 * `enabled` is true. Returns a ref to attach to the sentinel.
 *
 * The home feed uses this to grow its client-side visible window as the
 * reader nears the bottom, in place of the old "Load more" button. That
 * pagination is purely client-side — the next batch is already in memory —
 * so each reveal is instant: no spinner, no fetch. `rootMargin` fires the
 * callback a screenful early so the next window is in place before the
 * reader actually reaches the end.
 *
 * `onReach` is read through a ref so a fresh closure each render doesn't
 * tear down and rebuild the observer; only `enabled`/`rootMargin` do.
 * Callers should bump the window by a step comfortably taller than a
 * viewport (the feed adds ~100 items), so one reveal pushes the sentinel
 * back out of range — the observer then re-fires only on the next scroll,
 * never in a runaway loop.
 */
export function useInfiniteScroll(
  onReach,
  { enabled = true, rootMargin = '600px 0px' } = {},
) {
  const sentinelRef = useRef(null);
  const onReachRef = useRef(onReach);
  onReachRef.current = onReach;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !enabled) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onReachRef.current?.();
            break;
          }
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, rootMargin]);

  return sentinelRef;
}
