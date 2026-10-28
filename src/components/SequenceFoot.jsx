import { Link } from 'react-router-dom';
import './SequenceFoot.css';

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
];

/** A count as a book would set it in running text: words to twenty. */
export function countWord(n) {
  return WORDS[n] ?? String(n);
}

/**
 * The foot of a page in a sequence: the neighbour before and after it, and
 * the way up to all of them, between two hairlines. Shared by essays, record
 * pages and moth nights, so turning the page reads the same everywhere.
 *
 *   ← EARLIER ESSAY                         LATER ESSAY →
 *   None. This is the first of seven.       How I made an automated…
 *                                           February 5, 2025
 *                     All 7 essays in blogging
 *
 * A missing neighbour says so (`none`) instead of disappearing, so the strip
 * keeps its shape and the reader learns where they are in the run. On a phone
 * the later cell comes first, since that's the one a reader at the end of a
 * page usually wants.
 */
export default function SequenceFoot({
  label = 'More in this sequence',
  earlierLabel = 'Earlier',
  laterLabel = 'Later',
  earlier = null,
  later = null,
  earlierNone = 'None yet.',
  laterNone = 'None yet.',
  all = null,
}) {
  return (
    <nav className="sequence-foot" aria-label={label}>
      <Cell side="earlier" label={earlierLabel} entry={earlier} none={earlierNone} />
      <Cell side="later" label={laterLabel} entry={later} none={laterNone} />
      {all && (
        <Link className="sequence-foot-all" to={all.to}>
          {all.label}
        </Link>
      )}
    </nav>
  );
}

function Cell({ side, label, entry, none }) {
  const arrow = side === 'earlier';
  return (
    <div className={`sequence-foot-cell sequence-foot-${side}`}>
      <span className="sequence-foot-label">
        {arrow && <span aria-hidden="true">&larr; </span>}
        {label}
        {!arrow && <span aria-hidden="true"> &rarr;</span>}
      </span>
      {entry ? (
        <>
          <Link className="sequence-foot-title" to={entry.to}>
            {entry.title}
          </Link>
          {entry.meta && <span className="sequence-foot-meta">{entry.meta}</span>}
        </>
      ) : (
        <span className="sequence-foot-none">{none}</span>
      )}
    </div>
  );
}
