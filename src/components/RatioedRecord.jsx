// The record a live piece is running at.
//
// Every Ratioed piece is a race it is trying to lose slowly: the goal is zero
// likes, so the longer it stands the better it is doing, and the only number
// that makes "how well is this one going" legible while it is going is the
// longest one that has already happened. A clock counting up says how long it
// has been. A clock counting up against a mark says whether that is a lot.
//
// The bar is the piece's life as a fraction of the record. When it fills, the
// piece IS the record — the mark stops being something to reach and becomes
// something being left behind, and the component says so in those terms, because
// at that moment nothing on the screen is a comparison any more.

import { fmtDuration } from '../lib/ratioed.js';
import './RatioedRecord.css';

/**
 * `elapsedMs` is how long the live piece has stood. `record` is the longest
 * finished piece (see `longestPiece`) — null before anything has ended, which
 * is the state take #1 was in and nothing since.
 */
export default function RatioedRecord({ elapsedMs = 0, record, compact = false }) {
  if (!record?.lifespanMs) return null;
  const target = record.lifespanMs;
  const beaten = elapsedMs >= target;
  const frac = Math.max(0, Math.min(1, elapsedMs / target));
  const take = String(record.take ?? '').padStart(2, '0');

  return (
    <div className={`rr-chase${beaten ? ' is-beaten' : ''}${compact ? ' is-compact' : ''}`}>
      <div
        className="rr-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.round(target / 1000)}
        aria-valuenow={Math.round(Math.min(elapsedMs, target) / 1000)}
        aria-label={`Toward the longest piece, take ${take}`}
      >
        <span className="rr-fill" style={{ width: `${frac * 100}%` }} />
      </div>
      <p className="rr-say">
        {beaten ? (
          <>
            <strong>The longest piece in the series</strong>, by{' '}
            {fmtDuration(elapsedMs - target)} over take {take}.
          </>
        ) : (
          <>
            <strong>{fmtDuration(target - elapsedMs)}</strong> from take {take}&rsquo;s record of{' '}
            {fmtDuration(target)}.
          </>
        )}
      </p>
    </div>
  );
}
