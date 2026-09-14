/**
 * Which sightings were the FIRST of their kind — a lifer.
 *
 * An observation earns the mark when no earlier observation in the record
 * carries the same taxon. That is the whole rule, and it lives here because
 * four surfaces have to agree on it: the home feed (both layouts), the
 * /mothing grid, a single night's page, and a record page. Each of those
 * holds a different slice of the same archive, so the rule is written to
 * take whatever shape the caller has — a normalized iNaturalist observation
 * (`{ id, taxon, observedDate }`), a mirrored record value (`{ inatId, … }`),
 * a feed item (`{ payload: … }`), or a raw PDS record (`{ value: … }`).
 *
 * Pure functions only, no React and no Node APIs: the prefetch build derives
 * the authoritative index with them, and the browser re-derives from them.
 *
 * TWO LIMITS worth naming, because both are visible in the output:
 *
 *   • Only ranks at species or below count. A sighting filed as `Noctuidae`
 *     or `Acronicta sp.` is a real sighting but not a claim about a species —
 *     it may well be one already on the list, just not pinned down — so it
 *     never takes the mark, and never spends a taxon's first.
 *   • Taxa are compared by iNaturalist taxon id and nothing else. The
 *     mirrored records drop taxon ancestry (it rides along with the location
 *     data we deliberately never store), so a subspecies cannot be folded
 *     into its parent species: seeing `Ursus americanus kermodei` and later
 *     `Ursus americanus` reads as two firsts. Rare, and the alternative is
 *     storing ancestry we don't want.
 *
 * A first can also MOVE: iNaturalist identifications are revised, and a
 * re-identified old sighting can take a species' first away from a newer
 * one. Nothing here is cached against that — the set is derived fresh from
 * whatever the caller currently holds, so it always agrees with the data on
 * screen rather than with a flag frozen at mirror time.
 */

import { OBSERVATION_VERBS } from './observationBatches.js';

/**
 * Ranks precise enough to be a species claim. iNaturalist files anything
 * finer than species as one of the infraspecific ranks below.
 */
export const FIRST_SIGHTING_RANKS = new Set(['species', 'subspecies', 'variety', 'form']);

/** Unwrap whichever envelope the caller's observation arrived in. */
function observationOf(x) {
  if (!x || typeof x !== 'object') return null;
  return x.payload || x.value || x;
}

/**
 * An observation's iNaturalist id — the one identifier every shape shares.
 * Normalized observations call it `id`, mirrored record values `inatId`.
 */
export function observationId(x) {
  const o = observationOf(x);
  const id = o?.id ?? o?.inatId ?? null;
  return id == null ? null : Number(id);
}

/** The taxon id an observation is filed under, or null. */
export function observationTaxonId(x) {
  const id = observationOf(x)?.taxon?.id;
  return id == null ? null : Number(id);
}

/**
 * Sortable key for "which of these came first". Date, then the local
 * wall-clock, then the iNaturalist id as a stable tiebreak (ids ascend with
 * the order things were logged). A timeless observation sorts after every
 * timed one on its own date — `~` is above the digits in ASCII — so a night
 * that knows its hours wins the first over a bare date.
 */
function observedKey(o) {
  const date = typeof o?.observedDate === 'string' ? o.observedDate : '~~~~~~~~~~';
  const time = /^\d{2}:\d{2}$/.test(String(o?.observedTime || '')) ? o.observedTime : '~~~~~';
  const id = String(observationId(o) ?? 0).padStart(12, '0');
  return `${date}|${time}|${id}`;
}

/**
 * Every taxon id present in a set of observations, whatever the rank. This is
 * the half of the index that lets a LATER slice answer "is this taxon new?"
 * without holding the archive: a taxon absent from here has never been seen.
 */
export function observedTaxonIds(observations) {
  const out = new Set();
  for (const x of observations || []) {
    const id = observationTaxonId(x);
    if (id != null) out.add(id);
  }
  return out;
}

/**
 * The ids of the observations that were a first sighting.
 *
 * `seenTaxa` seeds the pass with taxa already known from outside this set —
 * how a partial slice (the home feed's window) stays honest against the whole
 * archive. A taxon listed there can't produce a first here, so a truncated
 * window can only ever under-report, never invent one.
 */
