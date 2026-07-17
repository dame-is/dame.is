// Edge/Node-safe resolver for the sky-theme tuning override, sourced from the
// same is.dame.sky/self PDS record the SPA reads. Lets the dynamic OG card
// (api/og.js) derive its palette from the LIVE, admin-tuned sky theme instead
// of the built-in hourly derivation — so a card's background, borders, and
// accents match exactly what the site paints for that hour, including any
// tweaks saved from the "Sky theme studio".
//
// Without this, api/og.js calls paletteForHour(hour) with no tuning (the
// module-level activeTuning is only ever installed client-side, in
// useTheme.jsx), so cards always render the untuned palette — most visibly at
// the dawn/dusk shoulder hours, whose raw derivation is a muddy warm color
// that reads as an accent wash rather than the clean background the tuning
// pins.
//
// Resolution order mirrors og/pageContent.js + useTheme.jsx:
//   1. the build/deploy snapshot at /data/sky.json  (the "latest deployment")
//   2. a time-boxed live getRecord                  (records newer than the build)
//   3. null → caller falls back to the built-in hourly palette
//
// Everything is defensive: any miss/hiccup returns null so a slow or broken PDS
// never blocks the card. Plain fetch only, so it runs in either runtime.

import { ME_DID, COLLECTIONS } from '../src/config.js';
import { resolvePds, getRecord } from '../src/lib/atproto.js';
import { effectiveSkyTuning } from '../src/lib/skyTuning.js';

const SNAPSHOT_TIMEOUT_MS = 2000;
const PDS_TIMEOUT_MS = 2500;

/** Resolve after `ms`, whichever comes first, so a hung fetch never blocks. */
function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The build snapshot of is.dame.sky/self ({uri,cid,value}), or null. Prefetch
 *  writes `{}` when no record exists yet, which has no `.value` → treated as a
 *  miss so the live fallback still runs. */
async function snapshotRecord(origin) {
  if (!origin) return null;
  const rec = await fetchJson(`${origin}/data/sky.json`, SNAPSHOT_TIMEOUT_MS);
  return rec?.value ? rec : null;
}

async function liveRecord() {
  const pds = await resolvePds(ME_DID).catch(() => null);
  if (!pds) return null;
  return getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.sky, rkey: 'self' }).catch(() => null);
}

/** The is.dame.sky record: build snapshot first, then a live PDS fallback for a
 *  record authored/edited since the last build. */
async function resolveRecord(origin) {
  const snap = await snapshotRecord(origin);
  if (snap?.value) return snap;
  const live = await withTimeout(liveRecord(), PDS_TIMEOUT_MS);
  if (live?.value) return live;
  return null;
}

/**
 * The runtime sky-tuning map ({ enabled, hours: { <h>: cfg } }) for the OG
 * palette, or null when there's no enabled override (→ caller uses the
 * built-in hourly derivation). Pass the result straight to
 * paletteForHour(hour, tuning).
 */
export async function resolveSkyTuning(origin) {
  const record = await resolveRecord(origin);
  return effectiveSkyTuning(record);
}
