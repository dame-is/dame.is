// What a live piece is doing, in a sentence — and what it has drawn, in another.
//
// The studio's panel and the piece's own page open the same way since the
// ledger: "Standing for 33m31s." in the size of a headline, how that compares
// with the longest piece so far under it, and the bar as a rule beneath both.
// It replaced a clock in the corner of a box, which said how long and nothing
// else, and a sentence under a gauge that the eye had to go looking for.
//
// When a like lands the same block says so in the same place: who, when, and
// the reaction time running. The block holds its height between the two
// (RatioedStanding.css), so nothing under it moves at the moment it changes —
// in the studio that is the seal button, which is where a thumb is waiting.

import { fmtDuration } from '../lib/ratioed.js';
import { countsSentence } from '../lib/ratioedLedger.js';
import RatioedClock from './RatioedClock.jsx';
import RatioedRecord from './RatioedRecord.jsx';
import './RatioedStanding.css';

/**
 * @param {object} props
 * @param {number} props.aliveMs   how long it has stood
 * @param {object} [props.record]  the longest finished piece, for the comparison
 * @param {Array}  [props.pieces]  the finished pieces, for the bar's ticks
 * @param {Array}  [props.marks]   `{ offMs, title }` for the bar: withdrawals
 * @param {boolean} [props.sealed] it has been sealed, so it stood rather than stands
 * @param {object} [props.like]    `{ handle, offMs, atMs }` once it has been
 *                                 liked. `offMs` and `atMs` are null when only
 *                                 the AppView has seen it, which answers who
 *                                 but not when.
 * @param {string} [props.clockLabel]  what the running reaction time is called
 * @param {boolean} [props.clockFirst] the figure before its label rather than after
 * @param {boolean} [props.clockRunning] false freezes it, as the seal does
 */
export default function RatioedStanding({
  aliveMs = 0,
  record = null,
  pieces = null,
  marks = null,
  sealed = false,
  like = null,
  clockLabel = 'your reaction so far',
  clockFirst = false,
  clockRunning = true,
}) {
  if (like) {
    const clock =
      like.atMs != null ? (
        <RatioedClock fromMs={like.atMs} running={clockRunning} className="rstand-clock" />
      ) : null;
    return (
      <div className="rstand is-liked">
        {/* Announced once, as it lands. The clock under it is outside the
            region on purpose: it changes twenty times a second, and inside a
            status region every change is something to read aloud. */}
        <p className="rstand-head" role="status">
          <span className="rstand-who">@{like.handle}</span> liked it
          {like.offMs != null && <> at +{fmtDuration(like.offMs)}</>}.
        </p>
        {clock && (
          <p className="rstand-race">
            {clockFirst ? (
              <>
                {clock} <span className="rstand-race-label">{clockLabel}</span>
              </>
            ) : (
              <>
                <span className="rstand-race-label">{clockLabel}</span> {clock}
              </>
            )}
          </p>
        )}
        {/* The bar has nothing left to measure toward: the piece is over, and
            the rule says so in the seal's colour, end to end. */}
        <div className="rstand-rule" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="rstand">
      <p className="rstand-head">
        {sealed ? 'Stood for' : 'Standing for'}{' '}
        <span className="rstand-time">{fmtDuration(aliveMs)}</span>.
      </p>
      <RatioedRecord elapsedMs={aliveMs} record={record} pieces={pieces} marks={marks} />
    </div>
  );
}

/**
 * What the piece has drawn, as the sentences `countsSentence` writes, each in
 * its tone: the likes sentence is the one that matters and reads differently
 * while there are none, once there is one, and for one taken back.
 */
export function RatioedCounts({ rows, selfDid, className = '' }) {
  const segments = countsSentence(rows, { selfDid });
  return (
    // Not a live region: it changes with every arrival, and the thread under
    // it is where those are read.
    <p className={`rstand-counts${className ? ` ${className}` : ''}`}>
      {segments.map((s, i) => (
        <span key={s.text} className={s.tone ? `is-${s.tone}` : undefined}>
          {i > 0 ? ' ' : ''}
          {s.text}
        </span>
      ))}
    </p>
  );
}
