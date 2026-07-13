import { Heart, Flame, Zap, Footprints, Bike, Car, Armchair, Activity } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useDameState } from '../hooks/useDameState.js';
import { relativeTime } from '../lib/time.js';
import './VitalsPanel.css';

// Past this many minutes with no fresh push, the panel reads as "last seen"
// rather than "now" and dims — a phone that's asleep or dead shouldn't present
// yesterday's heart rate as if it were live.
const STALE_MINUTES = 30;

// Ambient sound meter maps dB across this window onto its five bars: a hushed
// room (~30 dB) lights one bar, a loud space (~90 dB) lights all five.
const DB_MIN = 30;
const DB_MAX = 90;

const ACTIVITY_ICON = {
  stationary: Armchair,
  walking: Footprints,
  running: Footprints,
  cycling: Bike,
  automotive: Car,
};

export default function VitalsPanel() {
  const { vitals } = useDameState();
  const reduce = useReducedMotion();

  // Render an empty-but-present row before data lands so the atmosphere bar
  // doesn't pop a whole extra line in a beat after it opens (matches
  // NowPlaying / ProfileStats' placeholder pattern).
  if (!vitals) {
    return (
      <div className="vitals vitals-empty" aria-hidden="true">
        <span className="chrome-signal-label">state</span>
        <span className="chrome-signal-value">&mdash;</span>
      </div>
    );
  }

  const minutesOld = vitals.sampledAt
    ? (Date.now() - new Date(vitals.sampledAt).getTime()) / 60000
    : Infinity;
  const stale = !Number.isFinite(minutesOld) || minutesOld > STALE_MINUTES;
  const ago = vitals.sampledAt ? relativeTime(vitals.sampledAt) : '';

  const ActivityIcon =
    (vitals.activity && ACTIVITY_ICON[vitals.activity]) || Activity;

  return (
    <div className={`vitals ${stale ? 'is-stale' : ''}`} aria-label="Current state from Dame's phone">
      {vitals.heartRate != null && (
        <span className="vital vital-heart" aria-label={`Heart rate ${vitals.heartRate} beats per minute`}>
          <Heartbeat bpm={vitals.heartRate} animate={!reduce && !stale} />
          <span className="vital-value">{vitals.heartRate}</span>
          <span className="vital-unit">bpm</span>
        </span>
      )}

      {vitals.activity && (
        <span className="vital vital-activity" aria-label={`Currently ${vitals.activity}`}>
          <ActivityIcon className="vital-glyph" size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="vital-word">{vitals.activity}</span>
        </span>
      )}

      {vitals.batteryLevel != null && (
        <span
          className={`vital vital-battery ${vitals.charging ? 'is-charging' : ''} ${
            vitals.batteryLevel <= 15 && !vitals.charging ? 'is-low' : ''
          }`}
          aria-label={`Battery ${vitals.batteryLevel} percent${vitals.charging ? ', charging' : ''}`}
        >
          <BatteryMeter level={vitals.batteryLevel} />
          <span className="vital-value">{vitals.batteryLevel}%</span>
          {vitals.charging && <Zap className="vital-bolt" size={12} strokeWidth={2} aria-hidden="true" />}
        </span>
      )}

      {vitals.caloriesBurned != null && (
        <span className="vital vital-cal" aria-label={`${vitals.caloriesBurned} calories burned today`}>
          <Flame className="vital-glyph" size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="vital-value">{vitals.caloriesBurned}</span>
          <span className="vital-unit">cal</span>
        </span>
      )}

      {vitals.soundLevel != null && (
        <span className="vital vital-sound" aria-label={`Ambient sound ${vitals.soundLevel} decibels`}>
          <SoundMeter db={vitals.soundLevel} />
          <span className="vital-value">{vitals.soundLevel}</span>
          <span className="vital-unit">dB</span>
        </span>
      )}

      {ago && (
        <span className="vital-stamp" title={vitals.sampledAt || undefined}>
          {stale ? 'last seen ' : 'updated '}
          {ago}
        </span>
      )}
    </div>
  );
}

/** A heart that scales on each beat at the actual BPM. Falls back to a still
 *  glyph under reduced-motion or when the reading is stale. */
function Heartbeat({ bpm, animate }) {
  const beat = bpm > 20 && bpm < 260 ? 60 / bpm : null;
  if (!animate || !beat) {
    return <Heart className="vital-glyph vital-glyph-heart" size={14} strokeWidth={1.75} aria-hidden="true" />;
  }
  return (
    <motion.span
      className="vital-heartbeat"
      aria-hidden="true"
      animate={{ scale: [1, 1.22, 0.98, 1] }}
      transition={{ duration: beat, times: [0, 0.18, 0.32, 1], ease: 'easeInOut', repeat: Infinity }}
    >
      <Heart className="vital-glyph vital-glyph-heart" size={14} strokeWidth={1.75} aria-hidden="true" />
    </motion.span>
  );
}

/** A square-cornered battery whose inner fill tracks the charge level. The
 *  fill color comes from CSS (accent when charging, warm when low). */
function BatteryMeter({ level }) {
  const pct = Math.max(0, Math.min(100, level)) / 100;
  const fillW = Math.max(pct > 0 ? 1.5 : 0, 18 * pct);
  return (
    <svg className="vital-battery-svg" viewBox="0 0 27 13" width="27" height="13" aria-hidden="true">
      <rect x="0.5" y="0.5" width="22" height="12" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="24" y="4" width="2.5" height="5" fill="currentColor" />
      <rect className="vital-battery-fill" x="2" y="2" width={fillW} height="9" />
    </svg>
  );
}

/** Five rising bars; how many light up tracks the ambient sound level. */
function SoundMeter({ db }) {
  const frac = Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN)));
  const lit = db > 0 ? Math.max(1, Math.round(frac * 5)) : 0;
  const bars = [3, 5.5, 8, 10.5, 13];
  return (
    <svg className="vital-sound-svg" viewBox="0 0 21 14" width="21" height="14" aria-hidden="true">
      {bars.map((h, i) => (
        <rect
          key={i}
          className={i < lit ? 'vital-sound-bar is-lit' : 'vital-sound-bar'}
          x={i * 4.5}
          y={14 - h}
          width="3"
          height={h}
        />
      ))}
    </svg>
  );
}
