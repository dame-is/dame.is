// Display + addressing helpers for the /mothing surface.
//
// `src/lib/inaturalist.js` is the DATA layer — fetching, normalizing, and the
// session math that decides which observations share a night. This module is
// everything that has to AGREE when the same night is drawn twice: how a date
// and a wall-clock read, what a moth is called, where a night lives, and what
// the OG card says about it.
//
// Pure functions only, no React and no Node APIs, so all four consumers can
// share them: the index page, the per-night page, the Edge middleware that
// gives crawlers a night's <head>, and the serverless card renderer.
//
// PRIVACY: everything here reads from already-normalized observations, which
// carry a date and a local wall-clock and nothing else. A time-of-day says
// *when* in the observer's day, never *where* — see inaturalist.js.

import { buildSessions, photoUrl } from './inaturalist.js';
import { formatWallClockTime } from './time.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Is this 'YYYY-MM-DD' a day the calendar actually has? Checked by table, not
 * Date(), for the same reason formatNightDate avoids it — and because Date()
 * rolls '2026-02-31' over into March rather than refusing it.
 */
export function isCalendarDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (mo < 1 || mo > 12 || day < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return day <= (mo === 2 && leap ? 29 : DAYS_IN_MONTH[mo - 1]);
}

/**
 * Format a plain 'YYYY-MM-DD' date without touching Date() (no timezone math,
 * so a date can never shift across a day boundary — and never implies where).
 * '' for anything that isn't a real date, so a hand-typed `/mothing/2026-13-45`
 * falls back to its slug instead of reading "undefined 45, 2026".
 */
export function formatNightDate(d) {
  if (!isCalendarDate(d)) return '';
  const [y, mo, day] = String(d).split('-');
  return `${MONTHS[Number(mo) - 1]} ${Number(day)}, ${y}`;
}

/**
 * Local 'HH:MM' → '8:47 pm'. Wall-clock only; carries no location. The feed's
 * own reading of an observation's time, so a night's hours on /mothing (and on
 * its card) match the times the same moths carry in the home feed.
 */
export function formatObservedTime(hhmm) {
  return formatWallClockTime(hhmm);
}

/** The name a moth is shown under — its common name, else the binomial. */
export const mothName = (obs) => obs?.taxon?.commonName || obs?.taxon?.name || 'Unidentified moth';

/** A night's own address. The session's date IS its slug. */
export const nightPath = (date) => `/mothing/${date}`;

/**
 * Does this `/mothing/:slug` segment name a NIGHT rather than a single
 * observation? A night is addressed by its date (`2026-08-18`); an
 * observation by its iNaturalist id (a bare integer), so the two forms can
 * never collide and one route can serve both.
 */
export function isNightSlug(slug) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(slug || ''));
}

/**
 * Locate one night among a set of observations, with the nights either side
 * of it for the page's prev/next links. Sessions come back newest-first, so
 * the entry BEFORE this one is the newer night.
 *
 *   { session, newer, older } — or null when no session fell on that date.
 */
export function findNight(observations, date) {
  if (!isNightSlug(date)) return null;
  const { sessions } = buildSessions(observations);
  const i = sessions.findIndex((s) => s.date === date);
  if (i < 0) return null;
  return {
    session: sessions[i],
    newer: sessions[i - 1] || null,
    older: sessions[i + 1] || null,
    total: sessions.length,
  };
}

/**
 * Is `date` past what this set of observations can answer for?
 *
 * A full pull covers every night that finished before its newest observation,
 * so a date older than that and absent from it simply had no session — a
 * definitive miss. From the newest observation's own date onward the set can
 * be short: it was collected during the day, and the night it is missing is
 * the one that opens at 8pm after it — which is the night anybody is most
 * likely to be looking for. Callers with a stale copy use this to tell "there
 * was no session" from "my copy may not have it yet".
 */
export function nightBeyondReach(observations, date) {
  let latest = '';
  for (const o of observations || []) {
    if (o?.observedDate && o.observedDate > latest) latest = o.observedDate;
  }
  return !latest || date >= latest;
}

/** '11:43 pm – 1:47 am', or a single time when a night holds only one, or ''. */
export function nightSpan(session) {
  const first = formatObservedTime(session?.firstTime);
  if (!first) return '';
  const last = formatObservedTime(session?.lastTime);
  return last && last !== first ? `${first} – ${last}` : first;
}

/**
 * ['35 moths', '31 species', '11:43 pm – 1:47 am'] — the night in three parts.
 * Pass `{ span: false }` where the line has to stay short: the ledger's day
 * header sets its summary on one line beside the date, and on a phone the
 * hours are what push it to two.
 */
export function nightSummaryParts(session, { span = true } = {}) {
  if (!session) return [];
  const parts = [`${session.observationCount} moth${session.observationCount === 1 ? '' : 's'}`];
  if (session.speciesCount) parts.push(`${session.speciesCount} species`);
  const hours = span ? nightSpan(session) : '';
  if (hours) parts.push(hours);
  return parts;
}

/** The night's photographed observations, newest-first (display order). */
export const photographed = (session) =>
  (session?.observations || []).filter((o) => o.photos?.[0]);

/**
 * Lightbox entries for a run of observations, in the order they're drawn.
 * Shared so the index page and a night page open the same viewer with the
 * same captions.
 *
 * No `sourceUrl` / `searchUrl`: the viewer's source and reverse-image-search
 * controls belong to the curated galleries, where a block's provenance is the
 * point. Here the moth is the point, and the photograph is already ours.
 */
