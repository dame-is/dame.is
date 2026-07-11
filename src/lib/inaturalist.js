// Isomorphic iNaturalist client for the /mothing surface.
//
// Runs in the browser (live refresh on the page), in Node (the build-time
// prefetch snapshot), and inside the PDS mirror (CLI script + cron function).
// No SDK — just `fetch` + JSON, mirroring `src/lib/atproto.js`.
//
// PRIVACY: this module is the single choke point where raw iNaturalist
// observations are turned into the shape the rest of the site sees. It
// deliberately DROPS every location signal — coordinates (`geojson`,
// `location`), `place_guess`, `place_ids`, and the timezone-bearing
// timestamps (a tz offset is a coarse location hint). Only the plain
// observation *date* survives. Nothing downstream (snapshot, page, or PDS
// record) ever receives a location, so there is nothing to accidentally leak.

import {
  INATURALIST_API,
  INATURALIST_USER,
  LEPIDOPTERA_TAXON_ID,
  BUTTERFLY_TAXON_ID,
  MOTHING_NSID,
  MOTHING_OBSERVATION_NSID,
  OBSERVING_NSID,
  OBSERVING_OBSERVATION_NSID,
} from '../config.js';

const PER_PAGE = 200; // iNaturalist's max page size.

/**
 * A "scope" pins an iNaturalist query to a slice of the observations. Two
 * matter to the site:
 *   - MOTH_SCOPE: Lepidoptera minus butterflies — the /mothing surface.
 *   - ALL_SCOPE (null): every observation, of any taxon — what the PDS mirror
 *     pulls before splitting each one into the mothing / observing verbs.
 * A scope is `{ taxonId?, withoutTaxonId? }` (or null for "everything").
 */
export const MOTH_SCOPE = { taxonId: LEPIDOPTERA_TAXON_ID, withoutTaxonId: BUTTERFLY_TAXON_ID };
export const ALL_SCOPE = null;

/** Build the taxon-filter query params for a scope (empty for ALL_SCOPE). */
function scopeParams(user = INATURALIST_USER, scope = MOTH_SCOPE) {
  const p = { user_login: user };
  if (scope?.taxonId) p.taxon_id = String(scope.taxonId);
  if (scope?.withoutTaxonId) p.without_taxon_id = String(scope.withoutTaxonId);
  return p;
}

/**
 * Is this a moth? Moths are Lepidoptera (47157) minus butterflies
 * (Papilionoidea, 47224). Decided from the raw iNaturalist taxon's ancestry
 * (`ancestor_ids`, which includes the taxon's own id) so a single all-taxa
 * pull can be split into the mothing / observing verbs without a second
 * query. Butterflies, non-Lepidoptera, and untaxoned observations are not
 * moths — they ride the `observing` verb. Taxonomy is public, not location.
 */
export function isMothTaxon(taxon) {
  if (!taxon) return false;
  const ids = new Set(Array.isArray(taxon.ancestor_ids) ? taxon.ancestor_ids : []);
  if (taxon.id != null) ids.add(taxon.id);
  return ids.has(LEPIDOPTERA_TAXON_ID) && !ids.has(BUTTERFLY_TAXON_ID);
}

// iNaturalist asks API consumers to identify themselves. Sent from Node
// (prefetch / mirror / cron); browsers forbid setting User-Agent and silently
// drop it, which is fine — this is politeness for the server-side callers.
const USER_AGENT = 'dame.is-mothing/1.0 (+https://dame.is/mothing; iNaturalist mirror)';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`iNaturalist HTTP ${res.status} for ${url} :: ${text.slice(0, 160)}`);
  }
  return res.json();
}

/**
 * Normalize an iNaturalist `updated_at` (which carries a tz offset — a coarse
 * location hint) to a UTC instant string. Used only as an opaque freshness
 * signature; never persisted to a PDS record.
 */
