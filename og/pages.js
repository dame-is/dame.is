// Per-page copy for the dynamic Open Graph cards + the crawler-facing <head>
// meta injected by `middleware.js`. Keyed by the site's route paths. The
// framing everywhere is "Dame is… {label}" — the same gerund voice the nav
// and breadcrumbs use (see src/components/ActionDock.jsx).
//
// `label`   — the gerund shown big on the card (and after "Dame is…").
// `title`   — the <title> / og:title text.
// `desc`    — og:description + the card subtitle.
// `nsid`    — the AT-Protocol lexicon this surface reads from, printed in the
//             card's bottom margin as a mono chip. Sourced from
//             src/lib/verbRegistry.js (the primary collection per verb) and the
//             infrastructure NSIDs in src/config.js.
//
// Pages not listed here fall back to `DEFAULT` (the home card). Dynamic record
// routes (/blogging/:slug, …) intentionally use the default for now — per-record
// cards would need the record title at request time, a later enhancement.

export const SITE = {
  domain: 'dame.is',
  tagline: 'An atmospheric website built atop the AT Protocol.',
};

export const DEFAULT = {
  label: '',
  title: 'dame.is',
  desc: 'An atmospheric website by dame, built atop the AT Protocol.',
  nsid: 'is.dame.page',
};

export const PAGES = {
  '/': {
    label: '',
    title: 'dame.is',
    desc: 'An atmospheric personal website — statuses, posts, blogs, listens, and creations, interleaved and built atop the AT Protocol.',
    nsid: 'is.dame.page',
  },
  '/themself': {
    label: 'themself',
    title: 'dame.is themself',
    desc: 'Who dame is — a longer look at the person behind the pixels, drawn live from the AT Protocol.',
    nsid: 'is.dame.profile',
  },
  '/for-hire': {
    label: 'for hire',
    title: 'dame.is for hire',
    desc: "Dame's résumé and work history — design, strategy, and building on the open social web.",
    nsid: 'is.dame.resume',
  },
  '/blogging': {
    label: 'blogging',
    title: 'dame.is blogging',
    desc: 'Long-form essays on the open social web, atproto, and building in public.',
    nsid: 'site.standard.document',
  },
  '/creating': {
    label: 'creating',
    title: 'dame.is creating',
    desc: 'A portfolio of creative work — projects, experiments, and things made along the way.',
    nsid: 'is.dame.creating.work',
  },
  '/curating': {
    label: 'curating',
    title: 'dame.is curating',
    desc: 'Collected references and inspirations — channels of things worth keeping.',
    nsid: 'is.dame.arena.channel',
  },
  '/listening': {
    label: 'listening',
    title: 'dame.is listening',
    desc: 'A live scrobble of what dame is playing, streamed from the AT Protocol.',
    nsid: 'fm.teal.alpha.feed.play',
  },
  '/posting': {
    label: 'posting',
    title: 'dame.is posting',
    desc: "Dame's Bluesky posts, grouped by day and mirrored from the AT Protocol.",
    nsid: 'app.bsky.feed.post',
  },
  '/logging': {
    label: 'logging',
    title: 'dame.is logging',
    desc: 'Status updates and small signals of life, logged to the AT Protocol.',
    nsid: 'is.dame.now',
  },
  '/mothing': {
    label: 'mothing',
    title: 'dame.is mothing',
    desc: 'Moths at the light — observations logged from nights spent watching the dark.',
    nsid: 'is.dame.mothing.observation',
  },
  '/sharing': {
    label: 'sharing',
    title: 'dame.is sharing',
    desc: "Dame's ethos and the things worth passing on.",
    nsid: 'is.dame.page',
  },
};

// The home card is a "table of contents" of the site's main surfaces, each
// paired with the AT-Protocol lexicon behind it. Order = how they read down
// the card (they cascade + fade). Keep it to the content verbs (not the
// utility pages) so the card stays a tight index.
export const HOME_INDEX = [
  { label: 'blogging', nsid: 'site.standard.document' },
  { label: 'creating', nsid: 'is.dame.creating.work' },
  { label: 'mothing', nsid: 'is.dame.mothing.observation' },
  { label: 'listening', nsid: 'fm.teal.alpha.feed.play' },
  { label: 'posting', nsid: 'app.bsky.feed.post' },
  { label: 'curating', nsid: 'is.dame.arena.channel' },
];

/** Normalise a request path to a canonical key ('/blogging', '/'). */
export function cleanPath(pathname) {
  return (pathname || '/').replace(/\/+$/, '') || '/';
}

/** Resolve a request path to its OG copy, falling back to the home card. */
export function pageMeta(pathname) {
  return PAGES[cleanPath(pathname)] || DEFAULT;
}

/** Breadcrumb segments for a path: '/blogging' → ['blogging']. */
export function segsFor(pathname) {
  return cleanPath(pathname).split('/').filter(Boolean);
}