export function firstSightingIds(observations, { seenTaxa = null } = {}) {
  const known = seenTaxa instanceof Set ? seenTaxa : new Set(seenTaxa || []);
  const earliest = new Map(); // taxonId -> { id, key }
  for (const x of observations || []) {
    const o = observationOf(x);
    if (!o) continue;
    const taxonId = observationTaxonId(o);
    if (taxonId == null || known.has(taxonId)) continue;
    if (!FIRST_SIGHTING_RANKS.has(o.taxon?.rank)) continue;
    const id = observationId(o);
    if (id == null) continue;
    const key = observedKey(o);
    const prev = earliest.get(taxonId);
    if (!prev || key < prev.key) earliest.set(taxonId, { id, key });
  }
  const out = new Set();
  for (const { id } of earliest.values()) out.add(id);
  return out;
}

const NOTHING = new Set();

const asSet = (v) => (v instanceof Set ? v : new Set(v || []));

/**
 * Fold a locally-derived pass into the prebuilt index — how a surface that
 * holds only a slice of the archive (the home feed, a record page) answers the
 * question at all.
 *
 * The index (`firstSightings.json`, written by the prefetch) is derived from
 * the complete archive, so it is authoritative for everything that existed at
 * build time. Anything logged SINCE is invisible to it, and that is exactly
 * when a lifer most wants saying — so the rule is re-run over whatever the
 * caller holds, seeded with the taxa the index already knows. A taxon missing
 * from that list has genuinely never been recorded, so the earliest sighting
 * of it here is a first however short the window is.
 *
 * With no usable index — it hasn't loaded yet, or the build couldn't vouch for
 * the archive — the answer is NOTHING, and deliberately not a guess. A window
 * cannot be re-derived from on its own: the first of a species is its OLDEST
 * sighting and a window holds the newest, so deriving from one doesn't
 * under-report, it hands the mark to the wrong moth. Callers holding the
 * complete archive (the /mothing pull) call `firstSightingIds` directly.
 */
export function mergeFirstSightings(index, observations) {
  const seenTaxa = asSet(index?.taxa);
  if (!seenTaxa.size) return NOTHING;
  const ids = new Set(asSet(index?.ids));
  for (const id of firstSightingIds(observations, { seenTaxa })) ids.add(id);
  return ids;
}

/** Is this one — item, record, or observation — a first sighting? */
export function isFirstSighting(x, ids) {
  if (!ids || !ids.size) return false;
  const id = observationId(x);
  return id != null && ids.has(id);
}

/**
 * Stamp `_firstSighting` onto the observations in a feed.
 *
 * The feed's rows are drawn by a dozen components that have no business
 * holding an id index, and by the time a row reaches one it may have been
 * collapsed into a run (see collapseObservations) — so the mark is settled
 * once, here, on the way in, and every row downstream just reads the flag.
 *
 * Only the two iNaturalist verbs are touched. Other payloads carry numeric
 * `id`s of their own (an are.na block, say) that have no business being
 * compared against iNaturalist observation ids.
 */
export function markFirstSightings(items, ids) {
  if (!ids?.size) return items || [];
  return (items || []).map((item) =>
    OBSERVATION_VERBS.has(item?.verb) && isFirstSighting(item, ids)
      ? { ...item, _firstSighting: true }
      : item,
  );
}

/**
 * How many firsts a row stands for — itself, or the run collapsed into it. A
 * night at the light arrives in the feed as a single row, so that row has to
 * speak for every sighting under it: three lifers in one night is the thing
 * worth saying, and a yes/no mark can't say it.
 */
export function firstSightingCount(row) {
  const list = row?.observations;
  if (!Array.isArray(list)) return row?._firstSighting ? 1 : 0;
  let n = 0;
  for (const o of list) if (o?._firstSighting) n += 1;
  return n;
}

/**
 * '3 first sightings' — the count in words, or '' for none. Singular drops
 * the number: one lifer is "first sighting", the same words the single-row
 * mark wears, so the two read as one label at two scales.
 */
export function firstSightingLabel(n) {
  if (!n) return '';
  return n === 1 ? 'First sighting' : `${n} first sightings`;
}
