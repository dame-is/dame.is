import { useEffect, useState } from 'react';

/**
 * The slice of the layout viewport sitting below the visual viewport's bottom
 * edge — i.e. what the on-screen keyboard is covering, in CSS pixels.
 *
 * `innerHeight` is the layout viewport, which a mobile keyboard does not
 * shrink; the visual viewport is what's actually on screen. Subtracting
 * `offsetTop` keeps a pinch-zoomed or scrolled visual viewport from reading as
 * extra keyboard. Rounded, and floored at 0 so over-scroll bounce (which can
 * make the visual viewport momentarily taller than the layout one) can't drive
 * the sheet the wrong way.
 */
export function keyboardOverlap(innerHeight, visualHeight, offsetTop = 0) {
  return Math.round(Math.max(0, innerHeight - visualHeight - offsetTop));
}

/**
 * How much of the layout viewport the on-screen keyboard is currently eating,
 * in CSS pixels — 0 when no keyboard is up (and always 0 where `visualViewport`
 * is unavailable, so callers degrade to their pre-keyboard layout).
 *
 * Why this is needed at all: a mobile keyboard doesn't shrink the layout
 * viewport that `position: fixed` elements are pinned to — it just covers it.
 * The admin shell (AdminShell.jsx) uses this to ride its frame and the bottom
 * bar on the keyboard's top edge, so Save stays reachable while the owner
 * types.
 *
 * The public sheets used to do the same and no longer do: on iOS Safari these
 * events land after the keyboard has moved and while Safari is scrolling the
 * page to reveal the focused field itself, so anything driven by them jumps.
 * Those sheets keep their fields high enough that the keyboard never covers
 * them instead; see .dock-panel-view-account in ActionDock.css.
 *
 * The measurement is `innerHeight - visualViewport.height - offsetTop`: the
 * slice of the layout viewport sitting below the visual viewport's bottom edge.
 * `offsetTop` keeps a pinch-zoomed or scrolled visual viewport from reading as
 * extra keyboard.
 *
 * Updates are coalesced through requestAnimationFrame — iOS fires `resize` and
 * `scroll` on the visual viewport in bursts as the keyboard animates in, and
 * one state update per frame is enough.
 *
 * @param {boolean} active  track only while the hosting overlay is open
 * @returns {number} keyboard overlap in px
 */
export function useKeyboardInset(active) {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!active) {
      setInset(0);
      return undefined;
    }
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;

    let raf = 0;
    const measure = () => {
      raf = 0;
      setInset(keyboardOverlap(window.innerHeight, vv.height, vv.offsetTop));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      setInset(0);
    };
  }, [active]);

  return inset;
}