export function toUtcInstant(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Swap an iNaturalist photo URL's size segment. iNat serves the same photo
 * at `.../photos/<id>/<size>.<ext>` where size ∈ square | small | medium |
 * large | original. The API hands back `square`; we derive the rest.
 */
export function photoUrl(photo, size = 'medium') {
  const url = photo?.url;
  if (!url) return null;
  return url.replace(/\/(square|small|medium|large|original)\.(jpe?g|png|gif|webp)/i, `/${size}.$2`);
}

/**
 * Reduce a raw iNaturalist observation to the compact, location-free shape
 * the site stores and renders. Returns `null` for observations with no
 * usable taxon so callers can filter them out.
 */
export function normalizeObservation(o) {
  if (!o) return null;
  const t = o.taxon || {};
  const photos = Array.isArray(o.photos)
    ? o.photos
        .filter((p) => p && p.url && !p.hidden)
        .map((p) => ({
          id: p.id,
          // Store the square URL only; sizes are derived via `photoUrl`.
          url: p.url,
          licenseCode: p.license_code || null,
          attribution: p.attribution || null,
        }))
    : [];
  // Local time-of-day only. iNaturalist's `time_observed_at` carries a tz
  // offset (a coarse location hint) — we keep just the wall-clock "HH:MM"
  // from it, which says *when* in the observer's day, never *where*.
  const details = o.observed_on_details || {};
  let observedHour = Number.isInteger(details.hour) ? details.hour : null;
  let observedTime = null;
  const wall = /T(\d{2}):(\d{2})/.exec(o.time_observed_at || '');
  if (wall) {
    observedTime = `${wall[1]}:${wall[2]}`;
    if (observedHour == null) observedHour = Number(wall[1]);
  }
  return {
    id: o.id,
    uuid: o.uuid || null,
    url: o.uri || (o.id ? `https://www.inaturalist.org/observations/${o.id}` : null),
    // Date only — never the tz-bearing `time_observed_at` / `created_at`.
    observedDate: o.observed_on_details?.date || o.observed_on || null,
    observedTime, // local "HH:MM", offset stripped (or null)
    observedHour, // local hour 0–23 (or null)
    qualityGrade: o.quality_grade || null,
    description: o.description || null,
    // Derived from the (now-discarded) taxon ancestry so the mirror can route
    // a single all-taxa pull to the mothing vs observing verb. Not persisted.
    isMoth: isMothTaxon(t),
    taxon: {
      id: t.id ?? null,
      name: t.name || o.species_guess || null,
      commonName: t.preferred_common_name || null,
      rank: t.rank || null,
      iconicTaxon: t.iconic_taxon_name || null,
    },
    photos,
  };
}

/* ------------------------------------------------------------------ */
/* Mothing sessions                                                   */
/*                                                                    */
/* A "mothing session" is one night at the light: observations whose  */
/* local time falls in the 8pm→3am window count as the same session,  */
/* keyed by the evening's date (an after-midnight obs belongs to the  */
/* night that began the previous evening). Uses local time-of-day     */
/* only, so it reveals nothing about location.                        */
/* ------------------------------------------------------------------ */

export const SESSION_START_HOUR = 20; // 8pm — a session opens
export const SESSION_END_HOUR = 3; // 3am — and closes

function previousDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The session date (the evening a night belongs to) for one observation, or
 * `null` when it falls outside the night window or has no known time.
 */
export function sessionDateFor(observedDate, observedHour) {
  if (!observedDate || observedHour == null) return null;
  if (observedHour >= SESSION_START_HOUR) return observedDate; // evening
  if (observedHour < SESSION_END_HOUR) return previousDay(observedDate); // after midnight
  return null; // daytime — not a mothing session
}

/**
 * Group observations into numbered mothing sessions (oldest night = #1).
 * Returns `{ sessions, sessionCount, orphans }` where `sessions` is sorted
 * newest-first for display and each carries its own little stat block.
 * `orphans` are daytime / untimed observations that aren't part of a night.
 */
export function buildSessions(observations) {
  const obs = Array.isArray(observations) ? observations : [];
  const byDate = new Map(); // sessionDate -> observations[]
  const orphans = [];
  for (const o of obs) {
    const key = sessionDateFor(o.observedDate, o.observedHour);
    if (!key) {
      orphans.push(o);
      continue;
    }
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(o);
  }

  // Number sessions chronologically (oldest = 1) for a stable ordinal.
  const ascendingDates = Array.from(byDate.keys()).sort();
  const numberByDate = new Map(ascendingDates.map((d, i) => [d, i + 1]));

  const sessions = ascendingDates
    .map((date) => summarizeSession(date, numberByDate.get(date), byDate.get(date)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first

  return { sessions, sessionCount: sessions.length, orphans };
}

function summarizeSession(date, number, observations) {
  const items = observations
    .slice()
    // Within a night, order by local time (evening → after-midnight).
    .sort((a, b) => nightMinutes(a) - nightMinutes(b));
  const species = new Set();
  let research = 0;
  const timed = items.filter((o) => o.observedTime);
  for (const o of items) {
    if (o.taxon?.id != null && (o.taxon.rank === 'species' || o.taxon.rank === 'subspecies')) {
      species.add(o.taxon.id);
    }
    if (o.qualityGrade === 'research') research += 1;
  }
  return {
    number,
    date, // the evening's date (YYYY-MM-DD)
    observations: items,
    observationCount: items.length,
    speciesCount: species.size,
    researchCount: research,
    firstTime: timed[0]?.observedTime || null,
    lastTime: timed[timed.length - 1]?.observedTime || null,
  };
}

// Minutes since the session opened at 8pm, from the observation's local
// time, so an evening time (20:00–23:59) sorts before an after-midnight one
// (00:00–02:59) and same-hour observations order by minute.
function nightMinutes(o) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(o?.observedTime || ''));
  const minutesOfDay =
    m != null
      ? Number(m[1]) * 60 + Number(m[2])
      : o?.observedHour != null
        ? o.observedHour * 60
        : null;
  if (minutesOfDay == null) return Number.MAX_SAFE_INTEGER;
  return (minutesOfDay - SESSION_START_HOUR * 60 + 1440) % 1440;
}

/**
 * Fetch observations for a user within `scope`, newest first, and normalize
 * them. Auto-paginates up to `max`. Pass `since` (an ISO instant) to fetch
 * only observations changed since then via iNaturalist's `updated_since` — the
 * incremental path the mirror uses so it re-pulls only what actually moved.
 * Location is stripped by `normalizeObservation`; each result carries an
 * `isMoth` flag derived from taxon ancestry.
 */
export async function fetchObservations({ user = INATURALIST_USER, max = 1000, since = null, scope = MOTH_SCOPE } = {}) {
  const out = [];
  let page = 1;
  while (out.length < max) {
    const params = new URLSearchParams({
      ...scopeParams(user, scope),
      per_page: String(Math.min(PER_PAGE, max - out.length)),
      page: String(page),
      order: 'desc',
      order_by: 'observed_on',
    });
    if (since) params.set('updated_since', since);
    const data = await fetchJson(`${INATURALIST_API}/observations?${params}`);
    const batch = Array.isArray(data?.results) ? data.results : [];
    for (const o of batch) {
      const n = normalizeObservation(o);
      if (n) out.push(n);
    }
    const total = data?.total_results ?? out.length;
    if (batch.length === 0 || out.length >= total) break;
    page += 1;
  }
  return out;
}

/**
 * Fetch observations with an iNaturalist id greater than `sinceId` — the ones
 * logged after the newest already mirrored to the PDS. Ordered by id ascending
 * and paginated via `id_above`; `scope` defaults to ALL (moths + everything
 * else) so the caller can split by each result's `isMoth` flag. Location is
 * stripped by `normalizeObservation`. Returns [] when `sinceId` is falsy.
 */
export async function fetchObservationsNewerThanId({
  user = INATURALIST_USER,
  sinceId,
  max = 200,
  scope = ALL_SCOPE,
} = {}) {
  if (!sinceId) return [];
  const out = [];
  let above = String(sinceId);
  while (out.length < max) {
    const params = new URLSearchParams({
      ...scopeParams(user, scope),
      per_page: String(Math.min(PER_PAGE, max - out.length)),
      order: 'asc',
      order_by: 'id',
      id_above: above,
    });
    const data = await fetchJson(`${INATURALIST_API}/observations?${params}`);
    const batch = Array.isArray(data?.results) ? data.results : [];
    if (batch.length === 0) break;
    for (const o of batch) {
      const n = normalizeObservation(o);
      if (n) out.push(n);
    }
    above = String(batch[batch.length - 1].id);
    if (batch.length < PER_PAGE) break;
  }
  return out;
}

/**
 * A cheap freshness signature for a scope: one tiny request that returns the
 * total count plus the most-recent edit instant (in UTC). Comparing this
 * against a stored signature tells us whether a full pull is even needed —
 * without downloading every observation.
 */
export async function fetchSignature({ user = INATURALIST_USER, scope = MOTH_SCOPE } = {}) {
  const params = new URLSearchParams({
    ...scopeParams(user, scope),
    per_page: '1',
    order: 'desc',
    order_by: 'updated_at',
  });
  const data = await fetchJson(`${INATURALIST_API}/observations?${params}`);
  return {
    count: data?.total_results ?? 0,
    latestUpdatedAt: toUtcInstant(data?.results?.[0]?.updated_at) || null,
  };
}

/**
 * Fetch just the current observation ids for a scope (authoritative set).
 * Used by the mirror to reconcile deletions — iNaturalist's `updated_since`
 * never reports removals, so when counts disagree we diff against the live
 * id list.
 */
export async function fetchObservationIds({ user = INATURALIST_USER, max = 10000, scope = MOTH_SCOPE } = {}) {
  const ids = [];
  let page = 1;
  while (ids.length < max) {
    const params = new URLSearchParams({
      ...scopeParams(user, scope),
      per_page: String(PER_PAGE),
      page: String(page),
      order: 'asc',
      order_by: 'id',
      only_id: 'true',
    });
    const data = await fetchJson(`${INATURALIST_API}/observations?${params}`);
    const batch = Array.isArray(data?.results) ? data.results : [];
    for (const o of batch) if (o?.id != null) ids.push(o.id);
    const total = data?.total_results ?? ids.length;
    if (batch.length === 0 || ids.length >= total) break;
    page += 1;
  }
  return ids;
}

/* Moth-scoped aliases: the /mothing surface (page + snapshot) pulls only the
 * Lepidoptera-minus-butterflies slice. The PDS mirror instead pulls ALL_SCOPE
 * and splits locally. */
export const fetchMothObservations = (opts = {}) => fetchObservations({ scope: MOTH_SCOPE, ...opts });
export const fetchMothSignature = (opts = {}) => fetchSignature({ scope: MOTH_SCOPE, ...opts });
export const fetchMothIds = (opts = {}) => fetchObservationIds({ scope: MOTH_SCOPE, ...opts });

/**
 * Reconstruct a normalized observation from a stored
 * `is.dame.mothing.observation` record value. Lets the mirror rebuild the
 * full set from the PDS copy and overlay only the changed observations,
 * instead of re-downloading everything from iNaturalist.
 */
export function observationFromRecord(v) {
  if (!v) return null;
  const observedTime = v.observedTime || null;
  const observedHour = observedTime
    ? Number(observedTime.slice(0, 2))
    : Number.isInteger(v.observedHour)
      ? v.observedHour
      : null;
  const t = v.taxon || {};
  return {
    id: v.inatId,
    uuid: v.uuid || null,
    url: v.url || null,
    observedDate: v.observedDate || null,
    observedTime,
    observedHour,
    qualityGrade: v.qualityGrade || null,
    description: v.description || null,
    taxon: {
      id: t.id ?? null,
      name: t.name || null,
      commonName: t.commonName || null,
      rank: t.rank || null,
      iconicTaxon: t.iconicTaxon || null,
    },
    photos: Array.isArray(v.photos)
      ? v.photos.map((p) => ({
          id: p.id,
          url: p.url,
          licenseCode: p.licenseCode || null,
          attribution: p.attribution || null,
        }))
      : [],
  };
}

/**
 * Derive display stats from a normalized observation array — no extra API
 * calls, no location. Species counts use species-rank taxa; distinct taxa
 * also counts genus/family-level IDs.
 */
export function computeStats(observations, { user = INATURALIST_USER } = {}) {
  const obs = Array.isArray(observations) ? observations : [];
  const grades = { research: 0, needsId: 0, casual: 0 };
  const speciesIds = new Set();
  const distinctTaxa = new Set();
  const speciesTally = new Map(); // taxonId -> { taxon, count }
  let withPhotos = 0;
  let earliest = null;
  let latest = null;

  for (const o of obs) {
    if (o.qualityGrade === 'research') grades.research += 1;
    else if (o.qualityGrade === 'needs_id') grades.needsId += 1;
    else if (o.qualityGrade === 'casual') grades.casual += 1;

    const t = o.taxon || {};
    if (t.id != null) {
      distinctTaxa.add(t.id);
      if (t.rank === 'species' || t.rank === 'subspecies') speciesIds.add(t.id);
      const prev = speciesTally.get(t.id);
      if (prev) prev.count += 1;
      else speciesTally.set(t.id, { taxon: t, count: 1 });
    }
    if (o.photos && o.photos.length) withPhotos += 1;
    if (o.observedDate) {
      if (!earliest || o.observedDate < earliest) earliest = o.observedDate;
      if (!latest || o.observedDate > latest) latest = o.observedDate;
    }
  }

  const topSpecies = Array.from(speciesTally.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((e) => ({
      taxonId: e.taxon.id,
      name: e.taxon.name || null,
      commonName: e.taxon.commonName || e.taxon.preferred_common_name || null,
      rank: e.taxon.rank || null,
      count: e.count,
    }));

  const { sessionCount } = buildSessions(obs);

  return {
    user,
    observationCount: obs.length,
    speciesCount: speciesIds.size,
    distinctTaxaCount: distinctTaxa.size,
    sessionCount,
    withPhotos,
    qualityGrades: grades,
    earliestDate: earliest,
    latestDate: latest,
    topSpecies,
    profileUrl: `https://www.inaturalist.org/people/${user}`,
    observationsUrl:
      `https://www.inaturalist.org/observations?user_login=${user}` +
      `&taxon_id=${LEPIDOPTERA_TAXON_ID}&without_taxon_id=${BUTTERFLY_TAXON_ID}`,
  };
}

/**
 * One-shot: fetch observations and derive stats together. Returns the exact
 * shape written to `public/data/mothing.json` (minus `builtAt`, which the
 * caller stamps).
 */
export async function fetchMothData({ user = INATURALIST_USER, max = 1000 } = {}) {
  // Signature first, so a change during pagination trips the next comparison
  // (self-healing) rather than being silently baked into a stale snapshot.
  const sync = await fetchMothSignature({ user }).catch(() => null);
  const observations = await fetchMothObservations({ user, max });
  const stats = computeStats(observations, { user });
  return { user, stats, observations, sync };
}

/* ------------------------------------------------------------------ */
/* PDS mirror record builders                                         */
/*                                                                    */
/* Pure shape helpers shared by the CLI mirror script and the cron    */
/* serverless function. Output is location-free by construction — it  */
/* only ever reads from already-normalized observations.              */
/* ------------------------------------------------------------------ */

const stripUndefined = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** The `is.dame.mothing/self` summary record value. */
export function mothingSummaryValue(stats, { now, user = INATURALIST_USER } = {}) {
  const ts = now || new Date().toISOString();
  return stripUndefined({
    $type: MOTHING_NSID,
    source: 'inaturalist',
    user,
    profileUrl: stats?.profileUrl || `https://www.inaturalist.org/people/${user}`,
    observationCount: stats?.observationCount ?? 0,
    speciesCount: stats?.speciesCount ?? 0,
    distinctTaxaCount: stats?.distinctTaxaCount ?? 0,
    sessionCount: stats?.sessionCount ?? undefined,
    qualityGrades: stats?.qualityGrades || undefined,
    earliestDate: stats?.earliestDate || undefined,
    latestDate: stats?.latestDate || undefined,
    topSpecies: stats?.topSpecies?.length ? stats.topSpecies : undefined,
    createdAt: ts,
    updatedAt: ts,
  });
}

/**
 * Turn a plain observation date + local time into a stable, location-free
 * timestamp for `createdAt`. The local wall-clock is labeled `Z` — it is not
 * a true UTC instant (that would need the tz offset we deliberately drop),
 * but it reveals nothing about where and gives the feed correct ordering,
 * including within a single night. Deriving from the observation (not the
 * mirror run) keeps the record idempotent across syncs.
 */
export function observedTimestamp(observedDate, observedTime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(observedDate || ''))) return null;
  const time = /^\d{2}:\d{2}$/.test(String(observedTime || '')) ? observedTime : '12:00';
  return `${observedDate}T${time}:00.000Z`;
}

