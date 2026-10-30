// Per-page copy for the dynamic Open Graph cards + the crawler-facing <head>
// meta injected by `middleware.js`. Keyed by the site's route paths. The
// framing everywhere is "Dame is… {label}" — the same gerund voice the nav
// and breadcrumbs use (see src/components/ActionDock.jsx).
//
// `label`   — the gerund shown big on the card (and after "Dame is…"). One
//             page (/available) breaks the gerund voice on purpose — see there.
// `title`   — the <title> / og:title text.
// `desc`    — og:description + the card subtitle.
// `nsid`    — the AT-Protocol lexicon this surface reads from, printed in the
//             card's bottom margin as a mono chip. Sourced from
//             src/lib/verbRegistry.js (the primary collection per verb) and the
//             infrastructure NSIDs in src/config.js.
//
// Pages not listed here fall back to `DEFAULT` (the home card). Record routes
// (/blogging/:slug, /posting/:rkey, …) get a card of their own from
// og/records.js, and borrow their section's entry here for the page title and
// for the card drawn when the record can't be resolved.

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
  // The one card whose headline isn't the route's own word: /available is a
  // résumé, and "for hire" says what the page is asking for where "available"
  // only describes a state. The breadcrumb and <title> still read /available.
  '/available': {
    label: 'for hire',
    title: 'dame.is available',
    desc: "Dame's résumé and work history — design, strategy, and building on the open social web. Currently available for hire.",
    nsid: 'is.dame.resume',
  },
  '/blogging': {
    label: 'blogging',
    title: 'dame.is blogging',
    desc: 'Long-form posts on the open social web, atproto, and building in public.',
    nsid: 'site.standard.document',
  },
  // The newsletter's page (src/pages/BloggingSubscribe.jsx): the blog's card,
  // asking for an address. The newsletter is the blog's, sent by Leaflet, but
  // carries more than its posts.
  '/blogging/subscribe': {
    label: 'blogging',
    title: 'Subscribe to the dame.is newsletter',
    desc: 'New blog posts from dame.is by email, along with updates, roundups and announcements. Sent through Leaflet.',
    nsid: 'site.standard.publication',
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
    nsid: 'fm.teal.feed.play',
  },
  // An album is not a record anywhere — teal.fm scrobbles tracks — so this
  // surface is what the plays add up to, and its NSID chip names them.
  '/listening/albums': {
    label: 'albums',
    title: 'dame.is listening — albums',
    desc: 'Every album in dame’s recent play history, ranked by how often — derived from the scrobbles rather than stored as records of their own.',
    nsid: 'fm.teal.feed.play',
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
  // The guestbook presents as "Welcoming" (dame is welcoming) at /welcoming;
  // its slug and records stay `guestbook`. Same URL/slug split as resume →
  // "Available" at /available. The card's NSID chip names the visitor-written
  // signatures the page lists (is.dame.guestbook.entry), not the book singleton.
  '/welcoming': {
    label: 'welcoming',
    title: 'dame.is welcoming',
    desc: 'Sign in with any atproto account and leave a note that you were here. Every signature lives on the signer’s own PDS and reaches this page as a backlink.',
    nsid: 'is.dame.guestbook.entry',
  },
  '/sharing': {
    label: 'sharing',
    title: 'dame.is sharing',
    desc: "Dame's ethos and the things worth passing on.",
    nsid: 'is.dame.page',
  },
  // The atproto explorer. Its sub-pages are other people's repos as much as
  // dame's, so the middleware keeps those out of the index; this copy is what
  // the explorer's own landing page and every card under it say.
  '/exploring': {
    label: 'exploring',
    title: 'dame.is exploring',
    desc: 'A browser for AT Protocol repositories — every collection and record behind this site, read straight off the PDS, and anyone else’s too.',
    nsid: 'com.atproto.repo.listRecords',
  },

  // Verbs with record pages but no index page. Nothing routes to
  // /photographing itself; these exist so that /photographing/:rkey has a
  // section to name its page and draw its card from, the way /posting/:rkey
  // has /posting. Without them a photo, a like or a flush carded as the home
  // page and was titled plain "dame.is". Same voice as the rest; the NSID is
  // each verb's primary collection in src/lib/verbRegistry.js.
  '/photographing': {
    label: 'photographing',
    title: 'dame.is photographing',
    desc: 'Photo galleries and stories dame has posted to Grain, read from the AT Protocol.',
    nsid: 'social.grain.gallery',
  },
  '/observing': {
    label: 'observing',
    title: 'dame.is observing',
    desc: 'Everything dame has logged on iNaturalist that isn’t a moth — birds, plants, fungi — mirrored onto the AT Protocol.',
    nsid: 'is.dame.observing.observation',
  },
  '/liking': {
    label: 'liking',
    title: 'dame.is liking',
    desc: 'Things dame has liked across Bluesky, Grain, Tangled and Anisota.',
    nsid: 'app.bsky.feed.like',
  },
  '/reposting': {
    label: 'reposting',
    title: 'dame.is reposting',
    desc: 'Posts dame has passed along, reposted from across the atmosphere.',
    nsid: 'app.bsky.feed.repost',
  },
  '/following': {
    label: 'following',
    title: 'dame.is following',
    desc: 'Accounts dame has followed across Bluesky, Grain and Tangled.',
    nsid: 'app.bsky.graph.follow',
  },
  '/listing': {
    label: 'listing',
    title: 'dame.is listing',
    desc: 'Lists of accounts dame keeps on Bluesky.',
    nsid: 'app.bsky.graph.list',
  },
  '/feeding': {
    label: 'feeding',
    title: 'dame.is feeding',
    desc: 'Custom feeds dame has published for Bluesky.',
    nsid: 'app.bsky.feed.generator',
  },
  '/commenting': {
    label: 'commenting',
    title: 'dame.is commenting',
    desc: 'Comments dame has left on Grain galleries and Leaflet documents.',
    nsid: 'social.grain.comment',
  },
  '/flushing': {
    label: 'flushing',
    title: 'dame.is flushing',
    desc: 'Flushes from flushes.app — the rest of the sentence that starts “dame is flushing”.',
    nsid: 'im.flushing.right.now',
  },
  '/crafting': {
    label: 'crafting',
    title: 'dame.is crafting',
    desc: 'Pieces made in the Anisota Lab — poems, sigils, carvings, inkblots and synths.',
    nsid: 'net.anisota.lab.poetry',
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
  { label: 'listening', nsid: 'fm.teal.feed.play' },
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
