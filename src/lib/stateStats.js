// The /logging state dashboard's arithmetic (components/StateStats.jsx), kept
// in plain JS so it can be tested in node.

/**
 * Headline numbers, the heart-rate series and the activity split for the
 * samples inside the last `hours` (samples are useStateHistory's: normalized
 * vitals plus `t`, the capture time in ms, oldest first).
 */
export function computeStats(samples, hours, now = Date.now()) {
  const t1 = now;
  const t0 = t1 - hours * 3600 * 1000;
  const win = (samples || []).filter((s) => s.t >= t0 && s.t <= t1);

  const hr = win.map((s) => s.heartRate).filter((n) => n != null);
  const db = win.map((s) => s.soundLevel).filter((n) => n != null);
  const avgHr = hr.length
    ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length)
    : null;
  const peakHr = hr.length ? Math.max(...hr) : null;
  const avgDb = db.length
    ? Math.round(db.reduce((a, b) => a + b, 0) / db.length)
    : null;

  const calLatest = caloriesToday(samples, now);

  // Activity distribution (share of samples in each state).
  const actMap = new Map();
  for (const s of win) {
    if (s.activity) actMap.set(s.activity, (actMap.get(s.activity) || 0) + 1);
  }
  const actTotal = Array.from(actMap.values()).reduce((a, b) => a + b, 0);
  const activity = Array.from(actMap.entries())
    .map(([activity, count]) => ({
      activity,
      count,
      pct: actTotal ? count / actTotal : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const hrSeries = win
    .filter((s) => s.heartRate != null)
    .map((s) => ({ t: s.t, v: s.heartRate }));

  return {
    count: win.length,
    avgHr,
    peakHr,
    avgDb,
    calLatest,
    activity,
    hrSeries,
    t0,
    t1,
  };
}

/**
 * Calories burned so far today, or null.
 *
 * The phone's count resets at midnight, and its first reading of the day
 * comes hours later (the midnight post is a 0, which normalizes to no reading
 * at all). Taking simply the newest reading therefore showed last night's
 * total as "today" until morning. So a reading only counts if it was taken
 * today — "today" on the phone's own calendar, read from the UTC offset its
 * newest sample was stamped with, so the day turns over where Dame is rather
 * than where the reader is.
 */
export function caloriesToday(samples, now = Date.now()) {
  const list = samples || [];
  if (!list.length) return null;
  const newest = list[list.length - 1];
  const here =
    offsetMinutes(newest?.sampledAt) ?? -new Date(now).getTimezoneOffset();
  const today = dayAt(now, here);
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (s.t > now) continue;
    if (dayAt(s.t, offsetMinutes(s.sampledAt) ?? here) !== today) return null;
    if (s.caloriesBurned != null) return s.caloriesBurned;
  }
  return null;
}

/** The UTC offset an ISO timestamp was written with, in minutes; null if none. */
function offsetMinutes(iso) {
  const m = /(?:([+-])(\d{2}):?(\d{2})|Z)$/i.exec(String(iso || '').trim());
  if (!m) return null;
  if (!m[1]) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -mins : mins;
}

/** `YYYY-MM-DD` of the instant `ms` on a clock `offset` minutes from UTC. */
function dayAt(ms, offset) {
  return new Date(ms + offset * 60 * 1000).toISOString().slice(0, 10);
}