/**
 * The instant to ORDER and DISPLAY an observation by in a feed, rebuilt from
 * its stored local wall-clock (`observedDate` + `observedTime`) interpreted in
 * the *runtime's* time zone.
 *
 * `observedTimestamp` pins the wall-clock to `Z` so no tz offset is ever stored
 * (a tz offset is a coarse location hint). But that fake-UTC value is not a real
 * instant: against genuinely-UTC records (Bluesky posts, statuses) it sorts
 * ~offset hours early, and localizing it for display double-shifts the clock
 * (a 2:59pm sighting reads 10:59am to an observer in UTC−4). Reconstructing it
 * as a local instant restores correct interleaving, correct local-day
 * bucketing, and — round-tripped back through `toLocaleTimeString` — the right
 * displayed time, for a viewer in the observer's own zone (the common case; the
 * offset is never persisted, so a far-away viewer still can't do better).
 *
 * In Node/UTC (the static prefetch) this returns the same instant as
 * `observedTimestamp`, so the snapshot is byte-identical; only the browser
 * rebuild, running in the viewer's zone, shifts it.
 */
export function observationFeedInstant(observedDate, observedTime) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(observedDate || ''));
  if (!dm) return null;
  const tm = /^(\d{2}):(\d{2})$/.exec(String(observedTime || ''));
  const hh = tm ? Number(tm[1]) : 12; // noon fallback for a timeless observation
  const mm = tm ? Number(tm[2]) : 0;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), hh, mm, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * One observation record value under `$type`, keyed downstream by the iNat
 * id. The mothing and observing observation lexicons share the exact same
 * shape — only the `$type` differs — so both go through here.
 */
