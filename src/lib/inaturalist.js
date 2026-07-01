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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`iNaturalist HTTP ${res.status} for ${url} :: ${text.slice(0, 160)}`);
  }
  return res.json();
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
  return {
    id: o.id,
    uuid: o.uuid || null,
    url: o.uri || (o.id ? `https://www.inaturalist.org/observations/${o.id}` : null),
    // Date only — never the tz-bearing `time_observed_at` / `created_at`.
    observedDate: o.observed_on_details?.date || o.observed_on || null,
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

/**
 * Fetch every moth observation for a user, newest first, and normalize it.
 * Auto-paginates up to `max`. Location is stripped by `normalizeObservation`.
 */
export async function fetchMothObservations({ user = INATURALIST_USER, max = 1000 } = {}) {
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

  return {
    user,
    observationCount: obs.length,
    speciesCount: speciesIds.size,
    distinctTaxaCount: distinctTaxa.size,
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
  const observations = await fetchMothObservations({ user, max });
  const stats = computeStats(observations, { user });
  return { user, stats, observations };
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
    qualityGrades: stats?.qualityGrades || undefined,
    earliestDate: stats?.earliestDate || undefined,
    latestDate: stats?.latestDate || undefined,
    topSpecies: stats?.topSpecies?.length ? stats.topSpecies : undefined,
    createdAt: ts,
    updatedAt: ts,
  });
}

/** One `is.dame.mothing.observation/<inatId>` record value. */
export function mothingObservationValue(obs, { now } = {}) {
  const ts = now || new Date().toISOString();
  const taxon = obs.taxon || {};
  return stripUndefined({
    $type: MOTHING_OBSERVATION_NSID,
    inatId: obs.id,
    uuid: obs.uuid || undefined,
    url: obs.url || undefined,
    observedDate: obs.observedDate || undefined,
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
