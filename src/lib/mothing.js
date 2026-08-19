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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format a plain 'YYYY-MM-DD' date without touching Date() (no timezone math,
 * so a date can never shift across a day boundary — and never implies where).
 */
export function formatNightDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  if (!m) return '';
  const [, y, mo, day] = m;
  return `${MONTHS[Number(mo) - 1]} ${Number(day)}, ${y}`;
}

/** Local 'HH:MM' → '8:47pm'. Wall-clock only; carries no location. */
export function formatObservedTime(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '';
  let h = Number(m[1]);
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m[2]}${ampm}`;
}

/** The name a moth is shown under — its common name, else the binomial. */
export const mothName = (obs) => obs?.taxon?.commonName || obs?.taxon?.name || 'Unidentified moth';

/** Google Lens reverse-image search for a photo — handy for pinning an ID. */
export function reverseSearchUrl(imageUrl) {
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
}

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
  return { session: sessions[i], newer: sessions[i - 1] || null, older: sessions[i + 1] || null };
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

/** '11:43pm–1:47am', or a single time when a night holds only one, or ''. */
export function nightSpan(session) {
  const first = formatObservedTime(session?.firstTime);
  if (!first) return '';
  const last = formatObservedTime(session?.lastTime);
  return last && last !== first ? `${first}–${last}` : first;
}

/**
 * ['35 moths', '31 species', '11:43pm–1:47am'] — the night in three parts.
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
 * same captions and the same "source" controls.
 */
export function mothLightboxImages(observations) {
  return (observations || [])
    .filter((o) => o.photos?.[0])
    .map((o) => {
      const photo = o.photos[0];
      const large = photoUrl(photo, 'large');
      const name = mothName(o);
      const sci = o.taxon?.name;
      return {
        src: large,
        thumb: photoUrl(photo, 'medium'),
        alt: sci && sci !== name ? `${name} — ${sci}` : name,
        sourceUrl: o.url,
        searchUrl: large ? reverseSearchUrl(large) : undefined,
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