function observationRecordValue($type, obs, { now } = {}) {
  // Stable timestamp from the observation date + local time; fall back to the
  // run time only for the rare observation with no date at all.
  const ts = observedTimestamp(obs.observedDate, obs.observedTime) || now || new Date().toISOString();
  const taxon = obs.taxon || {};
  return stripUndefined({
    $type,
    inatId: obs.id,
    uuid: obs.uuid || undefined,
    url: obs.url || undefined,
    observedDate: obs.observedDate || undefined,
    observedTime: obs.observedTime || undefined,
    qualityGrade: obs.qualityGrade || undefined,
    description: obs.description || undefined,
    taxon: stripUndefined({
      id: taxon.id ?? undefined,
      name: taxon.name || undefined,
      commonName: taxon.commonName || undefined,
      rank: taxon.rank || undefined,
      iconicTaxon: taxon.iconicTaxon || undefined,
    }),
    photos: (obs.photos || []).map((p) =>
      stripUndefined({
        id: p.id,
        url: p.url,
        licenseCode: p.licenseCode || undefined,
        attribution: p.attribution || undefined,
      }),
    ),
    createdAt: ts,
    updatedAt: ts,
  });
}

/** One `is.dame.mothing.observation/<inatId>` record value. */
export function mothingObservationValue(obs, opts = {}) {
  return observationRecordValue(MOTHING_OBSERVATION_NSID, obs, opts);
}

