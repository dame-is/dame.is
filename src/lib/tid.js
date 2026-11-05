// The time as an atproto TID, for the overlays' TID clock: the record key a
// record made right now would get. Ported from atpota.to's overlay
// (website/src/overlay/tid.ts), which drew Anisota's clock in atpotato's mono;
// this one is set in dame.is's.
//
// A TID is 13 characters of base32-sortable: 11 for the microseconds since
// 1970 and 2 for a clock id (0–1023) that tells two clocks apart. A repo's
// revision is one too, so the same reading tells when dame's repo last moved
// (atproto.js getRepoRev, tidToTimestamp).

export const S32 = '234567abcdefghijklmnopqrstuvwxyz';
export const TICK_MS = 50;

/** `n` in base32-sortable, at least `len` characters. */
export function s32(n, len) {
  let out = '';
  let v = Math.max(0, Math.floor(n));
  while (v > 0) {
    out = S32[v % 32] + out;
    v = Math.floor(v / 32);
  }
  return out.padStart(len, '2');
}

/** The TID for `us` microseconds since 1970 on clock `clock`. */
export function tidAt(us, clock) {
  return s32(us, 11) + s32(clock & 1023, 2);
}

/** A TID's microseconds and clock id, or null when it isn't one. */
export function readTid(tid) {
  if (typeof tid !== 'string' || !/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(tid)) return null;
  let us = 0;
  for (const c of tid.slice(0, 11)) us = us * 32 + S32.indexOf(c);
  return { us, clock: S32.indexOf(tid[11]) * 32 + S32.indexOf(tid[12]) };
}

/**
 * A clock that never says the same TID twice (as @atproto/common-web's
 * TID.nextStr): a reading in the same microsecond as the last is moved on one.
 */
export function createTidClock(nowUs = () => Math.floor((performance.timeOrigin + performance.now()) * 1000), clock = Math.floor(Math.random() * 1024)) {
  let last = 0;
  return () => {
    let us = nowUs();
    if (us <= last) us = last + 1;
    last = us;
    return { tid: tidAt(us, clock), us };
  };
}

const PARTS = new Map();
function partsFormat(zone) {
  if (!PARTS.has(zone)) {
    PARTS.set(
      zone,
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        ...(zone === 'eastern' ? { timeZone: 'America/New_York' } : {}),
      }),
    );
  }
  return PARTS.get(zone);
}

/** "14:03:12.345678", in New York or on this machine. */
export function tidTimeText(us, zone = 'eastern') {
  const hms = partsFormat(zone).format(new Date(Math.floor(us / 1000)));
  return `${hms}.${String(us % 1_000_000).padStart(6, '0')}`;
}

/** "thursday 5 november 2026", in New York or on this machine. */
export function tidDateText(us, zone = 'eastern') {
  return new Date(Math.floor(us / 1000))
    .toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...(zone === 'eastern' ? { timeZone: 'America/New_York' } : {}),
    })
    .toLowerCase()
    .replace(',', '');
}
