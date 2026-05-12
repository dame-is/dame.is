import { useEffect, useRef, useState } from 'react';

/**
 * Inline element that, when its content overflows its container, scrolls
 * ticker-tape style on hover/focus by duplicating its content for a seamless
 * loop. Falls back to a static ellipsis when there's enough room.
 *
 *   <TickerText className="chrome-signal-value">
 *     {text}
 *   </TickerText>
 *
 * Speed is proportional to text width: ~50px / second, capped between 6s and 30s.
 */
export default function TickerText({ children, className = '', as: Tag = 'span', title }) {
  const wrapRef = useRef(null);
  const measureRef = useRef(null);
  const [truncated, setTruncated] = useState(false);
  const [duration, setDuration] = useState('14s');

  useEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return undefined;

    function check() {
      const overflow = measure.scrollWidth - wrap.clientWidth;
      const isTrunc = overflow > 1;
      setTruncated(isTrunc);
      if (isTrunc) {
        const seconds = Math.min(30, Math.max(6, measure.scrollWidth / 50));
        setDuration(`${seconds.toFixed(1)}s`);
      }
    }

    check();
    const ro = new ResizeObserver(check);
    ro.observe(wrap);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [children]);

  return (
    <Tag
      ref={wrapRef}
      className={`ticker ${className}`}
      data-truncated={truncated ? 'true' : undefined}
      title={title}
      style={{ '--ticker-duration': duration }}
    >
      <span className="ticker-track">
        <span className="ticker-copy" ref={measureRef}>{children}</span>
        {truncated && (
          <span className="ticker-copy" aria-hidden="true">{children}</span>
        )}
      </span>
    </Tag>
  );
}
