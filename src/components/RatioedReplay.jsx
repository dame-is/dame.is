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
//
// The transcript under the track is the same playhead. It used to be a second
// component in a folded section below this one, with its own play button, its
// own clock and its own idea of how fast a replay should run — two players for
// one piece, and nothing to tell a reader that the marks up here and the rows
// down there were the same records. Now the marks and the rows arrive
// together, off one clock: the track is where in the piece you are, the rows
// are what has happened by the time you got there.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtDuration, fmtElapsed } from '../lib/ratioed.js';
import { tallyWitness } from '../lib/ratioedLive.js';
import { ME_DID } from '../config.js';
import RatioedTicker, { RatioedCounters } from './RatioedTicker.jsx';
import './RatioedReplay.css';

const KIND_VERB = { like: 'liked it', repost: 'reposted it', quote: 'quoted it', reply: 'replied' };

// Wall-clock milliseconds for each phase when not playing in real time. The
// alive sweep is deliberately unhurried — the point is to be watched.
const FAST_ALIVE_MS = 8000;
const TAIL_MS = 4500;
// Above this, real time stops being the obvious default, though it stays one
// click away at any length. A piece that lived seventeen seconds should take
// seventeen seconds to watch — that's the whole argument — but a minute of
// staring is a different proposition, and take 17's forty-two minutes is a
// different one again. Those open on the quick sweep.
//
// They are still offered it. A replay that only ever runs at 8 seconds is a
// diagram of the piece; the reason to sit through the real thing is precisely
// that most of it is nothing happening, which is what the piece was made of
// and the one thing a sped-up sweep cannot show. The button says how long it
// will take, so nobody starts a forty-minute wait by accident.
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

  // Where a moment sits on the 0 → 2 scale. Used for the marks, and again for
  // the moment a withdrawn record was taken back, which is a second position
  // the same row has to be measured at.
  const posOf = useCallback(
    (offSec) =>
      offSec <= lifeSec
        ? Math.min(1, Math.max(0, offSec / lifeSec))
        : 1 + tailPos(offSec - lifeSec, maxTail),
    [lifeSec, maxTail],
  );

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

  const arrived = useMemo(() => marks.filter((m) => m.at <= progress), [marks, progress]);
  const latest = arrived[arrived.length - 1] || null;
  const sealed = progress >= 1;

  // The same records, in the shape the live feed reads them in — so a piece
  // being replayed a year later looks like the piece being watched, which is
  // the only honest thing for it to look like.
  //
  // The key is made rather than read: the measured log has no record keys in
  // it, because an index answers a piece with counts and handles, not rkeys.
  // Who, what and when is unique enough for a list that never re-orders.
  const feedRows = useMemo(
    () =>
      arrived.map(({ e }) => {
        const goneAt = e.goneMs != null ? posOf(e.goneMs / 1000) : null;
        return {
          ...e,
          rkey: e.rkey || `${e.k}:${Math.round(e.off * 1000)}:${e.did || e.h}`,
          offMs: e.off * 1000,
          after: !e.pre,
          // A withdrawal is something that happens rather than something that
          // was always true: the row stands until the playhead reaches the
          // moment it was taken back, and strikes through there.
          goneMs: goneAt != null && goneAt <= progress ? e.goneMs : undefined,
        };
      }),
    [arrived, progress, posOf],
  );
  const aliveRows = useMemo(() => feedRows.filter((r) => !r.after), [feedRows]);
  const since = feedRows.length - aliveRows.length;
  const tally = useMemo(() => tallyWitness(aliveRows, { selfDid: ME_DID }), [aliveRows]);

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
        {/* Two words, no numbers. The durations used to be printed inside the
            buttons, which made the pair wide enough to wrap onto its own line
            at a phone width — and the one they were there to tell you, how
            long real time takes, is already under the track in the legend.
            They stay in the labels a screen reader and a tooltip read. */}
        <div className="ratioed-seg" role="group" aria-label="Playback speed">
          {[
            [true, 'Real', `the piece's own ${fmtDuration(piece?.lifespanMs)}`],
            [false, 'Quick', `a ${fmtDuration(FAST_ALIVE_MS)} sweep`],
          ].map(([v, label, cost]) => (
            <button
              key={label}
              type="button"
              aria-pressed={realTime === v}
              aria-label={`${label} — ${cost}`}
              title={cost}
              onClick={() => setRealTime(v)}
            >
              {label}
            </button>
          ))}
        </div>
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

      {/* The running commentary, for a reader who is hearing this rather than
          watching it. It says what the top of the list below says; on screen
          that is a duplicate, to a screen reader it is the difference between
          a piece happening and a table appearing. */}
      <p className="ratioed-replay-said" aria-live="polite">
        {latest
          ? `${KIND_VERB[latest.e.k] || latest.e.k} — @${
              profiles[latest.e.did]?.handle || latest.e.h
            } ${
              latest.e.pre
                ? `at +${fmtDuration(latest.e.off * 1000)}`
                : `+${fmtElapsed(latest.e.off - lifeSec)} after the seal`
            }`
          : 'Nothing yet. Nobody has touched it.'}
      </p>

      {/* What the piece has drawn by the time the playhead got here. The
          counters are the alive window only — that is the measurement, and a
          number that keeps climbing through the afterlife is a different
          claim. What has landed since gets its own line. */}
      <RatioedCounters tally={tally} />
      {since > 0 && (
        <p className="ratioed-replay-count">
          {since} more since the seal, on a post nobody can reply to
        </p>
      )}
      <RatioedTicker
        rows={feedRows}
        profiles={profiles}
        openable={false}
        quiet
        empty="Nothing yet. Nobody has touched it."
      />
    </div>
  );
}

function Mark({ mark, left, on, profiles, lifeSec }) {
  const { e } = mark;
  const handle = profiles[e.did]?.handle || e.h;
  const when = e.pre
    ? `+${fmtDuration(e.off * 1000)} · alive`
    : `+${fmtElapsed(e.off - lifeSec)} after the seal`;
  return (
    <span
      className={`ratioed-replay-mark ratioed-k-${e.k}${on ? ' on' : ''}`}
      style={{ left: `${left}%` }}
      title={`${e.k} · @${handle} · ${when}${e.t ? `\n${e.t}` : ''}`}
    />
  );
}
