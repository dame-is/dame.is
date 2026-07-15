import { useEffect, useState } from 'react';
import { Heart, Flame, Footprints, Bike, Car, Armchair, Activity } from 'lucide-react';
import { resolveVitalsFromRef } from '../lib/vitals.js';
import './VitalsChip.css';

// A compact readout for the body-state a status carried — the "effort" signals
// (heart rate, activity, calories) that meaningfully pair with a written note.
// Battery / ambient sound are ambient telemetry and stay in the atmosphere-bar
// panel rather than cluttering a status line.
const ACTIVITY_ICON = {
  stationary: Armchair,
  walking: Footprints,
  running: Footprints,
  cycling: Bike,
  automotive: Car,
};

/**
 * The vitals behind an is.dame.now.stateRef, rendered as a quiet line beneath
 * the status. Pass a pre-hydrated `vitals` object, or a `stateRef` to hydrate
 * lazily (snapshot-first, live fallback). Renders nothing until it resolves, so
 * a status with no ref — or an unresolvable one — shows exactly as before.
 */
export default function VitalsChip({ stateRef, vitals: provided }) {
  const [vitals, setVitals] = useState(provided || null);

  useEffect(() => {
    if (provided) {
      setVitals(provided);
      return undefined;
    }
    if (!stateRef?.uri) {
      setVitals(null);
      return undefined;
    }
    let cancelled = false;
    resolveVitalsFromRef(stateRef).then((v) => {
      if (!cancelled) setVitals(v);
    });
    return () => {
      cancelled = true;
    };
  }, [stateRef?.uri, provided]);

  if (!vitals) return null;
  const hasBody =
    vitals.heartRate != null || vitals.activity || vitals.caloriesBurned != null;
  if (!hasBody) return null;

  const ActivityIcon = (vitals.activity && ACTIVITY_ICON[vitals.activity]) || Activity;

  return (
    <p className="vitals-chip" aria-label="Body-state captured with this status">
      {vitals.heartRate != null && (
        <span className="vitals-chip-item">
          <Heart className="vitals-chip-glyph vitals-chip-heart" size={12} strokeWidth={1.75} aria-hidden="true" />
          <span className="vitals-chip-value">{vitals.heartRate}</span>
          <span className="vitals-chip-unit">bpm</span>
        </span>
      )}
      {vitals.activity && (
        <span className="vitals-chip-item">
          <ActivityIcon className="vitals-chip-glyph" size={12} strokeWidth={1.75} aria-hidden="true" />
          <span className="vitals-chip-word">{vitals.activity}</span>
        </span>
      )}
      {vitals.caloriesBurned != null && (
        <span className="vitals-chip-item">
          <Flame className="vitals-chip-glyph" size={12} strokeWidth={1.75} aria-hidden="true" />
          <span className="vitals-chip-value">{vitals.caloriesBurned}</span>
          <span className="vitals-chip-unit">cal</span>
        </span>
      )}
    </p>
  );
}
