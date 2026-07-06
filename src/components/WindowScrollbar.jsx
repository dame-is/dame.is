import { useEffect, useRef, useState } from 'react';
import './WindowScrollbar.css';

/**
 * Custom scrollbar for the document scroll. Native scrollbars are
 * hidden app-wide (see reset.css); this draws a thin accent line — the
 * same moss/sage the compass button uses — in the content region
 * between the top and bottom chrome bars, so it reads as tucked under
 * the chrome rather than running edge to edge. The thumb is draggable.
 *
 * Purely visual/optional: it observes the document, so it needs no
 * props and lives once at the app-shell level.
 */
export default function WindowScrollbar() {
  const thumbRef = useRef(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const doc = document.documentElement;
    const thumb = thumbRef.current;
    if (!thumb) return undefined;
    const track = thumb.parentElement;
    let raf = 0;

    const measure = () => {
      raf = 0;
      const scrollH = doc.scrollHeight;
      const viewH = window.innerHeight;
      const range = scrollH - viewH;
      if (range <= 1) {
        setScrollable(false);
        return;
      }
      setScrollable(true);
      const trackH = track.clientHeight;
      const thumbH = Math.max(32, Math.round(trackH * (viewH / scrollH)));
      const y = Math.round((window.scrollY / range) * (trackH - thumbH));
      thumb.style.height = `${thumbH}px`;
      thumb.style.transform = `translateY(${y}px)`;
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(doc);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Drag the thumb to scroll: map vertical pointer travel across the
  // free track space onto the document's scroll range.
  const onPointerDown = (e) => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    e.preventDefault();
    const track = thumb.parentElement;
    const trackH = track.clientHeight;
    const thumbH = thumb.offsetHeight;
    const range = document.documentElement.scrollHeight - window.innerHeight;
    const startY = e.clientY;
    const startScroll = window.scrollY;
    const free = trackH - thumbH;
    const onMove = (ev) => {
      if (free <= 0) return;
      const delta = ((ev.clientY - startY) / free) * range;
      window.scrollTo(0, startScroll + delta);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className={`window-scrollbar ${scrollable ? 'is-visible' : ''}`} aria-hidden="true">
      <div className="window-scrollbar-thumb" ref={thumbRef} onPointerDown={onPointerDown} />
    </div>
  );
}
