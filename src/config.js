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

// --- iNaturalist / mothing -------------------------------------------------
// The /mothing page + PDS mirror pull moth observations from iNaturalist.
// "Moths" = Lepidoptera (47157) minus butterflies (Papilionoidea, 47224),
// since iNat has no single "moths" taxon. Location data is intentionally
// never ingested — see src/lib/inaturalist.js.
export const INATURALIST_USER = 'anisota';
export const INATURALIST_API = 'https://api.inaturalist.org/v1';
export const LEPIDOPTERA_TAXON_ID = 47157; // moths + butterflies
export const BUTTERFLY_TAXON_ID = 47224; // Papilionoidea, excluded
export const MOTHING_NSID = 'is.dame.mothing';
export const MOTHING_OBSERVATION_NSID = 'is.dame.mothing.observation';

/**
 * Creative works and blog posts are both `site.standard.document` records;
 * the publication they belong to (their `site` field) decides which surface
 * they appear on. This is the `at://` URI of the publication that holds the
 * portfolio / creative works — every `site.standard.document` pointing at it
 * renders on `/creating`; all other standard docs render on `/blogging`.
 *
 * Create it once with `node scripts/portfolio/create-publication.mjs` and
 * paste the printed `at://` URI here. While it stays `null` the site keeps
 * its legacy behavior: `/creating` shows only `is.dame.creating.work`
 * records and every `site.standard.document` is treated as a blog post.
 */
export const PORTFOLIO_PUBLICATION = 'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/site.standard.publication/3mpjrojpfzg2d';

/**
 * The blog publication ("dame's leaflets"). Standard docs pointing here render
 * on `/blogging`. Used as the `site` value when migrating the legacy Eleventy
 * markdown blog posts into `site.standard.document` records (see
 * `src/lib/legacyBlog.js` and the admin "Legacy blog migration" panel).
 */
export const BLOG_PUBLICATION = 'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/site.standard.publication/3lpq72oeo3c2y';

// Infrastructure-only collections (not surfaced as feed verbs).
const PAGE_NSID = 'is.dame.page';
const PROFILE_NSID = 'is.dame.profile';
const HERO_PHRASE_NSID = 'is.dame.hero.phrase';
const RESUME_NSID = 'is.dame.resume';
const RESUME_JOB_NSID = 'is.dame.resume.job';
const RESUME_EDUCATION_NSID = 'is.dame.resume.education';
const ARENA_CHANNEL_NSID = 'is.dame.arena.channel';

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
  arenaChannel: ARENA_CHANNEL_NSID,
};

/** Gerund verbs surfaced on the home feed. Sourced from the registry. */
export const VERBS = REGISTRY_VERBS;

/** Every NSID the site knows how to ingest. Useful for routing fall-through. */
export const KNOWN_NSIDS = NSIDS;
