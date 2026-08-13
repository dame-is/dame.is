// A Ratioed piece, replayed.
//
// The essay's lifelines chart plots all thirteen against a shared axis, which
// is what you want to compare them and hopeless for feeling one. A piece that
// lived sixteen seconds is a few pixels there. Here it is the whole width, and
// it arrives in order at something close to the speed it actually happened —
// which is the only way the central fact of the project reads as a fact rather
// than a number: these things were over before most people saw them.
//
// Two phases, because a piece has two clocks. While it is alive, time is
// linear and short. After the seal it runs to years, so the tail is log-scaled
// exactly as the essay's afterlife axis is, and the playhead crosses it at its
// own pace. The rule between them is the threadgate.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtDuration, fmtElapsed } from '../lib/ratioed.js';
import './RatioedReplay.css';

const KIND_VERB = { like: 'liked it', repost: 'reposted it', quote: 'quoted it', reply: 'replied' };

// Wall-clock milliseconds for each phase when not playing in real time. The
// alive sweep is deliberately unhurried — the point is to be watched.
const FAST_ALIVE_MS = 8000;
const TAIL_MS = 4500;
// Above this, real time stops being a viewing option and starts being a wait,
// so it isn't offered at all.
const REAL_TIME_CEILING_MS = 120_000;
// And above THIS it stops being the obvious default, though it's still worth
// offering: a piece that lived seventeen seconds should take seventeen seconds
// to watch — that's the whole argument — but a minute of staring is a different
// proposition, so those open on the quick sweep with real time one click away.
const REAL_TIME_DEFAULT_MS = 45_000;

/** Where a post-seal second sits in the log-scaled tail, as a 0–1 fraction. */
function tailPos(sec, maxSec) {
  return Math.log10(Math.max(sec, 1) + 1) / Math.log10(Math.max(maxSec, 1) + 1);
}

/** The inverse, for putting a readable clock under the playhead. */
function tailSec(frac, maxSec) {
  return 10 ** (frac * Math.log10(Math.max(maxSec, 1) + 1)) - 1;
}

/**
 * Progress runs 0 → 2: the first unit is the piece's life, the second its
 * afterlife. Positions and the playhead share the scale, so "has this arrived
 * yet" is one comparison rather than two cases.
 */
