// Single source of truth for every record type the home feed knows about.
//
// Both the build-time prefetch script (Node) and the React app import this
// module. Adding a new collection should be a one-place change here, plus an
// entry in any renderer switch that wants a bespoke layout (otherwise the
// generic fallback kicks in).
//
// Each verb groups one or more NSIDs. NSIDs that span protocols carry a
// `source` tag (e.g. `bsky` | `grain` | `tangled` | `leaflet` | `standard` |
// `dame` | `teal`) so the UI can offer a secondary filter and renderers can
// branch on origin.
//
// Per-collection shape:
//   nsid:    AT Protocol lexicon NSID (the PDS collection name).
//   source:  Short tag identifying the network the record originates from.
//   kind:    'content' — the record is the thing being shown.
//            'reference' — the record points at another record (like, repost,
//                          favorite, follow, star, vote); the prefetch step
//                          resolves the subject into a `subject` field.
//            'appviewFeed' — fetched via the Bluesky AppView feed instead of
//                          listRecords; only used for `app.bsky.feed.post`.
//   subject: For reference records, a tag describing what kind of subject we
//            expect ('bsky.post' | 'bsky.profile' | 'bsky.list' | 'atproto'
//            for "any at:// URI, look up via PLC + getRecord").
//   max:     Per-collection cap for prefetch's listRecords pagination.
//   maxAgeDays: Optional cutoff. Records older than this are dropped before
//            being written into the unified feed (per-verb snapshots keep
//            them so per-page views aren't truncated).
//
// Per-verb shape:
//   verb:        The gerund the rest of the codebase uses to identify it.
//   collections: One or more `{ nsid, source, kind, subject?, max, maxAgeDays? }`.
//   icon:        lucide-react icon name (resolved in VerbIcon.jsx).
//   renderer:    Component name used by FeedItem.jsx; null falls through to the
//                generic fallback. Renderers themselves live in src/components/.
//   recordHref:  Optional template for per-record page URL. `null` (the
//                default) means use the generic `/{nsid}/{rkey}` form.
//   pastTense:   Used by ReferenceCard's "Dame {pastTense} {subject}" label.

