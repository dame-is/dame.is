// Every take by how long it stood, with the live one climbing among them.
//
// The record bar measured a running piece against the longest take alone, and
// the timeline's ticks place the rest of the series along the clock. This says
// the other thing a reader wants while a piece is up: where it stands. One
// thin bar per take, longest first, and the live take's bar among them in its
// own colour, moving up the list as it outlives each piece below it. Bars it
// has passed go quiet; the ones still ahead stay dark.
//
// Drawn in a wing of the page grid beside the thread, on the piece's page and
// in the studio. The bars are a picture of the sentence over them, so the
// sentence is what a screen reader gets.

import { useMemo } from 'react';
import { fmtDuration } from '../lib/ratioed.js';
import { seriesRank, seriesSentence } from '../lib/ratioedScope.js';
import './RatioedSeries.css';

const pad = (take) => String(take ?? '').padStart(2, '0');

/**
 * @param {object} props
 * @param {Array}  props.pieces      the finished pieces
 * @param {number} props.take        the live take
 * @param {number} props.standingMs  how long it has stood; the like's offset
 *                                   once somebody has liked it
 * @param {boolean} [props.ended]    somebody has liked it, so it no longer climbs
 * @param {string} [props.className]
 */
export default function RatioedSeries({ pieces, take, standingMs = 0, ended = false, className = '' }) {
  const { bars, rank, total } = useMemo(
    () => seriesRank(pieces, { take, standingMs }),
    [pieces, take, standingMs],
  );
  // The longest finished take, for the line under the bars.
  const record = bars.find((b) => !b.live) || null;
  const leading = rank === 1;

  return (
    <section
      className={`rseries${ended ? ' is-ended' : ''}${className ? ` ${className}` : ''}`}
      aria-label="The series"
    >
      <p className="rseries-head">The series</p>
      <p className="rseries-say">{seriesSentence({ rank, total, ended })}</p>
      <ol className="rseries-bars" aria-hidden="true">
        {bars.map((b) => {
          const at = `${(b.at * 100).toFixed(2)}%`;
          return (
            <li
              key={b.key}
              className={`rseries-bar${b.live ? ' is-live' : b.passed ? ' is-passed' : ''}`}
              title={`take ${pad(b.take)} · ${fmtDuration(b.ms)}`}
            >
              <span className="rseries-fill" style={{ width: at }} />
              {b.live && (
                <span className={`rseries-tag${b.at > 0.55 ? ' is-flip' : ''}`} style={{ left: at }}>
                  {pad(take)} · {ended ? 'over' : 'now'}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {record && (
        <p className="rseries-foot">
          {leading
            ? `past take ${pad(record.take)}’s ${fmtDuration(record.ms)}`
            : `take ${pad(record.take)} · ${fmtDuration(record.ms)}, the record`}
        </p>
      )}
    </section>
  );
}
