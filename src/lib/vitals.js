// Shared vitals helpers for is.dame.state records — the coercion + normalize
// used by the atmosphere-bar panel (latest record) and the status chip (a
// record referenced by is.dame.now.stateRef). Records are written from an
// iPhone Shortcut where a field may arrive as a string, so coerce hard.

import { fetchSnapshot } from './snapshot.js';
import { resolvePds, getRecord, isRecordNotFound } from './atproto.js';
import { normalizeActivity } from './activity.js';

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
  return {
    heartRate: nonZero(toInt(value.heartRate)),
    // The iOS activity string (raw `physicalActivity` or the normalized
    // `activity`) → a canonical key, so icons resolve and states group even
    // though the phone's wording varies. See lib/activity.js.
    activity: normalizeActivity(value.activity ?? value.physicalActivity),
    batteryLevel: nonZero(clampPct(toInt(value.batteryLevel))),
    charging: toBool(value.charging ?? value.isCharging),
    soundLevel: nonZero(toInt(value.soundLevel ?? value.environmentSound)),
    caloriesBurned: nonZero(toInt(value.caloriesBurned)),
    sampledAt: value.capturedAt || value.createdAt || null,
  };
}

// A reading this old is shown as a past reading, not as "right now": the
// heart stops beating at it and the row dims. The phone posts about hourly,
// so this is past one missed post.
export const VITALS_STALE_MS = 90 * 60 * 1000;
// Older than this and it's not shown at all. Overnight gaps run to sixteen
// hours; a day without a reading means the phone has stopped posting.
export const VITALS_EXPIRED_MS = 24 * 60 * 60 * 1000;

/**
 * How current a reading taken at `sampledAt` is: `{ ageMs, stale, expired }`.
 * A missing or unparseable timestamp counts as fresh, so a record without one
 * keeps showing rather than vanishing.
 */
export function vitalsFreshness(sampledAt, now = Date.now()) {
  const t = sampledAt ? Date.parse(sampledAt) : NaN;
  if (Number.isNaN(t)) return { ageMs: null, stale: false, expired: false };
  const ageMs = Math.max(0, now - t);
  return {
    ageMs,
    stale: ageMs >= VITALS_STALE_MS,
    expired: ageMs >= VITALS_EXPIRED_MS,
  };
}

/** Treat 0 as "no reading" for display; null stays null. */
function nonZero(n) {
  return n === 0 ? null : n;
}

// The state snapshot is fetched once per session and shared: a feed can hold
// several stateRef statuses, and they (plus the vitals panel) all resolve
// against the same newest-N window instead of refetching it each time. A miss
// isn't shared — fetchSnapshot answers a failed read with null rather than
// rejecting, and holding that would leave every chip without its snapshot
// until a reload — so the next caller asks again.
let stateSnapshotPromise = null;
export function loadStateSnapshot() {
  if (!stateSnapshotPromise) {
    const pending = fetchSnapshot('state').then(
      (arr) => {
        if (Array.isArray(arr)) return arr;
        if (stateSnapshotPromise === pending) stateSnapshotPromise = null;
        return [];
      },
      () => {
        if (stateSnapshotPromise === pending) stateSnapshotPromise = null;
        return [];
      },
    );
    stateSnapshotPromise = pending;
  }
  return stateSnapshotPromise;
}

function parseAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  return m ? { repo: m[1], collection: m[2], rkey: m[3] } : null;
}

// Live lookups run a few at a time. Most statuses that carry a stateRef point
// past the snapshot's window, so the cards layout on /logging used to open a
// getRecord per row all at once — over a hundred PDS requests in one burst.
// Queued, the rows on screen still resolve first (they mount first) and the
// PDS sees a steady trickle instead.
const LIVE_LOOKUP_LIMIT = 4;
let liveActive = 0;
const liveWaiting = [];

function withLiveSlot(run) {
  const start = () => run().finally(releaseLiveSlot);
  if (liveActive < LIVE_LOOKUP_LIMIT) {
    liveActive += 1;
    return start();
  }
  return new Promise((resolve) => liveWaiting.push(resolve)).then(start);
}

function releaseLiveSlot() {
  const next = liveWaiting.shift();
  // The slot passes straight to the next lookup in line, so a caller arriving
  // in between can't slip past the queue and push the count over the limit.
  if (next) next();
  else liveActive -= 1;
}

async function lookupVitals(uri) {
  const log = await loadStateSnapshot();
  const hit = log.find((r) => r?.uri === uri);
  if (hit?.value) return normalizeVitals(hit.value);
  const parts = parseAtUri(uri);
  if (!parts) return null;
  try {
    const rec = await withLiveSlot(async () => {
      const pds = await resolvePds(parts.repo);
      return getRecord(pds, parts);
    });
    return rec?.value ? normalizeVitals(rec.value) : null;
  } catch (err) {
    // A deleted state record is an answer; a timeout or a 5xx isn't one.
    if (isRecordNotFound(err)) return null;
    throw err;
  }
}

// Answers by state-record URI, held for the session. The phone writes a state
// record once and never edits it, so what a ref resolved to stays true; a chip
// that remounts (a layout switch, a revisit) reads it back instead of asking
// the PDS again, and two chips for one ref share a single lookup.
const vitalsByRef = new Map(); // uri -> Promise<vitals | null>

/**
 * Resolve the vitals behind an is.dame.now.stateRef. A manual status refs a
 * state record created seconds earlier, so it's almost always in the snapshot's
 * newest-N window (same-origin, no network); only an older ref falls through to
 * a live getRecord off the PDS. Returns normalized vitals or null, and never
 * rejects.
 */
export function resolveVitalsFromRef(stateRef) {
  const uri = stateRef?.uri;
  if (!uri) return Promise.resolve(null);
  const held = vitalsByRef.get(uri);
  if (held) return held;
  const pending = lookupVitals(uri).catch(() => {
    // The network failed, not the record: forget it so a later mount retries.
    if (vitalsByRef.get(uri) === pending) vitalsByRef.delete(uri);
    return null;
  });
  vitalsByRef.set(uri, pending);
  return pending;
}
