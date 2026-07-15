import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Truncation-aware scroller for chrome-bar values. Two modes:
 *
 * 1. Default (hover-reveal). Renders a single copy clipped by the container;
 *    on hover/focus it eases left by exactly the overflow amount and back, so
 *    the hidden tail comes into view on demand. Fully still when idle.
 *
 * 2. Marquee (`marquee` prop). When the text overflows, it auto-scrolls as a
 *    seamless, repeating ticker tape — two copies chase each other on an
 *    infinite CSS loop (translateX 0 → -50%). Hover/focus pauses it in place
 *    so it can be read, and it collapses to a still, ellipsized copy when the
 *    text fits or when reduced motion is requested.
 *
 *   <TickerText className="chrome-signal-value" marquee>{text}</TickerText>
 *
 * Both modes clip to the container, respect `prefers-reduced-motion`, and
 * scroll at the same steady pace so the chrome reads as one system.
 */

// Scroll pace shared by both modes, in px/second — slow enough to read.
const SPEED = 40;
// Breathing room (px) between the tail of one marquee copy and the head of
// the next. It's baked into each copy as padding, so translating the track by
// exactly -50% lands the second copy precisely where the first began — the
// seamless-loop invariant. The CSS `--ticker-gap` must match this value.
const MARQUEE_GAP = 44;
// Floor on a full loop so a barely-overflowing status still drifts gently
// rather than snapping past in a fraction of a second.
const MARQUEE_MIN_DURATION = 6;

export default function TickerText({ children, className = '', title, marquee = false }) {
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const [overflow, setOverflow] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return undefined;

    function measure() {
      // innerRef points at the (unpadded) content span in both modes, so this
      // is the text's natural width regardless of any marquee gap padding.
      const width = inner.scrollWidth;
      setContentWidth(width);
      setOverflow(Math.max(0, width - wrap.clientWidth));
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [children]);

  const truncated = overflow > 0;

  // --- Marquee (auto-scrolling ticker tape) --------------------------------
  if (marquee) {
    // Only loop when the text actually overflows and motion is allowed. Both
    // the second copy and the gap padding are gated on this, so a fitting or
    // reduced-motion value renders as a single still copy (with the same fade
    // as the hover mode's idle state).
    const playing = truncated && !reduce;
    // The track travels one copy-plus-gap per cycle; keep the pace constant so
    // longer statuses take proportionally longer to loop.
    const duration = playing
      ? Math.max(MARQUEE_MIN_DURATION, (contentWidth + MARQUEE_GAP) / SPEED)
      : 0;
    return (
      <span
        ref={wrapRef}
        className={`ticker ticker-auto ${className}`}
        data-truncated={truncated ? 'true' : undefined}
        data-playing={playing ? 'true' : undefined}
        title={title}
      >
        <span
          className="ticker-track"
          style={
            playing
              ? { '--ticker-duration': `${duration}s`, '--ticker-gap': `${MARQUEE_GAP}px` }
              : undefined
          }
        >
          <span className="ticker-seg">
            <span ref={innerRef} className="ticker-measure">
              {children}
            </span>
          </span>
          {/* Trailing copy that chases the first so the loop never shows a gap
              at the wrap point. Purely decorative: `aria-hidden` keeps it out
              of the accessibility tree and `inert` out of the tab order, so a
              linked status isn't announced — or focusable — twice. */}
          {playing && (
            <span className="ticker-seg" aria-hidden="true" inert="">
              <span className="ticker-measure">{children}</span>
            </span>
          )}
        </span>
      </span>
    );
  }

  // --- Hover-reveal (default) ---------------------------------------------
  const playing = hovered && truncated && !reduce;

  return (
    <span
      ref={wrapRef}
      className={`ticker ${className}`}
      data-truncated={truncated ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <motion.span
        ref={innerRef}
        className="ticker-inner"
        animate={playing ? { x: -overflow } : { x: 0 }}
        transition={
          playing
            ? {
                duration: Math.min(10, Math.max(4, overflow / SPEED)),
                ease: 'linear',
                repeat: Infinity,
                repeatType: 'reverse',
                repeatDelay: 0.6,
              }
            : { duration: 0.3, ease: 'easeOut' }
        }
      >
        {children}
      </motion.span>
    </span>
  );
}