/** One `is.dame.observing.observation/<inatId>` record value. */
export function observingObservationValue(obs, opts = {}) {
  return observationRecordValue(OBSERVING_OBSERVATION_NSID, obs, opts);
}

/**
 * Lean stats for the observing (non-moth) slice — no mothing-session math.
 * `iconicTaxa` breaks the count down by iNaturalist iconic taxon so the
 * summary reads like "34 birds, 28 plants, 12 fungi…".
 */
export function computeObservingStats(observations, { user = INATURALIST_USER } = {}) {
  const obs = Array.isArray(observations) ? observations : [];
  const grades = { research: 0, needsId: 0, casual: 0 };
  const speciesIds = new Set();
  const distinctTaxa = new Set();
  const iconicTally = new Map();
  let earliest = null;
  let latest = null;

  for (const o of obs) {
    if (o.qualityGrade === 'research') grades.research += 1;
    else if (o.qualityGrade === 'needs_id') grades.needsId += 1;
    else if (o.qualityGrade === 'casual') grades.casual += 1;

    const t = o.taxon || {};
    if (t.id != null) {
      distinctTaxa.add(t.id);
      if (t.rank === 'species' || t.rank === 'subspecies') speciesIds.add(t.id);
    }
    if (t.iconicTaxon) iconicTally.set(t.iconicTaxon, (iconicTally.get(t.iconicTaxon) || 0) + 1);
    if (o.observedDate) {
      if (!earliest || o.observedDate < earliest) earliest = o.observedDate;
      if (!latest || o.observedDate > latest) latest = o.observedDate;
    }
  }

  const iconicTaxa = Array.from(iconicTally.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return {
    user,
    observationCount: obs.length,
    speciesCount: speciesIds.size,
    distinctTaxaCount: distinctTaxa.size,
    qualityGrades: grades,
    iconicTaxa,
    earliestDate: earliest,
    latestDate: latest,
    profileUrl: `https://www.inaturalist.org/people/${user}`,
  };
}

/** The `is.dame.observing/self` summary record value (non-moth slice). */
export function observingSummaryValue(stats, { now, user = INATURALIST_USER } = {}) {
  const ts = now || new Date().toISOString();
  return stripUndefined({
    $type: OBSERVING_NSID,
    source: 'inaturalist',
    user,
    profileUrl: stats?.profileUrl || `https://www.inaturalist.org/people/${user}`,
    observationCount: stats?.observationCount ?? 0,
    speciesCount: stats?.speciesCount ?? 0,
    distinctTaxaCount: stats?.distinctTaxaCount ?? 0,
    qualityGrades: stats?.qualityGrades || undefined,
    iconicTaxa: stats?.iconicTaxa?.length ? stats.iconicTaxa : undefined,
    earliestDate: stats?.earliestDate || undefined,
    latestDate: stats?.latestDate || undefined,
    createdAt: ts,
    updatedAt: ts,
  });
}
