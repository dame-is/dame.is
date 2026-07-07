// Per-page copy for the dynamic Open Graph cards + the crawler-facing <head>
// meta injected by `middleware.js`. Keyed by the site's route paths. The
// framing everywhere is "Dame is… {label}" — the same gerund voice the nav
// and breadcrumbs use (see src/components/ActionDock.jsx).
//
// `label`   — the gerund shown big on the card (and after "Dame is…").
// `title`   — the <title> / og:title text.
// `desc`    — og:description + the card subtitle.
//
// Pages not listed here fall back to `DEFAULT` (the home card). Dynamic
// record routes (/blogging/:slug, /creating/:slug, …) intentionally use the
// default for now — per-record cards would need the record title at request
// time, which is a later enhancement.

export const SITE = {
  domain: 'dame.is',
  tagline: 'An atmospheric website built atop the AT Protocol.',
};

export const DEFAULT = {
  label: '',
  title: 'Dame is…',
  desc: 'An atmospheric website by dame, built atop the AT Protocol.',
};

export const PAGES = {
  '/': {
    label: '',
    title: 'Dame is…',
    desc: 'An atmospheric personal website — statuses, posts, blogs, listens, and creations, interleaved and built atop the AT Protocol.',
  },
  '/themself': {
    label: 'themself',
    title: 'Dame is… themself',
    desc: 'Who dame is — a longer look at the person behind the pixels, drawn live from the AT Protocol.',
  },
  '/for-hire': {
    label: 'for hire',
    title: 'Dame is… for hire',
    desc: "Dame's résumé and work history — design, strategy, and building on the open social web.",
  },
  '/blogging': {
    label: 'blogging',
    title: 'Dame is… blogging',
    desc: 'Long-form essays on the open social web, atproto, and building in public.',
  },
  '/creating': {
    label: 'creating',
    title: 'Dame is… creating',
    desc: 'A portfolio of creative work — projects, experiments, and things made along the way.',
  },
  '/curating': {
    label: 'curating',
    title: 'Dame is… curating',
    desc: 'Collected references and inspirations — channels of things worth keeping.',
  },
  '/listening': {
    label: 'listening',
    title: 'Dame is… listening',
    desc: 'A live scrobble of what dame is playing, streamed from the AT Protocol.',
  },
  '/posting': {
    label: 'posting',
    title: 'Dame is… posting',
    desc: "Dame's Bluesky posts, grouped by day and mirrored from the AT Protocol.",
  },
  '/logging': {
    label: 'logging',
    title: 'Dame is… logging',
    desc: 'Status updates and small signals of life, logged to the AT Protocol.',
  },
  '/mothing': {
    label: 'mothing',
    title: 'Dame is… mothing',
    desc: 'Moths at the light — observations logged from nights spent watching the dark.',
  },
  '/sharing': {
    label: 'sharing',
    title: 'Dame is… sharing',
    desc: "Dame's ethos and the things worth passing on.",
  },
};

/** Resolve a request path to its OG copy, falling back to the home card. */
export function pageMeta(pathname) {
  const clean = (pathname || '/').replace(/\/+$/, '') || '/';
  return PAGES[clean] || DEFAULT;
}
