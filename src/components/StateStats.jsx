import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Heart, Flame, Volume2, Activity, Footprints, Bike, Car, Armchair } from 'lucide-react';
import './StateStats.css';

/**
 * Rich state dashboard — the header on /logging, mirroring ListeningStats on
 * /listening. Derives everything client-side from the is.dame.state history
 * (heart rate, activity, ambient sound, calories) over a selectable window:
 * headline tiles, a heart-rate area chart over time, and a ranked breakdown of
 * time-in-activity. Single-hue (the site accent) throughout — no chart library.
 */

const WINDOWS = [
  { hours: 24, label: '24h' },
  { hours: 24 * 7, label: '7 days' },
];

const ACTIVITY_ICON = {
  stationary: Armchair,
  walking: Footprints,
  running: Footprints,
  cycling: Bike,
  automotive: Car,
};

export default function StateStats({ samples }) {
  const [hours, setHours] = useState(24);
  const stats = useMemo(() => computeStats(samples, hours), [samples, hours]);

  // Nothing yet — let the feed's own skeleton carry the wait.
  if (!samples || samples.length === 0) return null;

  return (
    <section className="state-stats" aria-label="State statistics">
      <div className="state-stats-head">
        <h2 className="state-stats-title">Recent state</h2>
        <div className="state-stats-toggle" role="tablist" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              role="tab"
              aria-selected={hours === w.hours}
              className={`state-stats-tab ${hours === w.hours ? 'is-active' : ''}`}
              onClick={() => setHours(w.hours)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {stats.count === 0 ? (
        <p className="state-stats-empty">No readings in the last {hours === 24 ? '24 hours' : '7 days'}.</p>
      ) : (
        <>
          <div className="state-stats-tiles">
            <Tile value={stats.avgHr} unit="avg bpm" />
            <Tile value={stats.peakHr} unit="peak bpm" />
            <Tile value={stats.calLatest} unit="cal today" />
            <Tile value={stats.avgDb} unit="avg dB" />
            <Tile value={stats.count} unit={stats.count === 1 ? 'reading' : 'readings'} />
          </div>

          <div className="state-stats-panels">
            <div className="state-panel state-panel-chart">
              <h3 className="state-panel-title">
                <Heart className="state-panel-glyph" size={13} strokeWidth={1.9} aria-hidden="true" />
                Heart rate
              </h3>
              <HeartRateChart series={stats.hrSeries} t0={stats.t0} t1={stats.t1} />
            </div>

            <div className="state-panel state-panel-activity">
              <h3 className="state-panel-title">
                <Activity className="state-panel-glyph" size={13} strokeWidth={1.9} aria-hidden="true" />
                Activity
              </h3>
              <ActivityBars rows={stats.activity} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

function Tile({ value, unit }) {
  const has = value != null && Number.isFinite(value);
  const n = useCountUp(has ? value : 0);
  return (
    <div className="state-tile">
      <span className="state-tile-value">{has ? n.toLocaleString() : '—'}</span>
      <span className="state-tile-unit">{unit}</span>
    </div>
  );
}

/** Short eased count-up when the target changes; snaps under reduced-motion. */
function useCountUp(target, ms = 600) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(typeof target === 'number' ? target : 0);
  const fromRef = useRef(0);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (typeof target !== 'number') return undefined;
    if (reduce) {
      setN(target);
      return undefined;
    }
    cancelAnimationFrame(rafRef.current);
    fromRef.current = n;
    startRef.current = performance.now();
    function tick(t) {
      const p = Math.min(1, (t - startRef.current) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(fromRef.current + (target - fromRef.current) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms, reduce]);

  return reduce && typeof target === 'number' ? target : n;
}

/* ------------------------------------------------------------------ */
/* Heart-rate area chart (single series, accent, hover crosshair)      */
/* ------------------------------------------------------------------ */

const CHART_H = 168;
const PAD = { l: 8, r: 10, t: 16, b: 8 };

function HeartRateChart({ series, t0, t1 }) {
  const plotRef = useRef(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState(null); // index into series

  // Draw in real pixels (measured width, fixed height) so uniform scaling
  // keeps dots circular — a stretched viewBox would deform them.
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return undefined;
    const measure = () => setW(el.clientWidth || 0);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => {
      if (ro) ro.disconnect();
    };
  }, []);

  if (!series || series.length === 0) {
    return <p className="state-chart-empty">No heart-rate readings in this window.</p>;
  }

  const values = series.map((p) => p.v);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // Nice, padded y-range clamped to a plausible band.
  const yMin = Math.max(30, Math.floor((dataMin - 6) / 10) * 10);
  const yMax = Math.min(210, Math.ceil((dataMax + 6) / 10) * 10);
  const ySpan = Math.max(1, yMax - yMin);
  const tSpan = Math.max(1, t1 - t0);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const H = CHART_H;
  const ready = w > 0;

  const x = (t) => PAD.l + ((t - t0) / tSpan) * Math.max(1, w - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - ((v - yMin) / ySpan) * (H - PAD.t - PAD.b);
  const baseY = H - PAD.b;

  const pts = ready ? series.map((p) => ({ ...p, cx: x(p.t), cy: y(p.v) })) : [];
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');
  const area = pts.length
    ? `M${pts[0].cx.toFixed(1)},${baseY} ${pts
        .map((p) => `L${p.cx.toFixed(1)},${p.cy.toFixed(1)}`)
        .join(' ')} L${pts[pts.length - 1].cx.toFixed(1)},${baseY} Z`
    : '';
  const ticks = [yMax, avg, yMin].filter((v, i, arr) => arr.indexOf(v) === i);
  const single = pts.length === 1;

  function onMove(e) {
    if (!ready || !plotRef.current) return;
    const rect = plotRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(pts[i].cx - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover(best);
  }

  const hp = hover != null && pts[hover] ? pts[hover] : null;

  return (
    <div className="state-chart">
      <div className="state-chart-plot" ref={plotRef} style={{ height: H }}>
        {ready && (
          <svg
            className="state-chart-svg"
            width={w}
            height={H}
            viewBox={`0 0 ${w} ${H}`}
            role="img"
            aria-label={`Heart rate over time: ${series.length} readings, low ${dataMin}, average ${avg}, high ${dataMax} bpm`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line className="state-chart-grid" x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} />
                <text className="state-chart-ylabel" x={PAD.l + 1} y={y(v) - 3}>
                  {v}
                </text>
              </g>
            ))}

            {!single && <path className="state-chart-area" d={area} />}
            {!single && <path className="state-chart-line" d={line} />}

            {(single || pts.length <= 14) &&
              pts.map((p, i) => <circle key={i} className="state-chart-dot" cx={p.cx} cy={p.cy} r="3" />)}
            {!single && pts.length > 14 && (
              <circle
                className="state-chart-dot state-chart-dot-last"
                cx={pts[pts.length - 1].cx}
                cy={pts[pts.length - 1].cy}
                r="3.4"
              />
            )}

            {hp && (
              <g>
                <line className="state-chart-cross" x1={hp.cx} x2={hp.cx} y1={PAD.t - 6} y2={baseY} />
                <circle className="state-chart-marker" cx={hp.cx} cy={hp.cy} r="4" />
              </g>
            )}
          </svg>
        )}

        {hp && (
          <div className="state-chart-tip" style={{ left: hp.cx, top: hp.cy }}>
            <strong>{hp.v}</strong> bpm
            <span className="state-chart-tip-time">{clockLabel(hp.t)}</span>
          </div>
        )}
      </div>

      <div className="state-chart-xaxis" aria-hidden="true">
        <span>{t0Label(t1 - t0)}</span>
        <span>now</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Activity ranked bars (single hue, direct % labels)                  */
/* ------------------------------------------------------------------ */

function ActivityBars({ rows }) {
  if (!rows || rows.length === 0) {
    return <p className="state-chart-empty">No activity readings in this window.</p>;
  }
  const max = Math.max(...rows.map((r) => r.pct));
  return (
    <ul className="state-bars">
      {rows.map((r) => {
        const Icon = ACTIVITY_ICON[r.activity] || Activity;
        return (
          <li key={r.activity} className="state-bar-row">
            <span className="state-bar-label">
              <Icon className="state-bar-glyph" size={13} strokeWidth={1.75} aria-hidden="true" />
              {r.activity}
            </span>
            <span className="state-bar-track" aria-hidden="true">
              <span className="state-bar-fill" style={{ width: `${max > 0 ? (r.pct / max) * 100 : 0}%` }} />
            </span>
            <span className="state-bar-pct">{Math.round(r.pct * 100)}%</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

function computeStats(samples, hours) {
  const t1 = Date.now();
  const t0 = t1 - hours * 3600 * 1000;
  const win = (samples || []).filter((s) => s.t >= t0 && s.t <= t1);

  const hr = win.map((s) => s.heartRate).filter((n) => n != null);
  const db = win.map((s) => s.soundLevel).filter((n) => n != null);
  const avgHr = hr.length ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) : null;
  const peakHr = hr.length ? Math.max(...hr) : null;
  const avgDb = db.length ? Math.round(db.reduce((a, b) => a + b, 0) / db.length) : null;

  // Calories reset daily; the latest reading is "today so far".
  let calLatest = null;
  for (let i = win.length - 1; i >= 0; i--) {
    if (win[i].caloriesBurned != null) {
      calLatest = win[i].caloriesBurned;
      break;
    }
  }

  // Activity distribution (share of samples in each state).
  const actMap = new Map();
  for (const s of win) if (s.activity) actMap.set(s.activity, (actMap.get(s.activity) || 0) + 1);
  const actTotal = Array.from(actMap.values()).reduce((a, b) => a + b, 0);
  const activity = Array.from(actMap.entries())
    .map(([activity, count]) => ({ activity, count, pct: actTotal ? count / actTotal : 0 }))
    .sort((a, b) => b.count - a.count);

  const hrSeries = win.filter((s) => s.heartRate != null).map((s) => ({ t: s.t, v: s.heartRate }));

  return { count: win.length, avgHr, peakHr, avgDb, calLatest, activity, hrSeries, t0, t1 };
}

function t0Label(spanMs) {
  const h = Math.round(spanMs / 3600000);
  if (h <= 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function clockLabel(t) {
  try {
    return new Date(t).toLocaleString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
