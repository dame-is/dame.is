/**
 * Collapse consecutive iNaturalist observations into one feed row.
 *
 * The listening cousin of this file is `listenSessions.js`, and the problem is
 * the same: one night at the light logs thirty-five records, and thirty-five
 * rows is the whole feed. A batch stands in for the run and expands to show
 * every observation in it.
 *
 * What counts as one run differs by verb, because moths already have a unit:
 *
 *   • `mothing` batches by SESSION — the 8pm–3am night `buildSessions` keys
 *     on (see inaturalist.js). A night is one run however long the lulls
 *     between sightings are, and it has a page of its own to link to.
 *   • `observing` has no such unit, so it falls back to a gap window: two
 *     sightings within an hour of each other belong to the same outing.
 *
 * One batch stays open per verb, so a moth logged during a daytime walk joins
 * the mothing batch without fragmenting the observing one. Everything else in
 * the feed passes through untouched and — as with listens — does NOT close an
 * open batch: a post mid-session shouldn't split the session.
 *
 * A batch keeps the first-seen record's fields (in a newest-first feed that's
 * the most recent observation, so it sorts and dates like its newest member)
 * plus a `count`, the `observations` behind it, and `nightDate` when the run
 * is a mothing session.
 */

import { sessionDateFor } from './inaturalist.js';
import { nightPath } from './mothing.js';

export const OBSERVATION_BATCH_GAP_MS = 60 * 60 * 1000; // 1 hour

/** The two verbs iNaturalist feeds: moths, and everything else alive. */
const OBSERVATION_VERBS = new Set(['mothing', 'observing']);

/** How many species a collapsed row names before it says "+ N more". */
export const BATCH_NAME_MAX = 3;

/**
 * The observation's local hour. Mirrored records store only the wall-clock
 * `observedTime`; a live-fetched one carries `observedHour` outright.
 */
function observedHourOf(payload) {
  if (Number.isInteger(payload?.observedHour)) return payload.observedHour;
  const m = /^(\d{2}):\d{2}$/.exec(String(payload?.observedTime || ''));
  return m ? Number(m[1]) : null;
}

/**
 * The mothing session a feed item belongs to (`'2026-08-18'`), or null — for
 * an `observing` record, or a moth seen in daylight, which is no night at all.
 */
export function observationNightDate(item) {
  if (item?.verb !== 'mothing') return null;
  const payload = item.payload || {};
  return sessionDateFor(payload.observedDate, observedHourOf(payload));
}

/** Collapse runs of observations in a feed. Everything else passes through. */
export function collapseObservations(items) {
  const out = [];
  const open = new Map(); // verb -> { batch, night, at }
  for (const item of items || []) {
    if (!OBSERVATION_VERBS.has(item?.verb)) {
      out.push(item);
      continue;
    }
    const night = observationNightDate(item);
    const at = Date.parse(item.createdAt) || 0;
    const cur = open.get(item.verb);
    // A night joins its own night; anything unsessioned joins by proximity,
    // and never joins a night (two sightings an hour apart on either side of
    // 8pm are not the same run).
    const joins =
      cur &&
      (night
        ? cur.night === night
        : !cur.night && Math.abs(cur.at - at) <= OBSERVATION_BATCH_GAP_MS);
    if (joins) {
      cur.batch.count += 1;
      cur.batch.observations.push(item);
      cur.at = at;
      continue;
    }
    const batch = { ...item, count: 1, observations: [item], nightDate: night };
    open.set(item.verb, { batch, night, at });
    out.push(batch);
  }
  return out;
}

/** Is this row standing in for more than one observation? */
export function isObservationBatch(item) {
  return (
    OBSERVATION_VERBS.has(item?.verb) &&
    (item.count || 0) > 1 &&
    Array.isArray(item.observations) &&
    item.observations.length > 1
  );
}

/** What one observation is listed as. Unnamed ones return '' and are skipped. */
function observationName(item) {
  const taxon = item?.payload?.taxon || {};
  return taxon.commonName || taxon.name || '';
}

/** Every distinct species in a batch, in the order the rows are drawn. */
export function batchNames(batch) {
  const seen = new Set();
  const out = [];
  for (const item of batch?.observations || []) {
    const name = observationName(item);
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * The species line a collapsed row leads with — the same move the listening
 * batch makes with its artist pool. '' when nothing in the run was named.
 */
export function batchNameLine(batch, max = BATCH_NAME_MAX) {
  const names = batchNames(batch);
  if (!names.length) return '';
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} + ${names.length - max} more` : shown;
}

/** '35 moths' / '12 observations' — the count, in the verb's own noun. */
export function batchCountLabel(batch) {
  const n = batch?.count || 0;
  if (batch?.verb === 'mothing') return `${n} ${n === 1 ? 'moth' : 'moths'}`;
  return `${n} ${n === 1 ? 'observation' : 'observations'}`;
}

/**
 * Where a collapsed row points instead of at a single record: a mothing run
 * IS a night, and a night has a page of its own. Null for anything else, so
 * the caller falls back to the newest record in the run.
 */
export function batchHref(item) {
  return item?.nightDate ? nightPath(item.nightDate) : null;
}
