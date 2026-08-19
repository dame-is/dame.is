import { useCallback, useEffect, useRef, useState } from 'react';
import './ScrollFrame.css';

/** Which sides are hiding something, as the attribute the stylesheet reads. */
function edgeName(start, end) {
  if (start && end) return 'both';
  if (start) return 'start';
  if (end) return 'end';
  return 'none';
}

/**
 * A horizontally scrolling frame that admits what it is hiding.
 *
 * A plain `overflow-x: auto` div cuts its content off at a hard edge, which
 * reads as "the table ends here" rather than "the table continues" — the
 * ledger's last visible column looked like its last column. This tracks which
 * side has content off-screen and lets the stylesheet fade that edge out, so
 * the hidden column is visibly dissolving rather than guillotined, and the fade
 * appears only on the side there is actually something to reach.
 *
 * It is also the accessibility fix a scroll container needs: a region you can
 * only reach by scrolling has to be reachable from the keyboard, and named when
 * it is. Both are conditional — a frame with nothing hidden is not a landmark
 * and should not be a tab stop.
 *
 * @param {string} [className] extra classes on the frame itself
 * @param {string} [label] what the frame holds, for the screen-reader name
 */
export default function ScrollFrame({
  className = '',
  label,
  children,
  ...rest
}) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // A pixel of slack at both ends: a table sized in `ch` inside a container
    // sized in `vw` lands on fractional widths, and scrollWidth rounds up — so
    // a frame with nothing to scroll still reports a sub-pixel of overflow, and
    // one scrolled to the end never quite reaches `max`. Without the slack both
    // ends of every table wore a permanent fade.
    const next = { start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 };
    setEdges((prev) =>
      prev.start === next.start && prev.end === next.end ? prev : next,
    );
  }, []);

  // After every render, because what these frames hold is re-rendered with
  // fewer or more columns than it had — a sort, an expand, the live deltas
  // landing a `+n` in every right-hand cell.
  useEffect(measure);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    el.addEventListener('scroll', measure, { passive: true });
    let ro;
    // Absent in jsdom, and in any browser old enough not to have it the frame
    // simply keeps whatever the last render measured — the scroll listener
    // still updates it, so the fade is never wrong, only occasionally late.
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
      // The content too, not just the frame: a window resize that leaves the
      // frame's width alone can still reflow the table inside it.
      for (const child of el.children) ro.observe(child);
    }
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure]);

  const scrollable = edges.start || edges.end;
  return (
    <div
      ref={ref}
      className={className ? `scrollframe ${className}` : 'scrollframe'}
      data-edge={edgeName(edges.start, edges.end)}
      tabIndex={scrollable ? 0 : undefined}
      role={scrollable ? 'region' : undefined}
      aria-label={scrollable ? label : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
