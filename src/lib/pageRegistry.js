// Registry of site "pages" whose chrome (title + intro, and optionally a
// markdown body) can live either hardcoded here ("local") or as an
// `is.dame.page/<slug>` record on the PDS.
//
// This file is the single source of the *local* defaults AND the seed used
// when migrating a page onto the PDS — `usePageContent(slug)` falls back to
// these values when no record exists, and the admin Page-content panel copies
// them into a new record so a migration is visually lossless.
//
// `collection` maps a page to the feed collection whose admin record-list
// hosts an embedded panel. `null` means the page has no backing feed
// collection (it's pure page content) and only appears in the standalone
// Site-pages overview.

import { COLLECTIONS } from '../config.js';

export const PAGE_REGISTRY = {
  creating: {
    slug: 'creating',
    label: 'Creating',
    title: 'Creating',
    intro: 'A portfolio of works — art, software, writing, music, and more.',
    collection: COLLECTIONS.creating,
  },
  blogging: {
    slug: 'blogging',
    label: 'Blogging',
    title: 'Blogging',
    intro: 'A book of long-form posts. Each entry is a site.standard.document record.',
    collection: COLLECTIONS.blogging,
  },
  logging: {
    slug: 'logging',
    label: 'Logging',
    title: 'Logging',
    intro: 'Status updates, archived. Each entry is one is.dame.now record.',
    collection: COLLECTIONS.now,
  },
  posting: {
    slug: 'posting',
    label: 'Posting',
    title: 'Posting',
    intro: 'Bluesky posts, freshest first, grouped by day-of-life.',
    collection: 'app.bsky.feed.post',
  },
  listening: {
    slug: 'listening',
    label: 'Listening',
    title: 'Listening',
    intro: 'Songs played, freshest first, grouped by day-of-life.',
    collection: COLLECTIONS.listen,
  },
  curating: {
    slug: 'curating',
    label: 'Curating',
    title: 'Curating',
    intro: 'Galleries of images collected on Are.na.',
    collection: COLLECTIONS.arenaChannel,
  },
  sharing: {
    slug: 'sharing',
    label: 'Sharing',
    title: 'Sharing',
    intro: 'Things worth handing off.',
    collection: null,
  },
  resume: {
    slug: 'resume',
    label: 'Resume',
    title: 'Resume',
    intro: 'A decade of building social software, brands, and communities. Each entry backlinks to a job record on my PDS.',
    collection: null,
  },
};

export function pageDefault(slug) {
  return PAGE_REGISTRY[slug] || null;
}

export function knownPageSlugs() {
  return Object.keys(PAGE_REGISTRY);
}

/** Reverse lookup used by the embedded panel: collection NSID → page slug. */
export function pageSlugForCollection(nsid) {
  return Object.values(PAGE_REGISTRY).find((p) => p.collection === nsid)?.slug || null;
}
