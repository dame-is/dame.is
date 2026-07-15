// Shared vitals helpers for is.dame.state records — the coercion + normalize
// used by the atmosphere-bar panel (latest record) and the status chip (a
// record referenced by is.dame.now.stateRef). Records are written from an
// iPhone Shortcut where a field may arrive as a string, so coerce hard.

import { fetchSnapshot } from './snapshot.js';
import { resolvePds, getRecord } from './atproto.js';

export function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (['yes', 'true', '1', 'on', 'charging'].includes(s)) return true;
  if (['no', 'false', '0', 'off'].includes(s)) return false;
  return null;
}

export function clampPct(n) {
  if (n === null) return null;
  return Math.max(0, Math.min(100, n));
}

/**
 * Normalize a raw is.dame.state record `value` into typed vitals (or null).
 * A field with no reading — missing, or a placeholder `0` — comes back null so
 * the panel / chip omit it entirely rather than rendering "0 bpm" / "0 cal".
 * (A phone that's genuinely posting never reports 0 heart rate, 0 dB, or 0%.)
 */
export function normalizeVitals(value) {
  if (!value) return null;
  const activity = value.activity ? String(value.activity).trim().toLowerCase() : null;
  return {
    heartRate: nonZero(toInt(value.heartRate)),
    // `unknown` is the lexicon's "no reading" sentinel — treat it as absent too.
    activity: activity && activity !== 'unknown' ? activity : null,
    batteryLevel: nonZero(clampPct(toInt(value.batteryLevel))),
    charging: toBool(value.charging ?? value.isCharging),
    soundLevel: nonZero(toInt(value.soundLevel ?? value.environmentSound)),
    caloriesBurned: nonZero(toInt(value.caloriesBurned)),
    sampledAt: value.capturedAt || value.createdAt || null,
  };
}

/** Treat 0 as "no reading" for display; null stays null. */
function nonZero(n) {
  return n === 0 ? null : n;
}

// The state snapshot is fetched once per session and shared: a feed can hold
// several stateRef statuses, and they (plus the vitals panel) all resolve
// against the same newest-N window instead of refetching it each time.
let stateSnapshotPromise = null;
export function loadStateSnapshot() {
  if (!stateSnapshotPromise) {
    stateSnapshotPromise = fetchSnapshot('state').then(
      (arr) => (Array.isArray(arr) ? arr : []),
      () => [],
    );
  }
  return stateSnapshotPromise;
}

function parseAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  return m ? { repo: m[1], collection: m[2], rkey: m[3] } : null;
}

/**
 * Resolve the vitals behind an is.dame.now.stateRef. A manual status refs a
 * state record created seconds earlier, so it's almost always in the snapshot's
 * newest-N window (same-origin, no network); only an older ref falls through to
 * a live getRecord off the PDS. Returns normalized vitals or null.
 */
export async function resolveVitalsFromRef(stateRef) {
  const uri = stateRef?.uri;
  if (!uri) return null;
  try {
    const log = await loadStateSnapshot();
    const hit = log.find((r) => r?.uri === uri);
    if (hit?.value) return normalizeVitals(hit.value);
  } catch {
    // fall through to the live lookup
  }
  const parts = parseAtUri(uri);
  if (!parts) return null;
  try {
    const pds = await resolvePds(parts.repo);
    const rec = await getRecord(pds, parts);
    return rec?.value ? normalizeVitals(rec.value) : null;
  } catch {
    return null;
  }
}
