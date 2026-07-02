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
} from '../config.js';

const PER_PAGE = 200; // iNaturalist's max page size.

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
 * The base query params that define "my moths": one user, Lepidoptera,
 * butterflies excluded. Shared by every endpoint so the scope never drifts.
 */
function baseParams(user = INATURALIST_USER) {
  return {
    user_login: user,
    taxon_id: String(LEPIDOPTERA_TAXON_ID),
    without_taxon_id: String(BUTTERFLY_TAXON_ID),
  };
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
 * Fetch moth observations for a user, newest first, and normalize them.
 * Auto-paginates up to `max`. Pass `since` (an ISO instant) to fetch only
 * observations changed since then via iNaturalist's `updated_since` — the
 * incremental path the mirror uses so it re-pulls only what actually moved.
 * Location is stripped by `normalizeObservation`.
 */
export async function fetchMothObservations({ user = INATURALIST_USER, max = 1000, since = null } = {}) {
  const out = [];
  let page = 1;
  while (out.length < max) {
    const params = new URLSearchParams({
      ...baseParams(user),
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
 * A cheap freshness signature for the moth set: one tiny request that returns
 * the total count plus the most-recent edit instant (in UTC). Comparing this
 * against a stored signature tells us whether a full pull is even needed —
 * without downloading every observation.
 */
export async function fetchMothSignature({ user = INATURALIST_USER } = {}) {
  const params = new URLSearchParams({
    ...baseParams(user),
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
 * Fetch just the current observation ids (authoritative set). Used by the
 * mirror to reconcile deletions — iNaturalist's `updated_since` never reports
 * removals, so when counts disagree we diff against the live id list.
 */
export async function fetchMothIds({ user = INATURALIST_USER, max = 10000 } = {}) {
  const ids = [];
  let page = 1;
  while (ids.length < max) {
    const params = new URLSearchParams({
      ...baseParams(user),
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

/** One `is.dame.mothing.observation/<inatId>` record value. */
export function mothingObservationValue(obs, { now } = {}) {
  // Stable timestamp from the observation date + local time; fall back to the
  // run time only for the rare observation with no date at all.
  const ts = observedTimestamp(obs.observedDate, obs.observedTime) || now || new Date().toISOString();
  const taxon = obs.taxon || {};
  return stripUndefined({
    $type: MOTHING_OBSERVATION_NSID,
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

/**
 * Build the full set of writes for a mirror run: the summary singleton plus
 * one record per observation, keyed by iNaturalist id for idempotency.
 * Returns `{ summary: {collection, rkey, value}, records: [...] }`.
 */
export function buildMirrorWrites({ observations, stats, now } = {}) {
  const ts = now || new Date().toISOString();
  return {
    summary: {
      collection: MOTHING_NSID,
      rkey: 'self',
      value: mothingSummaryValue(stats, { now: ts }),
    },
    records: (observations || [])
      .filter((o) => o && o.id != null)
      .map((o) => ({
        collection: MOTHING_OBSERVATION_NSID,
        rkey: String(o.id),
        value: mothingObservationValue(o, { now: ts }),
      })),
  };
}
