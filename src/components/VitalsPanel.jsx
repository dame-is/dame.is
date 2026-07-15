import {
  Heart, Flame, Footprints, Bike, Car, Armchair, PersonStanding, Volume2,
  BatteryLow, BatteryMedium, BatteryFull, BatteryCharging,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useDameState } from '../hooks/useDameState.js';
import { activityLabel } from '../lib/activity.js';
import DayOfLifeTicker from './DayOfLifeTicker.jsx';
import './VitalsPanel.css';

const ACTIVITY_ICON = {
  stationary: Armchair,
  walking: Footprints,
  running: Footprints,
  cycling: Bike,
  automotive: Car,
};

// A lucide battery glyph that reflects charge / charging state.
function batteryIcon(level, charging) {
  if (charging) return BatteryCharging;
  if (level > 66) return BatteryFull;
  if (level > 33) return BatteryMedium;
  return BatteryLow;
}

export default function VitalsPanel() {
  const { vitals } = useDameState();
  const reduce = useReducedMotion();

  // Nothing worth showing — no data yet, or every reading came back empty/0
  // (see normalizeVitals). Render an empty-but-present row so the atmosphere
  // bar doesn't pop a whole extra line a beat after it opens.
  const hasAny =
    vitals &&
    (vitals.heartRate != null ||
      vitals.activity ||
      vitals.batteryLevel != null ||
      vitals.caloriesBurned != null ||
      vitals.soundLevel != null);

  if (!hasAny) {
    return (
      <div className="vitals vitals-empty" aria-hidden="true">
        <span className="chrome-signal-label">state</span>
        <span className="chrome-signal-value">&mdash;</span>
      </div>
    );
  }

  const ActivityIcon =
    (vitals.activity && ACTIVITY_ICON[vitals.activity]) || PersonStanding;
  const BatteryIcon =
    vitals.batteryLevel != null ? batteryIcon(vitals.batteryLevel, vitals.charging) : null;

  return (
    <div className="vitals" aria-label="Current state from Dame's phone">
      {vitals.heartRate != null && (
        <span className="vital vital-heart" aria-label={`Heart rate ${vitals.heartRate} beats per minute`}>
          <Heartbeat bpm={vitals.heartRate} animate={!reduce} />
          <span className="vital-value">{vitals.heartRate}</span>
          <span className="vital-unit">bpm</span>
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
          <Volume2 className="vital-glyph" size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="vital-value">{vitals.soundLevel}</span>
          <span className="vital-unit">dB</span>
        </span>
      )}

      {BatteryIcon && (
        <span
          className={`vital vital-battery ${vitals.charging ? 'is-charging' : ''} ${
            vitals.batteryLevel <= 15 && !vitals.charging ? 'is-low' : ''
          }`}
          aria-label={`Battery ${vitals.batteryLevel} percent${vitals.charging ? ', charging' : ''}`}
        >
          <BatteryIcon className="vital-glyph" size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="vital-value">{vitals.batteryLevel}%</span>
        </span>
      )}

      {/* Activity sits last — it's a word rather than a number, so it reads
          cleanly at the end of the numeric run. */}
      {vitals.activity && (
        <span className="vital vital-activity" aria-label={`Currently ${activityLabel(vitals.activity)}`}>
          <ActivityIcon className="vital-glyph" size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="vital-word">{activityLabel(vitals.activity)}</span>
        </span>
      )}

      {/* Right edge: day of life, in the same small-caps label voice as
          LISTENING TO / FOLLOWED BY one bar up. */}
      <DayOfLifeTicker />
    </div>
  );
}

/** A heart with a gentle beat at the actual BPM — a subtle pulse, not a throb.
 *  Falls back to a still glyph under reduced-motion. */
function Heartbeat({ bpm, animate }) {
  const beat = bpm > 20 && bpm < 260 ? 60 / bpm : null;
  if (!animate || !beat) {
    return <Heart className="vital-glyph vital-glyph-heart" size={14} strokeWidth={1.75} aria-hidden="true" />;
  }
  return (
    <motion.span
      className="vital-heartbeat"
      aria-hidden="true"
      animate={{ scale: [1, 1.09, 1.01, 1.05, 1] }}
      transition={{ duration: beat, times: [0, 0.16, 0.3, 0.44, 1], ease: 'easeInOut', repeat: Infinity }}
    >
      <Heart className="vital-glyph vital-glyph-heart" size={14} strokeWidth={1.75} aria-hidden="true" />
    </motion.span>
  );
}
