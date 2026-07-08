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
    intro: 'Galleries of images I’ve been collecting.',
    collection: COLLECTIONS.arenaChannel,
  },
  sharing: {
    slug: 'sharing',
    label: 'Sharing',
    title: 'Sharing',
    intro: 'Things worth handing off.',
    collection: null,
  },
  mothing: {
    slug: 'mothing',
    label: 'Mothing',
    title: 'Mothing',
    intro: 'Moths I’ve found and photographed, pulled from iNaturalist. A running field notebook of the winged things drawn to the light.',
    collection: null,
  },
  resume: {
    slug: 'resume',
    label: 'For hire',
    title: 'For hire',
    intro: 'A decade of building social software, brands, and communities. Each entry backlinks to a job record on my PDS.',
    collection: null,
  },
  about: {
    slug: 'about',
    label: 'About this site',
    title: 'About this site',
    // The "What is this site?" primer shown in the bottom-bar info sheet.
    // Authored as markdown so it can migrate onto the PDS and be edited there.
    body: `**dame.is** is a personal website built on top of the *AT Protocol*. It's where Dame writes, posts, plays music, ships projects, and keeps a running log of what they're up to. The data behind every record on this page is portable, open, and not stuck on this website.

### What is atproto?

The Authenticated Transfer Protocol (**atproto** for short) is an open networking protocol designed by Bluesky. It separates *where your data lives* from *which apps you use to read or write it*. Anyone can build an app on atproto and read from the same shared, user-owned data layer.

### What's the Atmosphere?

"The Atmosphere" is the affectionate nickname for the ecosystem of apps and services built on atproto, including Bluesky, Tangled, Grain, Leaflet, Flushes, and many others. Each app is a different view into the same shared network of people and records.

### Where does this content live?

Every record you see on this site (posts, status updates, songs played, blog entries, project pages) is stored on Dame's own **Personal Data Server** (their PDS). They own it. This site is just one of many possible windows into that data, and the data comes with them if they ever move PDSes or build another frontend.`,
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
