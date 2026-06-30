// Site-wide constants. The verb/feed surface is configured in
// `src/lib/verbRegistry.js`; this file pins the few remaining identity
// values and re-exports the legacy `COLLECTIONS` / `VERBS` symbols that the
// rest of the codebase already imports.

import { VERBS as REGISTRY_VERBS, primaryNsid, NSIDS } from './lib/verbRegistry.js';

export const ME_DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
export const ME_HANDLE = 'dame.is';
export const BIRTHDATE = '1993-05-07T00:00:00Z';
export const GITHUB_REPO = 'dame-is/dame.is';
export const APPVIEW = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';

// Infrastructure-only collections (not surfaced as feed verbs).
const PAGE_NSID = 'is.dame.page';
const PROFILE_NSID = 'is.dame.profile';
const HERO_PHRASE_NSID = 'is.dame.hero.phrase';
const RESUME_NSID = 'is.dame.resume';
const RESUME_JOB_NSID = 'is.dame.resume.job';
const RESUME_EDUCATION_NSID = 'is.dame.resume.education';

/**
 * Legacy verb-or-shorthand → NSID lookup. Existing call sites
 * (`COLLECTIONS.now`, `COLLECTIONS.listen`, `COLLECTIONS.leaflet`, …) keep
 * working; new code should reach into `verbRegistry` directly instead.
 */
export const COLLECTIONS = {
  now: primaryNsid('logging'),
  blogging: primaryNsid('blogging'),
  // pub.leaflet.document is a separate source for the `blogging` verb; keep
  // a direct alias for the few call sites that still address it by hand.
  leaflet: 'pub.leaflet.document',
  creating: primaryNsid('creating'),
  listen: primaryNsid('listening'),
  page: PAGE_NSID,
  profile: PROFILE_NSID,
  heroPhrase: HERO_PHRASE_NSID,
  resume: RESUME_NSID,
  resumeJob: RESUME_JOB_NSID,
  resumeEducation: RESUME_EDUCATION_NSID,
};

/** Gerund verbs surfaced on the home feed. Sourced from the registry. */
export const VERBS = REGISTRY_VERBS;

/** Every NSID the site knows how to ingest. Useful for routing fall-through. */
export const KNOWN_NSIDS = NSIDS;
