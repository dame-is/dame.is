// Numbers, dates and names as the panel writes them. Pure, so the tests can
// run them without a browser.

import { BANDS } from './bands.js';

export { BANDS };

/** A band as a word: "Connected". The store's capitals are its own. */
export const bandName = (band) =>
  band && band !== 'UNSCORED'
    ? `${band[0]}${band.slice(1).toLowerCase()}`
    : 'Not scored';

/** What a band means, in a line. */
export const BAND_RULE = {
  PROTECTED: 'You follow them, or they are on a list you made. Never added.',
  CONNECTED: 'Several of the people you follow follow them.',
  PERIPHERAL: 'One or two of the people you follow follow them.',
  NOTABLE: 'No connection to you, but a large audience.',
  UNKNOWN: 'No connection to you.',
};

export const nf = (n) => Number(n || 0).toLocaleString('en-US');

/** 12,400 as "12.4K", for a column that has no room. */
export function compact(n) {
  if (n == null) return '';
  const v = Number(n);
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export const plural = (n, one, many = `${one}s`) => `${nf(n)} ${Number(n) === 1 ? one : many}`;

/** "under a minute", "about 40 minutes", "about 2.4 hours". */
export function duration(minutes) {
  if (minutes < 2) return 'under a minute';
  if (minutes < 90) return `about ${Math.round(minutes)} minutes`;
  return `about ${(minutes / 60).toFixed(1)} hours`;
}

/**
 * What a set of writes costs against Bluesky's limits, the way the bot
 * quotes it (estimateWrites in src/bot/bulkPlan.js): a create is 3 points of
 * 5,000 an hour and one of the relay's 2,600 events an hour; a delete is 1.
 */
export function writeCost(n, { kind = 'create' } = {}) {
  const count = Number(n) || 0;
  const points = count * (kind === 'create' ? 3 : 1);
  const hours = Math.max(points / 5000, count / 2600);
  return { writes: count, points, minutes: hours * 60, time: duration(hours * 60) };
}

/** "3 hours ago", "yesterday", "12 Nov". */
export function ago(isoTime, now = Date.now()) {
  const t = Date.parse(isoTime);
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 0) return until(isoTime, now);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return hr === 1 ? 'an hour ago' : `${hr} hours ago`;
  const d = Math.round(hr / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return dayMonth(isoTime, now);
}

/** "in 12 minutes", "in 3 hours". */
export function until(isoTime, now = Date.now()) {
  const s = Math.round((Date.parse(isoTime) - now) / 1000);
  if (!Number.isFinite(s) || s <= 0) return 'now';
  const m = Math.round(s / 60);
  if (m < 1) return 'in under a minute';
  if (m < 60) return `in ${m} ${m === 1 ? 'minute' : 'minutes'}`;
  const hr = Math.round(m / 60);
  if (hr < 48) return `in ${hr} ${hr === 1 ? 'hour' : 'hours'}`;
  return `in ${Math.round(hr / 24)} days`;
}

/** "12 Nov", with the year when it is not this one. */
export function dayMonth(isoTime, now = Date.now()) {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    // A bare day ("2026-11-17") is one of the log's UTC days, and is named
    // as that day wherever the reader is.
    ...(/^\d{4}-\d{2}-\d{2}$/.test(String(isoTime)) ? { timeZone: 'UTC' } : {}),
  });
}

/** "2:36 pm" today, "Mon 2:36 pm" this week, "12 Nov, 2:36 pm" before that. */
export function clock(isoTime, now = Date.now()) {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return '';
  const time = d
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase();
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return time;
  if (now - d.getTime() < 6 * 86_400_000) {
    return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
  }
  return `${dayMonth(isoTime, now)}, ${time}`;
}

/** Megabytes and gigabytes: "288 MB", "1.2 GB". */
export function bytes(n) {
  if (n == null) return '';
  const mb = n / 1048576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1).replace(/\.0$/, '')} GB` : `${Math.round(mb)} MB`;
}

/** A DID cut to fit a cell: "did:plc:abcd…wxyz". */
export function shortDid(did) {
  const s = String(did || '');
  return s.length > 24 ? `${s.slice(0, 14)}…${s.slice(-4)}` : s;
}

/** The post a scan or watch is about, as a link a person can open. */
export function postLink(uri, handle = null) {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/.exec(String(uri || ''));
  return m ? `https://bsky.app/profile/${handle || m[1]}/post/${m[2]}` : null;
}

/** The author of a post, from its URI. */
export const postAuthor = (uri) =>
  /^at:\/\/([^/]+)\//.exec(String(uri || ''))?.[1] || null;

/** What a scan collected, in words. */
export const KIND_WORDS = {
  everyone: 'Everyone who engaged',
  likers: 'Likers',
  reposters: 'Reposters',
  repliers: 'Repliers',
  quoters: 'Quoters',
  // A watch keeps whoever arrives after it starts in a plan of its own.
  watch: 'Newcomers since a watch began',
};

/** How someone came to be on the list, in words (viaFamily in bands.js). */
export const FAMILY_WORDS = {
  name: 'By name',
  band: 'By band',
  label: 'By tone label',
  agent: 'By the agent or a watch',
  none: 'No record',
};

/** One `approved_via`, in words. */
export function viaWords(via) {
  const v = String(via || '');
  if (!v) return 'No record';
  const by = v.startsWith('agent:') ? 'the agent, ' : v.startsWith('watch:') ? 'a watch, ' : '';
  const basis = v.replace(/^(agent|watch):/, '');
  const what =
    basis === 'command'
      ? 'typed by name'
      : basis === 'individual'
        ? 'approved by name'
        : basis === 'band'
          ? 'approved by band'
          : basis.startsWith('triage:')
            ? `approved as ${basis.slice(7)}`
            : basis;
  return `${by}${what}`.replace(/^./, (c) => c.toUpperCase());
}
