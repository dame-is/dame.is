import { useEffect, useRef, useState } from 'react';
import { resolvePds, getRecord } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { ME_DID, COLLECTIONS } from '../config.js';

/**
 * Latest is.dame.state/self singleton — Dame's current iPhone-sourced state
 * (heart rate, activity, battery, ambient sound, calories). Snapshot first
 * paint, then live via getRecord, kept current on the shared 30s tick — same
 * cadence as NowPlaying / NowStatus so every "live" surface updates together.
 *
 * Returns `{ vitals, status }`, where `vitals` is a normalized, type-coerced
 * shape (or null before anything loads). The record is written from an iPhone
 * Shortcut where every field arrives as a string, so we coerce defensively
 * here rather than trusting the stored types.
 */
export function useDameState() {
  const [record, setRecord] = useState(null);
  const [status, setStatus] = useState('idle');
  const cancelledRef = useRef(false);
  const recordRef = useRef(null);

  useEffect(() => {
    cancelledRef.current = false;

    async function refresh() {
      try {
        const pds = await resolvePds(ME_DID);
        const rec = await getRecord(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.state,
          rkey: 'self',
        });
        if (cancelledRef.current) return;
        if (rec?.value) {
          recordRef.current = rec;
          setRecord(rec);
          setStatus('ready');
        }
      } catch {
        // getRecord 404s until the first push exists; keep whatever we had.
        if (!cancelledRef.current) {
          setStatus(recordRef.current ? 'stale' : 'error');
        }
      }
    }

    async function boot() {
      setStatus('loading');
      const seed = await fetchSnapshot('state');
      if (!cancelledRef.current && seed?.value) {
        recordRef.current = seed;
        setRecord(seed);
      }
      refresh();
    }

    boot();
    const unsubscribe = subscribeRefreshTick(refresh);
    return () => {
      cancelledRef.current = true;
      unsubscribe();
    };
  }, []);

  return { vitals: normalize(record), status };
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (['yes', 'true', '1', 'on', 'charging'].includes(s)) return true;
  if (['no', 'false', '0', 'off'].includes(s)) return false;
  return null;
}

function normalize(record) {
  const v = record?.value;
  if (!v) return null;
  const sampledAt = v.capturedAt || v.createdAt || null;
  return {
    heartRate: toInt(v.heartRate),
    activity: v.activity ? String(v.activity).trim().toLowerCase() : null,
    batteryLevel: clampPct(toInt(v.batteryLevel)),
    charging: toBool(v.charging ?? v.isCharging),
    soundLevel: toInt(v.soundLevel ?? v.environmentSound),
    caloriesBurned: toInt(v.caloriesBurned),
    sampledAt,
    uri: record.uri || null,
  };
}

function clampPct(n) {
  if (n === null) return null;
  return Math.max(0, Math.min(100, n));
}
