// A live piece on the page grid's clock.
//
// The record bar under a running piece said how far it had got toward the
// longest take, as a fraction, and nothing about what had happened along the
// way. This draws the same race as time. A lane for each kind of record —
// likes at the top, because one of them ends it — and a mark in its lane for
// every record, where it landed. The rest of the series stands along the top as
// ticks at the lengths they stood, crowded at the left, which is the finding:
// most takes are over in minutes. The record's tick is the tall one.
//
// The clock is the page grid. One column is a fixed number of minutes (six, on
// a window wide enough for ten columns), so the grid's own hairlines are the
// axis and the labels only confirm what the columns already say. The step is
// chosen from how many columns the drawing has, measured rather than assumed,
// because the same component is drawn ten columns wide on a desk, six on a
// tablet and as three column-widths on a phone (see lib/ratioedScope.js).
//
// It is drawn on both live surfaces: the piece's own page, and the studio,
// where the artist is deciding whether to press Seal.

import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDuration } from '../lib/ratioed.js';
import { breakingWitness } from '../lib/ratioedLive.js';
import { scopeColumns, scopeStep, scopeAxis, columnSays } from '../lib/ratioedScope.js';
import './RatioedSeismograph.css';

const MIN = 60_000;

// Top to bottom. Likes first: one of them is the end of the piece, and it
// should be the first lane the eye crosses.
const LANES = [
  { k: 'like', label: 'likes' },
  { k: 'quote', label: 'quotes' },
  { k: 'repost', label: 'reposts' },
  { k: 'reply', label: 'replies' },
];
const VERB = { like: 'liked', quote: 'quoted', repost: 'reposted', reply: 'replied' };

// Roughly how wide a tag runs, for deciding which side of its mark it reads
// on. A tag near the right edge flips to the left rather than being clipped.
const TAG_ROOM = 240;

/**
 * The drawing's width, and the grid's column and pitch in pixels, measured
 * from two probes sized in the grid's own tokens. Measured rather than
 * computed from rem, so a change to the grid in theme.css is a change here.
 */
