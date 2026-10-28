import { useEffect } from 'react';

// How many open overlays are holding the document still, and what <html>'s
// own overflow was before the first of them did.
let holds = 0;
let saved = '';

/**
 * Stop the page behind an overlay from scrolling while `active`.
 *
 * usePreventScrollChain only cancels touch drags. A wheel, Space or PageDown
 * over an overlay that doesn't scroll itself (the lightbox stage, a short
 * sheet) went straight through to the document: the page moved under the
 * blur, the feed's infinite-scroll sentinel could fire, and the reader closed
 * the overlay somewhere else. `overflow: hidden` on <html> stops all of them
 * without moving anything: reset.css already hides the document scrollbar, so
 * there is no gutter to lose, and the scroll position stays where it is.
 *
 * Counted, so an overlay opened from inside another doesn't release the page
 * when it closes, and the value restored is the one that was there before,
 * not ''.
 */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    const style = document.documentElement.style;
    if (holds === 0) {
      saved = style.overflow;
      style.overflow = 'hidden';
    }
    holds += 1;
    return () => {
      holds -= 1;
      if (holds === 0) style.overflow = saved;
    };
  }, [active]);
}
