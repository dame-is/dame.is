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
//
// Every other take is a tick along the way. The record is the least typical
// piece in the series — take 14 stood for 42 minutes and nine of the sixteen
// were over inside two — so a bar drawn only against it is a long empty run
// with one mark at the end, and the thing actually happening while a piece is
// up (it has now outlived take 3, and take 7, and take 12) had no shape at all.
// The ticks crowd at the left, which is the finding rather than a defect.

import { fmtDuration, chaseTicks } from '../lib/ratioed.js';
import './RatioedRecord.css';

/**
 * `elapsedMs` is how long the live piece has stood. `record` is the longest
 * finished piece (see `longestPiece`) — null before anything has ended, which
 * is the state take #1 was in and nothing since. `pieces` is the rest of the
 * series, for the ticks; without it the bar draws as it always did.
 */
export default function RatioedRecord({ elapsedMs = 0, record, pieces = null }) {
  if (!record?.lifespanMs) return null;
  const target = record.lifespanMs;
  const beaten = elapsedMs >= target;
  const frac = Math.max(0, Math.min(1, elapsedMs / target));
  const take = String(record.take ?? '').padStart(2, '0');
  const ticks = chaseTicks(pieces, record, elapsedMs);
  const passed = ticks.filter((t) => t.passed).length;

  return (
    <div className={`rr-chase${beaten ? ' is-beaten' : ''}`}>
      <div
        className="rr-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.round(target / 1000)}
        aria-valuenow={Math.round(Math.min(elapsedMs, target) / 1000)}
        aria-label={`Toward the longest piece, take ${take}`}
      >
        <span className="rr-fill" style={{ width: `${frac * 100}%` }} />
        {/* Drawn over the fill rather than under it: a tick the piece has
            passed is the interesting one, and it should read as a mark on the
            bar rather than as something the bar has painted out. */}
        {ticks.map((t) => (
          <span
            key={t.rkey}
            className={`rr-tick${t.passed ? ' is-passed' : ''}`}
            style={{ left: `${t.at * 100}%` }}
            title={`take ${String(t.take).padStart(2, '0')} · ${fmtDuration(t.lifespanMs)}`}
          />
        ))}
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
            {/* The count says what the ticks show, for anyone reading this on a
                screen reader or at a width where the marks blur together. */}
            {ticks.length > 0 && (
              <>
                {' '}
                Past {passed} of {ticks.length + 1}.
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