function useGridBox(frame, colProbe, pitchProbe) {
  const [box, setBox] = useState(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    const read = () => {
      const width = el.getBoundingClientRect().width;
      const col = colProbe.current?.getBoundingClientRect().width || 0;
      const pitch = pitchProbe.current?.getBoundingClientRect().width || 0;
      setBox((b) => (b && b.width === width && b.col === col && b.pitch === pitch ? b : { width, col, pitch }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame, colProbe, pitchProbe]);
  return box;
}

const pad = (take) => String(take ?? '').padStart(2, '0');

/**
 * @param {object} props
 * @param {Array}  props.rows       the witnessed log, earliest first
 * @param {number} props.elapsedMs  how long the piece has been up
 * @param {Array}  [props.pieces]   the finished pieces, for the ticks
 * @param {object} [props.record]   the longest of them
 * @param {number} [props.take]     the live take, for what the drawing says aloud
 * @param {string} [props.selfDid]  the artist, whose own records are drawn faint
 * @param {object} [props.profiles] did → { handle }, for naming the like
 * @param {object|null} [props.breaker] the like that ended it, when the caller
 *                                 knows better than the log alone: the studio
 *                                 holds it back while its stream is still
 *                                 replaying, so a like cast and taken back
 *                                 minutes ago doesn't flash through every lane
 *                                 on its way to being an outline. Left out,
 *                                 it is the earliest like still standing.
 * @param {string} [props.className]
 */
export default function RatioedSeismograph({
  rows,
  elapsedMs = 0,
  pieces = null,
  record = null,
  take = null,
  selfDid = null,
  profiles = {},
  breaker: given,
  className = '',
}) {
  const frame = useRef(null);
  const colProbe = useRef(null);
  const pitchProbe = useRef(null);
  const box = useGridBox(frame, colProbe, pitchProbe);

  const recordMs = record?.lifespanMs || 0;
  const cols = box ? scopeColumns(box.width, box.pitch, box.pitch - box.col) : 0;
  const step = scopeStep(cols, Math.max(recordMs, elapsedMs));
  const perMs = box?.pitch ? box.pitch / (step * MIN) : 0;
  const x = (ms) => Math.max(0, ms || 0) * perMs;
  const width = box?.width || 0;

  const found = useMemo(() => breakingWitness(rows), [rows]);
  const breaker = given === undefined ? found : given;
  const ticks = useMemo(
    () =>
      (pieces || [])
        .filter((p) => p.lifespanMs > 0)
        .map((p) => ({ rkey: p.rkey, take: p.take, ms: p.lifespanMs, isRecord: p.rkey === record?.rkey })),
    [pieces, record],
  );

  const ended = Boolean(breaker);
  const nowX = x(elapsedMs);
  const recordX = x(recordMs);
  // The two tags share the top row; when they would run into each other the
  // record's gives way, and its tick still carries the take on its title.
  const showRecordTag = recordMs > 0 && Math.abs(recordX - nowX) > TAG_ROOM * 0.8;
  const breakerHandle = breaker ? profiles[breaker.did]?.handle || breaker.h || 'somebody' : '';

  const count = (rows || []).filter((r) => !(selfDid && r.did === selfDid)).length;
  const summary = `${count} record${count === 1 ? '' : 's'} on take ${pad(take)} in ${fmtDuration(elapsedMs)}${
    ended ? `, ended by a like at +${fmtDuration(breaker.offMs)}` : ''
  }, drawn ${columnSays(step)} to a column.`;

  return (
    <figure className={`rscope${ended ? ' is-ended' : ''}${className ? ` ${className}` : ''}`}>
      <div className="rscope-frame" ref={frame} role="img" aria-label={summary}>
        <span className="rscope-probe is-col" ref={colProbe} aria-hidden="true" />
        <span className="rscope-probe is-pitch" ref={pitchProbe} aria-hidden="true" />
        <div className="rscope-top">
          {box &&
            ticks.map((t) => (
              <span
                key={t.rkey}
                className={`rscope-tick${t.ms <= elapsedMs ? ' is-passed' : ''}${t.isRecord ? ' is-record' : ''}`}
                style={{ left: `${x(t.ms)}px` }}
                title={`take ${pad(t.take)} · ${fmtDuration(t.ms)}`}
              />
            ))}
          {box && showRecordTag && (
            <span
              className={`rscope-tag is-record${recordX < TAG_ROOM ? ' is-right' : ''}`}
              style={{ left: `${recordX}px` }}
            >
              take {pad(record.take)} · {fmtDuration(recordMs)}, the record
            </span>
          )}
          {box && (
            <span
              className={`rscope-tag is-now${nowX > width - TAG_ROOM / 2 ? ' is-left' : ''}`}
              style={{ left: `${nowX}px` }}
            >
              now · {fmtDuration(elapsedMs)}
            </span>
          )}
        </div>
        <div className="rscope-lanes">
          {box && <span className="rscope-wash" style={{ width: `${nowX}px` }} />}
          {LANES.map((l) => (
            <span key={l.k} className={`rscope-lane is-${l.k}`}>
              <span className="rscope-lane-name">{l.label}</span>
            </span>
          ))}
          {box &&
            (rows || []).map((r) => {
              if (!VERB[r.k] || typeof r.offMs !== 'number') return null;
              const gone = r.goneMs != null;
              const self = Boolean(selfDid && r.did === selfDid);
              const who = profiles[r.did]?.handle || r.h || 'somebody';
              return (
                <span
                  key={r.rkey || `${r.k}-${r.offMs}-${r.did}`}
                  className={`rscope-mark is-${r.k}${self ? ' is-self' : ''}${gone ? ' is-gone' : ''}${
                    r === breaker ? ' is-breaking' : ''
                  }`}
                  style={{ left: `${x(r.offMs)}px` }}
                  title={`@${who} ${VERB[r.k]} at +${fmtDuration(r.offMs)}${
                    gone ? `, taken back at +${fmtDuration(r.goneMs)}` : ''
                  }`}
                />
              );
            })}
          {box && breaker && (
            <span
              className={`rscope-break-tag${x(breaker.offMs) > width - TAG_ROOM ? ' is-left' : ''}`}
              style={{ left: `${x(breaker.offMs)}px` }}
            >
              @{breakerHandle} liked it · +{fmtDuration(breaker.offMs)}
            </span>
          )}
          {box && <span className="rscope-now" style={{ left: `${nowX}px` }} aria-hidden="true" />}
        </div>
        <div className="rscope-axis">
          {box &&
            scopeAxis(cols, step).map((a) => (
              <span key={a.i} className="rscope-ax" style={{ left: `${a.i * box.pitch}px` }}>
                {a.label}
              </span>
            ))}
        </div>
      </div>
      <figcaption className="rscope-cap">
        Each column of the grid is {columnSays(step)}. The ticks along the top are where the other{' '}
        {ticks.length} take{ticks.length === 1 ? '' : 's'} ended
        {recordMs > 0 ? <>; the tall one is take {pad(record.take)}’s record</> : null}.
      </figcaption>
    </figure>
  );
}
