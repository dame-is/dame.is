import { useEffect } from 'react';

/** Can `node` actually scroll in the gesture's direction right now? A node
 *  qualifies only if it truly overflows AND its overflow style allows
 *  scrolling (scrollHeight > clientHeight alone is true for `overflow:
 *  hidden` boxes too), and it isn't already pinned against the edge the
 *  drag is pulling toward. `dy > 0` is a downward drag → content moves up →
 *  scrollTop decreases, so it only has room when not already at the top;
 *  `dy < 0` is the mirror at the bottom. */
function scrollsInDirection(node, dy) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.scrollHeight <= node.clientHeight) return false;
  const overflowY = getComputedStyle(node).overflowY;
  if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
  const atTop = node.scrollTop <= 0;
  const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight;
  if (dy > 0 && atTop) return false;
  if (dy < 0 && atBottom) return false;
  return true;
}

/**
 * Keep a touch-drag inside an open overlay from scrolling the page behind it.
 *
 * Our overlays (the nav dock, the search/filter/info sheets, modals, the
 * edit sheet) are `position: fixed` scroll containers that fully conceal the
 * page. They already carry `overscroll-behavior: contain`, but that only
 * stops scroll *chaining* once the container is actually scrollable and hits
 * a boundary. When the content fits without overflowing — a short route
 * list, a two-field form — there's nothing to scroll, so iOS treats a
 * tap-drag as a page scroll and the concealed window slides underneath,
 * making the overlay visibly jitter.
 *
 * On each move we walk from the touched node up to (and including) the
 * container: if anything along the way can still scroll in the drag's
 * direction — the container itself, or a nested scroller like a textarea —
 * we let the browser handle it. Only when nothing can absorb the gesture do
 * we cancel it, so it can never chain out to the window. Attached
 * non-passively so `preventDefault()` actually takes — React's synthetic
 * touchmove is passive and can't cancel the scroll.
 *
 * @param {import('react').RefObject<HTMLElement>} ref  the scroll container
 * @param {boolean} active  guard only while the overlay is open
 */
export function usePreventScrollChain(ref, active) {
  useEffect(() => {
    if (!active) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    let startY = 0;
    const onTouchStart = (e) => {
      startY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e) => {
      // Leave pinch-zoom and other multi-touch gestures alone.
      if (e.touches.length > 1) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY;
      // Walk the ancestor chain from the touch target up through the
      // container; bail the moment something can take the scroll.
      let node = e.target;
      while (node) {
        if (scrollsInDirection(node, dy)) return;
        if (node === el) break;
        node = node.parentNode;
      }
      e.preventDefault();
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [ref, active]);
}