export function mothLightboxImages(observations) {
  return (observations || [])
    .filter((o) => o.photos?.[0])
    .map((o) => {
      const photo = o.photos[0];
      const name = mothName(o);
      const sci = o.taxon?.name;
      return {
        src: photoUrl(photo, 'large'),
        thumb: photoUrl(photo, 'medium'),
        alt: sci && sci !== name ? `${name} — ${sci}` : name,
      };
    });
}

/**
 * The card / crawler copy for one night, derived from the session alone so
 * the OG image, the <title> and the meta description can never disagree.
 *
 *   { title, summary, description, names }
 */
export function nightCardCopy(session) {
  const title = `Night of ${formatNightDate(session?.date)}`;
  const summary = nightSummaryParts(session).join(', ');
  // The moths themselves, as far as a description can reasonably carry them —
  // a card that only counts them says nothing about what was actually at the
  // light. Deduped: a night often logs the same species more than once.
  const names = [];
  for (const o of photographed(session)) {
    const name = mothName(o);
    if (name && !names.includes(name)) names.push(name);
  }
  const listed = names.slice(0, 4).join(', ');
  const description = listed
    ? `${summary}. ${listed}${names.length > 4 ? '…' : '.'}`
    : `${summary}.`;
  return { title, summary, description, names };
}

/* ---------- the almanac (/mothing grouped by season) ---------- */

const MONTH_NAMES_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Oct 16" from 'YYYY-MM-DD', no year. */
export function formatNightDay(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : '';
}

/** The weekday of a 'YYYY-MM-DD' evening, by calendar arithmetic (no zone). */
export function weekdayOf(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  if (!m) return '';
  return WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
}

/**
 * The meteorological season an evening falls in, by string math like
 * formatNightDate: spring is March to May, summer June to August, autumn
 * September to November, winter December to February (named for both years,
 * "Winter 2025–26"). A Northern Hemisphere choice, which is where the light
 * is. `key` sorts newest-last as a string.
 */
export function seasonOf(d) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(d || ''));
  if (!m) return null;
  let year = Number(m[1]);
  const month = Number(m[2]);
  if (month === 12) year += 1; // December opens the next year's winter
  const [name, order] =
    month >= 3 && month <= 5
      ? ['Spring', 1]
      : month >= 6 && month <= 8
        ? ['Summer', 2]
        : month >= 9 && month <= 11
          ? ['Autumn', 3]
          : ['Winter', 0];
  const label = name === 'Winter' ? `Winter ${year - 1}–${String(year).slice(2)}` : `${name} ${year}`;
  return { key: `${year}-${order}`, label };
}

function toAmPm(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  const h = Number(m[1]);
  return { clock: `${h % 12 || 12}:${m[2]}`, meridiem: h >= 12 ? 'pm' : 'am', minutes: h * 60 + Number(m[2]) };
}

/**
 * A night's time at the light with the meridiem written once when both ends
 * share it: "8:34–10:39 pm", else "10:17 pm – 12:03 am".
 */
export function nightSpanCompact(session) {
  const a = toAmPm(session?.firstTime);
  if (!a) return '';
  const b = toAmPm(session?.lastTime);
  if (!b || (a.clock === b.clock && a.meridiem === b.meridiem)) return `${a.clock} ${a.meridiem}`;
  return a.meridiem === b.meridiem
    ? `${a.clock}–${b.clock} ${b.meridiem}`
    : `${a.clock} ${a.meridiem} – ${b.clock} ${b.meridiem}`;
}

/** How long the light was up: "2 h 5 min", across midnight too. */
export function nightLength(session) {
  const a = toAmPm(session?.firstTime);
  const b = toAmPm(session?.lastTime);
  if (!a || !b) return '';
  let mins = b.minutes - a.minutes;
  if (mins < 0) mins += 24 * 60;
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h} h` : null, m ? `${m} min` : null].filter(Boolean).join(' ');
}

/** "Sep 13 – Oct 16", or one day alone. */
export function dateRange(dates) {
  const sorted = (dates || []).filter(Boolean).slice().sort();
  if (!sorted.length) return '';
  const a = formatNightDay(sorted[0]);
  const b = formatNightDay(sorted[sorted.length - 1]);
  return a === b ? a : `${a} – ${b}`;
}

/**
 * Sessions (newest first, as buildSessions returns them) grouped into
 * seasons, newest season first, each with its tally:
 * `{ key, label, range, sessions, moths, species }`. Species counts distinct
 * species-rank taxa across the season's nights.
 */
export function seasonsOf(sessions) {
  const map = new Map();
  for (const s of sessions || []) {
    const season = seasonOf(s.date);
    if (!season) continue;
    if (!map.has(season.key)) map.set(season.key, { ...season, sessions: [] });
    map.get(season.key).sessions.push(s);
  }
  return Array.from(map.values())
    .sort((a, b) => (a.key < b.key ? 1 : -1))
    .map((g) => {
      const species = new Set();
      let moths = 0;
      for (const s of g.sessions) {
        moths += s.observationCount || 0;
        for (const o of s.observations || []) {
          const r = o.taxon?.rank;
          if (o.taxon?.id != null && (r === 'species' || r === 'subspecies')) species.add(o.taxon.id);
        }
      }
      return { ...g, range: dateRange(g.sessions.map((s) => s.date)), moths, species: species.size };
    });
}

/** Month names, for anyone setting a long date from these strings. */
export { MONTH_NAMES_LONG };