export default function RatioedReplay({ piece, events, profiles = {} }) {
  const lifeSec = Math.max((piece?.lifespanMs || 0) / 1000, 0.001);
  const canRealTime = (piece?.lifespanMs || 0) <= REAL_TIME_CEILING_MS;
  const [realTime, setRealTime] = useState((piece?.lifespanMs || 0) <= REAL_TIME_DEFAULT_MS);
  const [progress, setProgress] = useState(2); // fully played, so a still page shows everything
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);

  const shown = useMemo(() => (events || []).filter((e) => !e.self), [events]);

  const maxTail = useMemo(() => {
    let m = 1;
    for (const e of shown) if (!e.pre) m = Math.max(m, e.off - lifeSec);
    return m;
  }, [shown, lifeSec]);

  const marks = useMemo(
    () =>
      shown
        .map((e, i) => ({
          e,
          i,
          at: e.pre
            ? Math.min(1, Math.max(0, e.off / lifeSec))
            : 1 + tailPos(e.off - lifeSec, maxTail),
        }))
        .sort((a, b) => a.at - b.at),
    [shown, lifeSec, maxTail],
  );

  const aliveMs = realTime ? Math.max(piece?.lifespanMs || 0, 1200) : FAST_ALIVE_MS;

  // One rAF loop for both phases; the phase only changes how much progress a
  // millisecond of wall time buys.
  useEffect(() => {
    if (!playing) return undefined;
    let last = null;
    const step = (now) => {
      if (last == null) last = now;
      const dt = now - last;
      last = now;
      setProgress((p) => {
        const rate = p < 1 ? 1 / aliveMs : 1 / TAIL_MS;
        const next = p + dt * rate;
        if (next >= 2) {
          setPlaying(false);
          return 2;
        }
        return next;
      });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [playing, aliveMs]);

  const play = useCallback(() => {
    setProgress((p) => (p >= 2 ? 0 : p));
    setPlaying(true);
  }, []);

  const arrived = marks.filter((m) => m.at <= progress);
  const latest = arrived[arrived.length - 1] || null;
  const sealed = progress >= 1;

  const clock = sealed
    ? `sealed · +${fmtElapsed(tailSec(progress - 1, maxTail))}`
    : `+${fmtDuration(progress * lifeSec * 1000)}`;

  return (
    <div className="ratioed-replay">
      <div className="ratioed-replay-controls">
        <button
          type="button"
          className="ratioed-replay-play"
          onClick={() => (playing ? setPlaying(false) : play())}
        >
          {playing ? 'Pause' : progress >= 2 ? 'Replay' : 'Play'}
        </button>
        <span className="ratioed-replay-clock">{clock}</span>
        {canRealTime && (
          <div className="ratioed-seg" role="group" aria-label="Playback speed">
            {[
              [true, 'Real time'],
              [false, 'Quick'],
            ].map(([v, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={realTime === v}
                onClick={() => setRealTime(v)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ratioed-replay-track">
        <div className="ratioed-replay-alive" style={{ '--fill': `${Math.min(progress, 1) * 100}%` }}>
          <span className="ratioed-replay-band" />
          {marks
            .filter((m) => m.at <= 1)
            .map((m) => (
              <Mark key={`a${m.i}`} mark={m} left={m.at * 100} on={m.at <= progress} profiles={profiles} lifeSec={lifeSec} />
            ))}
        </div>
        <div className="ratioed-replay-seal" data-on={sealed || undefined} aria-hidden="true" />
        <div
          className="ratioed-replay-after"
          style={{ '--fill': `${Math.max(0, Math.min(progress - 1, 1)) * 100}%` }}
        >
          <span className="ratioed-replay-band" />
          {marks
            .filter((m) => m.at > 1)
            .map((m) => (
              <Mark
                key={`b${m.i}`}
                mark={m}
                left={(m.at - 1) * 100}
                on={m.at <= progress}
                profiles={profiles}
                lifeSec={lifeSec}
              />
            ))}
        </div>
      </div>

      <div className="ratioed-replay-legend" aria-hidden="true">
        <span>alive · {fmtDuration(piece?.lifespanMs)}</span>
        <span>the threadgate</span>
        <span>after the seal · to {fmtElapsed(maxTail)}</span>
      </div>

      <div className="ratioed-replay-scrub">
        <input
          type="range"
          aria-label="Scrub the replay"
          min="0"
          max="2"
          step="0.001"
          value={progress}
          onChange={(ev) => {
            setPlaying(false);
            setProgress(Number(ev.target.value));
          }}
        />
      </div>

      {/* The running commentary. Live region so a screen reader hears the
          piece happen rather than watching it. */}
      <p className="ratioed-replay-caption" aria-live="polite">
        {latest ? (
          <>
            <span className={`ratioed-replay-kind ratioed-k-${latest.e.k}`}>
              {KIND_VERB[latest.e.k] || latest.e.k}
            </span>{' '}
            <span className="ratioed-replay-who">
              @{profiles[latest.e.did]?.handle || latest.e.h}
            </span>{' '}
            <span className="ratioed-replay-off">
              {latest.e.pre
                ? `at +${fmtDuration(latest.e.off * 1000)}`
                : `+${fmtElapsed(latest.e.off - lifeSec)} after the seal`}
            </span>
          </>
        ) : (
          <span className="ratioed-replay-off">
            Nothing yet — the piece is up and nobody has touched it.
          </span>
        )}
      </p>

      <p className="ratioed-replay-count">
        {arrived.filter((m) => m.at <= 1).length} while it was alive ·{' '}
        {arrived.filter((m) => m.at > 1).length} since
      </p>
    </div>
  );
}

function Mark({ mark, left, on, profiles, lifeSec }) {
  const { e } = mark;
  const handle = profiles[e.did]?.handle || e.h;
  const when = e.pre
    ? `+${fmtDuration(e.off * 1000)} — alive`
    : `+${fmtElapsed(e.off - lifeSec)} after the seal`;
  return (
    <span
      className={`ratioed-replay-mark ratioed-k-${e.k}${on ? ' on' : ''}`}
      style={{ left: `${left}%` }}
      title={`${e.k} · @${handle} · ${when}${e.t ? `\n${e.t}` : ''}`}
    />
  );
}
