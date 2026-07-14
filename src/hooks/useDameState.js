import { useEffect, useRef, useState } from 'react';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { ME_DID, COLLECTIONS } from '../config.js';

/**
 * Latest is.dame.state record — Dame's current iPhone-sourced state (heart
 * rate, activity, battery, ambient sound, calories). is.dame.state is an
 * append-only log keyed by TID, so the newest record is "right now". Snapshot
 * first paint, then live via listRecords (newest first), kept current on the
 * shared 30s tick — same cadence and same one-record read as NowPlaying, so
 * every "live" surface updates together.
 *
 * Returns `{ vitals, status }`, where `vitals` is a normalized, type-coerced
 * shape (or null before anything loads). The record is written from an iPhone
 * Shortcut where a field may arrive as a string, so we coerce defensively here
 * rather than trusting the stored types.
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
        const recs = await listRecords(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.state,
          max: 1,
        });
        if (cancelledRef.current) return;
        if (recs?.[0]) {
          recordRef.current = recs[0];
          setRecord(recs[0]);
          setStatus('ready');
        }
      } catch {
        // listRecords is empty until the first push; keep whatever we had.
        if (!cancelledRef.current) {
          setStatus(recordRef.current ? 'stale' : 'error');
        }
      }
    }

    async function boot() {
      setStatus('loading');
      const seed = await fetchSnapshot('state');
      if (!cancelledRef.current && Array.isArray(seed) && seed[0]) {
        recordRef.current = seed[0];
        setRecord(seed[0]);
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
