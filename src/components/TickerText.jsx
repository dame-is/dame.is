import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Hover-reveal for truncated chrome-bar values. Renders a single copy of
 * the text inside a clipped container; when hovered/focused (and only then),
 * animates it left by exactly the overflow amount on a slow oscillation so
 * the trailing characters scroll into view, then back. No duplicate DOM, no
 * idle flicker.
 *
 *   <TickerText className="chrome-signal-value">
 *     {text}
 *   </TickerText>
 *
 * Speed is proportional to overflow distance: ~40 px / second, capped 4–10s.
 * Respects `prefers-reduced-motion`: just shows ellipsis with no motion.
 */
export default function TickerText({ children, className = '', title }) {
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const [overflow, setOverflow] = useState(0);
  const [hovered, setHovered] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return undefined;

    function measure() {
      const next = Math.max(0, inner.scrollWidth - wrap.clientWidth);
      setOverflow(next);
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [children]);

  const truncated = overflow > 0;
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
                duration: Math.min(10, Math.max(4, overflow / 40)),
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
