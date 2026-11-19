// The radar: you at the centre, each band a ring, each slice a way in
// (what an account did to a post, or how it came to be on the list).
//
// Where each mark goes comes from bluesky-mod-client (place, texture), so it
// sits where the bot's own panel puts it. The drawing is this site's: SVG,
// hairline rings, and the hub's tokens for colour, so it follows the hourly
// palette like everything else. Strangers are texture, not marks: a batch of
// 4,000 has a shape here without 4,000 things to tab through.
//
// Every number on it is also in words under it, and the people on it are in
// the list beside it, which is what a screen reader is given.

import { useMemo } from 'react';
import { EDGES, place, sectorAngles, texture } from 'bluesky-mod-client';
import { BAND_LABEL, fmt } from './ui.jsx';

const NEAR = ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE'];

/**
 * @param {object} props
 * @param {{ did: string, band: string, sector: number, name?: string }[]} props.points
 *   accounts close enough to mark, each in a sector
 * @param {number[]} props.far  strangers per sector
 * @param {{ key: string, label: string }[]} props.sectors
 * @param {(did: string) => void} [props.onOpen]
 * @param {string} props.label
 */
export default function Radar({ points, far, sectors, onOpen, label }) {
  const n = Math.max(1, sectors.length);
  const placed = useMemo(
    () =>
      place(
        points.map((p) => ({ ...p, id: p.did })),
        n,
      ),
    [points, n],
  );
  const dots = useMemo(() => texture(far, { max: 500 }), [far]);
  const slices = sectorAngles(n);
  const strangers = far.reduce((a, b) => a + b, 0);
  const counts = NEAR.map((b) => [
    b,
    points.filter((p) => p.band === b).length,
  ]);

  return (
    <figure className="mh-radar">
      <svg
        className="mh-radar-svg"
        viewBox="-1.08 -1.08 2.16 2.16"
        role="img"
        aria-label={`${label}: ${fmt(points.length)} near you, ${fmt(strangers)} strangers`}
      >
        {[EDGES.OUTER, EDGES.PERIPHERAL, EDGES.CONNECTED, EDGES.PROTECTED].map(
          (r) => (
            <circle key={r} className="mh-radar-ring" r={r} />
          ),
        )}
        {n > 1 &&
          slices.map((s) => (
            <line
              key={s.start}
              className="mh-radar-slice"
              x1={EDGES.PROTECTED * Math.cos(s.start)}
              y1={EDGES.PROTECTED * Math.sin(s.start)}
              x2={Math.cos(s.start)}
              y2={Math.sin(s.start)}
            />
          ))}
        {dots.map((d, i) => (
          <circle
            key={i}
            className="mh-radar-dot"
            cx={d.x}
            cy={d.y}
            r={0.006}
          />
        ))}
        {placed.map((p) => (
          <circle
            key={p.did}
            className={`mh-radar-mark mh-radar-mark--${p.band.toLowerCase()}`}
            cx={p.x}
            cy={p.y}
            r={p.band === 'NOTABLE' ? 0.016 : 0.02}
            onClick={onOpen ? () => onOpen(p.did) : undefined}
          >
            <title>{`${p.name || p.did} · ${BAND_LABEL[p.band] || p.band}`}</title>
          </circle>
        ))}
        <circle className="mh-radar-you" r={0.018} />
      </svg>
      <figcaption className="mh-radar-caption">
        <span className="mh-radar-legend">
          {counts
            .filter(([, c]) => c > 0)
            .map(([b, c]) => (
              <span key={b} className="mh-radar-key">
                <svg viewBox="-1 -1 2 2" aria-hidden="true">
                  <circle
                    className={`mh-radar-mark mh-radar-mark--${b.toLowerCase()}`}
                    r={0.7}
                  />
                </svg>
                {BAND_LABEL[b]} {fmt(c)}
              </span>
            ))}
          {strangers > 0 && (
            <span className="mh-radar-key">
              <svg viewBox="-1 -1 2 2" aria-hidden="true">
                <circle className="mh-radar-dot" r={0.35} />
              </svg>
              Strangers {fmt(strangers)}
            </span>
          )}
        </span>
        {n > 1 && (
          <span className="mh-small mh-muted">
            Slices, clockwise from the top:{' '}
            {sectors
              .map((s, i) => {
                const near = points.filter((p) => p.sector === i).length;
                return `${s.label} ${fmt(near + (far[i] || 0))}`;
              })
              .join(' · ')}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