export const VERB_REGISTRY = [
  {
    verb: 'logging',
    icon: 'NotebookPen',
    renderer: 'StatusEntry',
    recordHref: ({ rkey }) => (rkey ? `/logging/${rkey}` : null),
    pastTense: 'logged',
    collections: [
      { nsid: 'is.dame.now', source: 'dame', kind: 'content', max: 500 },
    ],
  },
  {
    verb: 'posting',
    icon: 'MessageCircle',
    renderer: 'PostCard',
    recordHref: ({ rkey }) => (rkey ? `/posting/${rkey}` : null),
    pastTense: 'posted',
    collections: [
      { nsid: 'app.bsky.feed.post', source: 'bsky', kind: 'appviewFeed', max: 200 },
    ],
  },
  {
    verb: 'blogging',
    icon: 'BookOpen',
    renderer: 'BlogCard',
    pastTense: 'blogged',
    collections: [
      { nsid: 'site.standard.document', source: 'standard', kind: 'content', max: 100 },
      { nsid: 'site.standard.publication', source: 'standard', kind: 'content', max: 50 },
      { nsid: 'pub.leaflet.document', source: 'leaflet', kind: 'content', max: 100 },
      { nsid: 'pub.leaflet.publication', source: 'leaflet', kind: 'content', max: 50 },
    ],
  },
  {
    verb: 'listening',
    icon: 'Headphones',
    renderer: 'ListenRow',
    recordHref: ({ rkey }) => (rkey ? `/listening/${rkey}` : null),
    pastTense: 'listened to',
    collections: [
      { nsid: 'fm.teal.alpha.feed.play', source: 'teal', kind: 'content', max: 100 },
    ],
  },
  {
    verb: 'creating',
    icon: 'Hammer',
    renderer: 'CreatingCard',
    pastTense: 'created',
    // Creative works are addressed by a human slug. Standard docs keep it in
    // `path`, legacy is.dame.creating.work in `slug`; fall back to the rkey.
    // (Slug logic is inlined to avoid a config ↔ registry import cycle.)
    recordHref: ({ payload, rkey }) => {
      const raw = payload?.slug || payload?.path || rkey || '';
      const slug = String(raw).replace(/^\/+/, '');
      return slug ? `/creating/${encodeURIComponent(slug)}` : null;
    },
    collections: [
      { nsid: 'is.dame.creating.work', source: 'dame', kind: 'content', max: 200 },
    ],
  },
  {
    verb: 'photographing',
    icon: 'Camera',
    renderer: 'MediaCard',
    pastTense: 'photographed',
    collections: [
      { nsid: 'social.grain.gallery', source: 'grain', kind: 'content', max: 100 },
      { nsid: 'social.grain.story', source: 'grain', kind: 'content', max: 100 },
    ],
  },
  {
    verb: 'liking',
    icon: 'Heart',
    renderer: 'ReferenceCard',
    pastTense: 'liked',
    collections: [
      { nsid: 'app.bsky.feed.like', source: 'bsky', kind: 'reference', subject: 'bsky.post', max: 200, maxAgeDays: 90 },
      { nsid: 'social.grain.favorite', source: 'grain', kind: 'reference', subject: 'atproto', max: 200, maxAgeDays: 90 },
      { nsid: 'sh.tangled.feed.star', source: 'tangled', kind: 'reference', subject: 'atproto', max: 200, maxAgeDays: 90 },
    ],
  },
  {
    verb: 'reposting',
    icon: 'Repeat2',
    // Repost records on the PDS are just pointers (`subject = { uri, cid }`).
    // The prefetch step hydrates each one's subject via
    // `app.bsky.feed.getPosts` and reshapes the row into the full PostCard
    // payload, so reposts can render inline like authored posts (with a
    // small "↻ reposted" badge and the original author header).
    renderer: 'PostCard',
    recordHref: ({ rkey }) => (rkey ? `/reposting/${rkey}` : null),
    pastTense: 'reposted',
    collections: [
      { nsid: 'app.bsky.feed.repost', source: 'bsky', kind: 'reference', subject: 'bsky.post', max: 200, maxAgeDays: 90 },
    ],
  },
  {
    verb: 'following',
    icon: 'UserPlus',
    renderer: 'ReferenceCard',
    pastTense: 'followed',
    collections: [
      { nsid: 'app.bsky.graph.follow', source: 'bsky', kind: 'reference', subject: 'bsky.profile', max: 200, maxAgeDays: 90 },
      { nsid: 'social.grain.graph.follow', source: 'grain', kind: 'reference', subject: 'bsky.profile', max: 200, maxAgeDays: 90 },
      { nsid: 'sh.tangled.graph.follow', source: 'tangled', kind: 'reference', subject: 'bsky.profile', max: 200, maxAgeDays: 90 },
    ],
  },
  {
    verb: 'listing',
    icon: 'ListChecks',
    renderer: 'ListCard',
    pastTense: 'curated',
    collections: [
      { nsid: 'app.bsky.graph.list', source: 'bsky', kind: 'content', max: 100, withMembers: 'app.bsky.graph.listitem' },
    ],
  },
  {
    verb: 'feeding',
    icon: 'Rss',
    renderer: 'GeneratorCard',
    pastTense: 'published a feed',
    collections: [
      { nsid: 'app.bsky.feed.generator', source: 'bsky', kind: 'content', max: 50 },
    ],
  },
  {
    verb: 'commenting',
    icon: 'MessagesSquare',
    renderer: 'CommentCard',
    pastTense: 'commented',
    collections: [
      { nsid: 'social.grain.comment', source: 'grain', kind: 'content', max: 200, maxAgeDays: 180 },
      { nsid: 'pub.leaflet.comment', source: 'leaflet', kind: 'content', max: 200, maxAgeDays: 180 },
    ],
  },
  {
    verb: 'voting',
    icon: 'Vote',
    renderer: 'VoteCard',
    pastTense: 'voted',
    collections: [
      { nsid: 'pub.leaflet.poll.vote', source: 'leaflet', kind: 'reference', subject: 'atproto', max: 200, maxAgeDays: 180 },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Derived lookups                                                     */
/* ------------------------------------------------------------------ */

const REGISTRY_BY_VERB = Object.fromEntries(VERB_REGISTRY.map((v) => [v.verb, v]));

const REGISTRY_BY_NSID = {};
for (const v of VERB_REGISTRY) {
  for (const c of v.collections) {
    REGISTRY_BY_NSID[c.nsid] = { verb: v, collection: c };
  }
}

/** All gerund verbs in registry order. Drives FeedFilters chip layout. */
export const VERBS = VERB_REGISTRY.map((v) => v.verb);

/**
 * Verbs enabled in the home feed by default (when no `verbs=` URL param
 * is present). Excludes high-volume reference verbs that would dominate
 * the timeline if shown unfiltered — toggling them on is opt-in.
 */
export const DEFAULT_HOME_VERBS = [
  'logging',
  'posting',
  'blogging',
  'listening',
  'creating',
  'photographing',
  'reposting',
  'following',
  'listing',
  'feeding',
  'commenting',
];

/** Distinct source tags across the registry. Drives the source sub-filter. */
export const SOURCES = Array.from(
  new Set(VERB_REGISTRY.flatMap((v) => v.collections.map((c) => c.source))),
);

/** Look up a verb's full config. */
export function verbConfig(verb) {
  return REGISTRY_BY_VERB[verb] || null;
}

/** Look up which verb owns a given NSID (and the per-collection config). */
export function nsidConfig(nsid) {
  return REGISTRY_BY_NSID[nsid] || null;
}

/** Verb -> primary NSID, used for routing/legacy lookups. */
export function primaryNsid(verb) {
  return REGISTRY_BY_VERB[verb]?.collections[0]?.nsid || null;
}

/** All NSIDs in the registry, deduped. */
export const NSIDS = Array.from(new Set(VERB_REGISTRY.flatMap((v) => v.collections.map((c) => c.nsid))));

/**
 * Given a verb + payload, return the canonical record-page path.
 *   - If the verb defines a custom `recordHref` template, use it.
 *   - Otherwise return the generic /{nsid}/{rkey} form, which Record.jsx
 *     handles via the registry-driven fallback.
 */
export function recordHrefFor(verb, { atUri, rkey, slug, source, payload } = {}) {
  const cfg = verbConfig(verb);
  if (!cfg) return null;
  if (typeof cfg.recordHref === 'function') {
    const href = cfg.recordHref({ atUri, rkey, slug, source, payload });
    if (href) return href;
  }
  // Generic fallback: /{nsid}/{rkey}
  const nsid = nsidFromAtUri(atUri) || cfg.collections.find((c) => c.source === source)?.nsid || cfg.collections[0]?.nsid;
  if (!nsid || !rkey) return null;
  return `/${nsid}/${encodeURIComponent(rkey)}`;
}

function nsidFromAtUri(atUri) {
  if (!atUri) return null;
  const m = String(atUri).match(/^at:\/\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}

/**
 * Pretty label for a verb on the record page header (e.g. "a status",
 * "a post"). Defaults to a plain "a record" so unknown verbs still read.
 */
export const VERB_LABELS = {
  logging: 'a status',
  posting: 'a post',
  blogging: 'a blog post',
  listening: 'a play',
  creating: 'a work',
  photographing: 'a photo',
  liking: 'a like',
  reposting: 'a repost',
  following: 'a follow',
  listing: 'a list',
  feeding: 'a feed',
  commenting: 'a comment',
  voting: 'a vote',
};
