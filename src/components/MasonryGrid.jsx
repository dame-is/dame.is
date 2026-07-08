import { useLayoutEffect, useMemo, useRef, useState } from 'react';

// Masonry column sizing — keep in step with `.creating-grid` in Creating.css.
const MIN_COL_REM = 16;
const GAP_REM = 1.5; // --space-5

/**
 * Responsive masonry column count derived from the container's own width.
 */
function useMasonryColumns() {
  const ref = useRef(null);
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const minCol = MIN_COL_REM * rem;
    const gap = GAP_REM * rem;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setCols(Math.max(1, Math.floor((w + gap) / (minCol + gap))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, cols];
}

/**
 * Masonry laid out as side-by-side flex columns. Items are dealt round-robin
 * across the columns (item i → column i % n), so an already-sorted list reads
 * left-to-right — newest along the top row — while each column still packs to
 * its own varying heights (the irregular mosaic, not rows aligned to the
 * tallest card). `renderItem(item, index)` must return a `<li>` and attach its
 * own key.
 */
export default function MasonryGrid({ items, renderItem, className = 'creating-grid' }) {
  const [gridRef, columnCount] = useMasonryColumns();
  const columns = useMemo(() => {
    const buckets = Array.from({ length: columnCount }, () => []);
    items.forEach((it, i) => buckets[i % columnCount].push({ it, i }));
    return buckets;
  }, [items, columnCount]);

  return (
    <div className={className} ref={gridRef}>
      {columns.map((col, ci) => (
        <ul className="creating-grid-col reveal-stagger" key={ci}>
          {col.map(({ it, i }) => renderItem(it, i))}
        </ul>
      ))}
    </div>
  );
}
