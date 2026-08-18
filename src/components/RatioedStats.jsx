// A row of measured figures.
//
// Thirteen numbers is more than a headline can carry, and the answer is not a
// smaller headline — every one of them says something the others don't. It is
// two tiers. Four figures answer "how did this one go" at a size you can read
// from across the room; the rest answer "what was it like" in a denser strip
// underneath, where a reader who wants them will find them and a reader who
// doesn't can skim past in one glance.
//
// Both tiers are the same shape — label, figure, and a quiet note where the
// figure needs one, because "4m22s" is a different fact from "4m22s from
// +11m39s" and the second is the one worth having. The note is where a number
// says what it is made of, which is the only reason to print thirteen of them
// rather than four.

import { useEffect, useState } from 'react';
import './RatioedStats.css';

// The grid's own breakpoint — the same width the CSS switches columns on.
//
// It has to be known here as well, because how many blank cells a short last
// row needs depends on how many columns there are, and a stylesheet cannot
// count children per row. Two sources for one number is a real cost; the
// alternative was three nth-child rules per breakpoint deciding which of three
// speculative blanks to hide, which is the trap the CSS beside this already
// carries a paragraph about.
const WIDE_QUERY = '(min-width: 44rem)';

/** 4 or 2, live, so the grid re-fills on a rotate or a resize. */
function useColumns() {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(WIDE_QUERY).matches
      : true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(WIDE_QUERY);
    const on = (e) => setWide(e.matches);
    setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide ? 4 : 2;
}

/**
 * @param {object} props
 * @param {Array} props.cells  { key, label, value, note }, falsy entries dropped
 * @param {boolean} [props.dense]  the second tier: smaller, more per row
 */
export default function RatioedStats({ cells, dense = false }) {
  const columns = useColumns();
  const shown = (cells || []).filter((c) => c && c.value != null && c.value !== '');
  // A short last row left the grid's rules stopping mid-air — the block is a
  // ruled table, and a table that trails off looks like it failed to draw
  // rather than like it ran out of figures. The blanks carry the row's borders
  // to the edge and nothing else. Never a whole row of them: `blanks` is always
  // fewer than `columns`, so every row has at least one figure in it.
  const blanks = shown.length ? (columns - (shown.length % columns)) % columns : 0;
  if (!shown.length) return null;
  return (
    <dl className={`ratioed-stats${dense ? ' is-dense' : ''}`}>
      {shown.map((c) => (
        <div key={c.key || c.label}>
          <dt>{c.label}</dt>
          <dd>
            {c.value}
            {c.note && <span className="ratioed-stats-note">{c.note}</span>}
          </dd>
        </div>
      ))}
      {Array.from({ length: blanks }, (_, i) => (
        <div key={`blank-${i}`} className="is-blank" aria-hidden="true" />
      ))}
    </dl>
  );
}
