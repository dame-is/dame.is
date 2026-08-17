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

import './RatioedStats.css';

/**
 * @param {object} props
 * @param {Array} props.cells  { key, label, value, note }, falsy entries dropped
 * @param {boolean} [props.dense]  the second tier: smaller, more per row
 */
export default function RatioedStats({ cells, dense = false, className = '' }) {
  const shown = (cells || []).filter((c) => c && c.value != null && c.value !== '');
  if (!shown.length) return null;
  return (
    <dl className={`ratioed-stats${dense ? ' is-dense' : ''}${className ? ` ${className}` : ''}`}>
      {shown.map((c) => (
        <div key={c.key || c.label}>
          <dt>{c.label}</dt>
          <dd>
            {c.value}
            {c.note && <span className="ratioed-stats-note">{c.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
