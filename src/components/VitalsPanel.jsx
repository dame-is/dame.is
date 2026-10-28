import {
  Heart, Flame, Footprints, Bike, Car, Armchair, PersonStanding, Volume2,
  BatteryLow, BatteryMedium, BatteryFull, BatteryCharging,
} from 'lucide-react';
import { memo } from 'react';
import { useReducedMotion } from 'motion/react';
import { useDameState } from '../hooks/useDameState.js';
import { activityLabel } from '../lib/activity.js';
import { relativeTime } from '../lib/time.js';
import { vitalsFreshness } from '../lib/vitals.js';
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

// Memoised: it takes no props, and the top chrome around it re-renders as the
// page scrolls.
export default memo(function VitalsPanel() {
  const { vitals } = useDameState();
  const reduce = useReducedMotion();

  // The newest is.dame.state record is whatever the phone last posted, which
  // overnight is routinely eight hours ago and, if the phone stops posting,
  // forever. It's labelled with its age; a stale one stops beating and dims,
  // and one more than a day old isn't shown at all (see vitalsFreshness).
  const { stale, expired } = vitalsFreshness(vitals?.sampledAt);
  const age = vitals?.sampledAt ? relativeTime(vitals.sampledAt) : '';

  // Nothing worth showing — no data yet, every reading came back empty/0 (see
  // normalizeVitals), or the last one is too old to be called a state. Render
  // an empty-but-present row so the atmosphere bar doesn't pop a whole extra
  // line a beat after it opens. Day of life still rides at its right edge: on
  // a desktop this is the only copy of it on screen.
  const hasAny =
    vitals &&
    !expired &&
    (vitals.heartRate != null ||
      vitals.activity ||
      vitals.batteryLevel != null ||
      vitals.caloriesBurned != null ||
      vitals.soundLevel != null);

  if (!hasAny) {
    return (
      <div className="vitals vitals-empty">
        <span className="chrome-signal-label" aria-hidden="true">
          state
        </span>
        <span className="chrome-signal-value" aria-hidden="true">
          &mdash;
        </span>
        <DayOfLifeTicker />
      </div>
    );
  }

  const ActivityIcon =
    (vitals.activity && ACTIVITY_ICON[vitals.activity]) || PersonStanding;
  const BatteryIcon =
    vitals.batteryLevel != null ? batteryIcon(vitals.batteryLevel, vitals.charging) : null;

  return (
    <div
      className={`vitals${stale ? ' is-stale' : ''}`}
      aria-label={
        stale && age
          ? `Last reading from Dame's phone, ${age}`
          : "Current state from Dame's phone"
      }
    >
      {vitals.heartRate != null && (
        <span className="vital vital-heart" aria-label={`Heart rate ${vitals.heartRate} beats per minute`}>
          <Heartbeat bpm={vitals.heartRate} animate={!reduce && !stale} />
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
        <span
          className="vital vital-activity"
          aria-label={`${stale ? 'Was' : 'Currently'} ${activityLabel(vitals.activity)}`}
        >
          <ActivityIcon className="vital-glyph" size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="vital-word">{activityLabel(vitals.activity)}</span>
        </span>
      )}

      {/* When the phone said all this — the same quiet age the status line
          wears. */}
      {age && <span className="vitals-age">{age}</span>}

      {/* Right edge: day of life, in the same small-caps label voice as
          LISTENING TO / FOLLOWED BY one bar up. */}
      <DayOfLifeTicker />
    </div>
  );
});

/** A heart with a gentle beat at the actual BPM — a subtle pulse, not a throb.
 *  Falls back to a still glyph under reduced-motion. */
function Heartbeat({ bpm, animate }) {
  const beat = bpm > 20 && bpm < 260 ? 60 / bpm : null;
  if (!animate || !beat) {
    return <Heart className="vital-glyph vital-glyph-heart" size={14} strokeWidth={1.75} aria-hidden="true" />;
  }
  // A CSS animation rather than a Motion one: Motion drives `scale` from
  // JavaScript every frame, forever, while this is on screen. The browser runs
  // this on its compositor instead.
  return (
    <span className="vital-heartbeat is-beating" aria-hidden="true" style={{ '--beat': `${beat}s` }}>
      <Heart className="vital-glyph vital-glyph-heart" size={14} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}
