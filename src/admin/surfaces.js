// The admin surface registry — the one place that answers "what parts does the
// admin have, and how is each one addressed?".
//
// This module JOINS four existing sources read-only; it invents nothing. It is
// the promoted, data-shaped form of `PICKER_GROUPS` (src/pages/Admin.jsx), which
// until now was the only place the `?view=` surfaces were enumerated at all —
// and it was enumerated as JSX, so nothing else could ask it a question.
//
//   src/lib/lexicons.js     → labels, summaries, `legacy`, `rkeyMode`
//   src/config.js           → NSIDs, PORTFOLIO_PUBLICATION, the guestbook pair
//   src/lib/pageRegistry.js → which surfaces host a page-content panel
//   src/lib/verbRegistry.js → (via the callers) the public "view on site" link
//
// Two rules govern every entry here:
//
//  1. **`key` is a URL.** For a `urlByView` surface the key is the literal
//     `?view=` value, so renaming one breaks a bookmark, a `<Link>` somewhere in
//     the studios, and the six per-NSID rewrites in vercel.json's neighbourhood
//     of concerns. Keys are frozen; `surfaces.test.js` pins them.
//  2. **No lucide import.** `icon` is the icon's NAME as a string and the rail
//     maps name → component. Keeping the mapping on the rail's side leaves this
//     module tree-shakeable, and — the reason that actually bites — importable
//     from the node test environment (vitest.config.js runs `environment: node`,
//     where a JSX component import is dead weight at best).
//
// Query-param addressing (`?c=`, `?view=`, `?r=`, `?mode=`, `?for=`) is
// load-bearing and is NOT a style choice: Vercel treats a path segment
// containing dots — `app.bsky.feed.post` — as a static file request, so an NSID
// can never be a path segment here.

import { COLLECTIONS, PORTFOLIO_PUBLICATION, GUESTBOOK_NSID, GUESTBOOK_ENTRY_NSID } from '../config.js';
import { LEXICONS, lexiconFor, knownCollections } from '../lib/lexicons.js';
import { pageSlugForCollection } from '../lib/pageRegistry.js';

const STANDARD_DOC = 'site.standard.document';

/**
 * @typedef {Object} AdminSurface
 * @property {string}  key        Stable id, unique across allSurfaces(). MUST NOT change.
 * @property {boolean} urlByView  TRUE when the surface is addressed as `/admin?view=<key>`,
 *                                FALSE when it is addressed as `/admin?c=<nsid>`.
 *                                This is INDEPENDENT of `kind`: `blogging` and `creating` are
 *                                `kind:'records-list'` AND `urlByView:true`, while `curating` is
 *                                `kind:'records-list'` and `urlByView:false`. `href`, `rowHref`
 *                                and the round-trip invariant are all defined in terms of THIS
 *                                field, never `kind`.
 * @property {string}  label      Display name, e.g. "Blogging".
 * @property {string}  shortLabel Display name for the phone's action bar, where the surface name
 *                                shares a 390px row with a status and a Save. Always `label` or a
 *                                shorter form of it; defaults to `label`.
 * @property {string|null} nsid   Primary NSID, or null (legacy-blogs has none).
 * @property {string[]} nsids     Every NSID this surface reads. `listening` has two; `guestbook`
 *                                lists the entry NSID for labelling only.
 * @property {'content'|'site'|'studios'|'legacy'} group
 * @property {'records-list'|'studio'|'dashboard'} kind
 * @property {string}  href       Fully-formed href.
 * @property {string}  icon       lucide-react icon NAME (a string, never a component).
 * @property {string}  blurb      One short sentence, shown as a tile subtitle.
 * @property {boolean} offRepo    TRUE when this surface's working set does NOT live in the
 *                                owner's repo. Today only `guestbook`. An offRepo surface is
 *                                never counted and never dimmed for a zero count.
 * @property {boolean} countable  May the dashboard attempt an exact count?
 * @property {((value:object)=>boolean)|null} recordFilter  Client-side filter, applied AFTER
 *                                fetching, exactly as today's RecordList does.
 * @property {string|null} newHref  Override for "New record".
 * @property {string|null} pageSlug Page-content panel slug, or null to suppress. Resolved
 *                                eagerly — `undefined` is never stored here.
 * @property {boolean} fullWidth  Studio wants the pane's full measure (no `--measure` clamp).
 * @property {boolean} requiresRkey  TRUE when the surface is meaningless without `&r=` —
 *                                today only `resume-tailor`. Additive to the spec: the rail and
 *                                the Front Desk grid can use it to skip a surface that would
 *                                otherwise offer a link to nowhere.
 * @property {boolean} [synthetic] TRUE only on the fallback surface resolveSurface() mints for
 *                                an NSID the registry has never heard of.
 */

/**
 * Collections too large to count. `listRecords` caps at limit=100 and there is no
 * count API in AT Protocol, so counting these means paging the whole collection:
 * measured on the live repo, `app.bsky.feed.post` is 24,409 records = 246 requests
 * over 120 seconds. Their tiles show a label and an "Open →" and NO number — not
 * "many", not "1000+", nothing. An invented number is worse than no number.
 */
const LARGE_NSIDS = new Set([
  COLLECTIONS.now,
  'app.bsky.feed.post',
  'fm.teal.feed.play',
  'fm.teal.alpha.feed.play',
]);

/**
 * Groups for the Front Desk grid and the rail, in order. The `content` and `site`
 * notes are lifted verbatim from PICKER_GROUPS so the copy the owner already reads
 * does not change under them.
 */
export const SURFACE_GROUPS = Object.freeze([
  Object.freeze({
    key: 'content',
    heading: 'Content',
    note: 'The gerund surfaces — everything that shows up in the feed.',
  }),
  Object.freeze({
    key: 'site',
    heading: 'Site',
    note: 'Page chrome and identity records.',
  }),
  Object.freeze({
    key: 'studios',
    heading: 'Studios',
    note: 'Purpose-built tools that own their own state.',
  }),
  Object.freeze({
    key: 'legacy',
    heading: 'Legacy',
    note: 'Old record types and one-time migration tools.',
  }),
]);

/**
 * Fill in everything derivable so no consumer has to remember a rule. `href`,
 * `nsids`, `countable` and `pageSlug` are computed here precisely so that a new
 * entry cannot get them subtly wrong — the registry is only useful if every row
 * answers the same questions the same way.
 */
function surface(entry) {
  const nsid = entry.nsid ?? null;
  const urlByView = entry.urlByView === true;
  return Object.freeze({
    key: entry.key,
    urlByView,
    label: entry.label,
    // What the phone's action bar puts in slot 1, where the surface name shares
    // a 390px row with a status and a Save. Defaults to `label`, and is only
    // worth setting where the full name is long enough to starve its
    // neighbours: `Sky theme studio` took 170px of a 338px row and left the
    // status 33px, rendering "2/24 tuned" as "2/2…". The design's own bar mock
    // reads `▤ Sky theme ▾` for exactly this reason (§2.1).
    //
    // It is only ever a SHORTER FORM of `label` — never a different name — so
    // the bar and the rail always agree about where you are, and the pane's own
    // <h1> two inches above still carries the full name.
    shortLabel: entry.shortLabel || entry.label,
    nsid,
    nsids: Object.freeze(entry.nsids ? [...entry.nsids] : nsid ? [nsid] : []),
    group: entry.group,
    kind: entry.kind,
    href: urlByView
      ? `/admin?view=${entry.key}`
      : nsid
        ? `/admin?c=${encodeURIComponent(nsid)}`
        : '/admin',
    icon: entry.icon,
    blurb: entry.blurb ?? '',
    offRepo: entry.offRepo === true,
    // Stated once, as a formula rather than a per-row flag, so "can we count
    // this?" cannot drift away from "is it small and is it ours?".
    countable: entry.offRepo !== true && nsid != null && !LARGE_NSIDS.has(nsid),
    recordFilter: entry.recordFilter ?? null,
    newHref: entry.newHref ?? null,
    // Resolved eagerly: `undefined` would mean "ask pageSlugForCollection", and a
    // consumer that forgot to would silently show the wrong panel. `creating`
    // overrides it because its records are site.standard.document, whose default
    // slug is `blogging`.
    pageSlug: entry.pageSlug !== undefined ? entry.pageSlug : nsid ? pageSlugForCollection(nsid) : null,
    fullWidth: entry.fullWidth === true,
    requiresRkey: entry.requiresRkey === true,
  });
}

/**
 * The Front Desk itself. Not part of allSurfaces() — the rail gives it a home
 * button of its own, and it is nobody's grid tile — but resolveSurface() returns
 * it, so the shell always has a non-null surface to render and to key on.
 */
export const DASHBOARD_SURFACE = surface({
  key: '_dashboard',
  urlByView: false,
  label: 'Front desk',
  nsid: null,
  group: 'content',
  kind: 'dashboard',
  icon: 'LayoutDashboard',
  blurb: 'Counts, what needs you, and the way in to everything else.',
  // The Front Desk owns its own grid and must not be squeezed into `--measure`.
  fullWidth: true,
});

/** @type {AdminSurface[]} Ordered: content, site, studios, legacy. */
export const SURFACES = Object.freeze([
  /* --- Content ------------------------------------------------------------ */
  surface({
    key: 'blogging',
    urlByView: true,
    label: 'Blogging',
    nsid: STANDARD_DOC,
    group: 'content',
    kind: 'records-list',
    icon: 'FileText',
    blurb: 'Long-form posts published to the blog publication.',
    // Blogging and Creating are ONE collection split client-side on `value.site`.
    // They are not a partition — publications.js lets a document cross-post onto
    // both — so their counts must never be added together.
    recordFilter: (v) => v?.site !== PORTFOLIO_PUBLICATION,
    newHref: `/admin?c=${encodeURIComponent(STANDARD_DOC)}&mode=new`,
    pageSlug: 'blogging',
  }),
  surface({
    key: 'creating',
    urlByView: true,
    label: 'Creating',
    nsid: STANDARD_DOC,
    group: 'content',
    kind: 'records-list',
    icon: 'Shapes',
    blurb: 'Creative works published to the portfolio publication.',
    recordFilter: (v) => v?.site === PORTFOLIO_PUBLICATION,
    newHref: `/admin?c=${encodeURIComponent(STANDARD_DOC)}&mode=new&for=creating`,
    // Overrides the default: pageSlugForCollection(site.standard.document) is
    // `blogging`, but this surface edits the /creating page's chrome.
    pageSlug: 'creating',
  }),
  surface({
    key: 'logging',
    label: 'Logging',
    nsid: COLLECTIONS.now,
    group: 'content',
    kind: 'records-list',
    icon: 'Activity',
    blurb: 'What you are doing right now, as it happens.',
  }),
  surface({
    key: 'posting',
    label: 'Posting',
    nsid: 'app.bsky.feed.post',
    group: 'content',
    kind: 'records-list',
    icon: 'MessageSquare',
    blurb: 'Bluesky posts; embeds are edited as raw JSON.',
  }),
  surface({
    key: 'curating',
    label: 'Curating',
    nsid: COLLECTIONS.arenaChannel,
    group: 'content',
    kind: 'records-list',
    icon: 'Images',
    blurb: 'Are.na channels published as galleries.',
  }),
  surface({
    key: 'listening',
    urlByView: true,
    label: 'Listening',
    // Two live namespaces: the modern `fm.teal.alpha.feed.play` and the older
    // `fm.teal.feed.play`. The studio resolves the NSID per row, which is exactly
    // why it stays bespoke rather than becoming a generic record list.
    nsid: COLLECTIONS.listen,
    nsids: [COLLECTIONS.listen, 'fm.teal.alpha.feed.play'],
    group: 'content',
    kind: 'studio',
    icon: 'Music',
    blurb: 'Every play on your PDS.',
  }),

  /* --- Site --------------------------------------------------------------- */
  surface({
    key: 'pages',
    urlByView: true,
    label: 'Site pages',
    nsid: COLLECTIONS.page,
    group: 'site',
    kind: 'studio',
    icon: 'Files',
    blurb: 'Titles, intros and bodies for each page.',
  }),
  surface({
    key: 'nav',
    urlByView: true,
    label: 'Nav menu',
    nsid: COLLECTIONS.nav,
    group: 'site',
    kind: 'studio',
    icon: 'Menu',
    blurb: 'The dock menu’s route list, or the built-in one.',
  }),
  surface({
    key: 'sky',
    urlByView: true,
    label: 'Sky theme studio',
    shortLabel: 'Sky theme',
    nsid: COLLECTIONS.sky,
    group: 'site',
    kind: 'studio',
    icon: 'CloudSun',
    blurb: 'Tune the hour-tracking palette, hour by hour.',
    // The palette grid and the 24-hour strip are inherently wide.
    fullWidth: true,
  }),
  surface({
    key: 'publications',
    urlByView: true,
    label: 'Publications',
    nsid: 'site.standard.publication',
    group: 'site',
    kind: 'studio',
    icon: 'Newspaper',
    blurb: 'The publications behind the Standard Site embeds.',
  }),
  surface({
    key: 'guestbook',
    urlByView: true,
    label: 'Guestbook',
    // The book singleton — which IS on this repo and DOES have a lexicon. The
    // entry NSID is listed for labelling and for the Constellation source string
    // only: visitors write `is.dame.guestbook.entry` on their OWN PDS, so
    // listRecords for it here returns a successful EMPTY page, indistinguishable
    // from a real empty collection. Counting it would silently report 0 for the
    // one surface with real moderation work.
    nsid: GUESTBOOK_NSID,
    nsids: [GUESTBOOK_NSID, GUESTBOOK_ENTRY_NSID],
    group: 'site',
    kind: 'studio',
    icon: 'Fingerprint',
    blurb: 'Visitors’ signatures, gathered from backlinks.',
    offRepo: true,
  }),
  surface({
    key: 'about',
    label: 'About',
    nsid: COLLECTIONS.profile,
    group: 'site',
    kind: 'records-list',
    icon: 'User',
    blurb: 'The extended profile behind /themself.',
  }),
  surface({
    key: 'hero',
    label: 'Hero phrases',
    nsid: COLLECTIONS.heroPhrase,
    group: 'site',
    kind: 'records-list',
    icon: 'Sparkles',
    blurb: 'Rotating phrases for the home hero sentence.',
  }),

  /* --- Studios ------------------------------------------------------------ */
  surface({
    key: 'resume',
    urlByView: true,
    label: 'Resume studio',
    shortLabel: 'Resume',
    nsid: COLLECTIONS.resume,
    group: 'studios',
    kind: 'studio',
    icon: 'BriefcaseBusiness',
    blurb: 'Every version, job and education record in one place.',
  }),
  surface({
    key: 'resume-tailor',
    urlByView: true,
    label: 'Tailor version',
    shortLabel: 'Tailor',
    nsid: COLLECTIONS.resume,
    group: 'studios',
    kind: 'studio',
    icon: 'Scissors',
    blurb: 'Pick, reorder and re-word bullets for one version.',
    // Addressed as `?view=resume-tailor&r=<rkey>` and meaningless without it —
    // the Resume studio is what hands out those links.
    requiresRkey: true,
  }),
  surface({
    key: 'ratioed-studio',
    urlByView: true,
    label: 'Ratioed studio',
    shortLabel: 'Ratioed',
    nsid: COLLECTIONS.ratioedPiece,
    group: 'studios',
    kind: 'studio',
    icon: 'Radio',
    blurb: 'Run a piece from first take to seal.',
    // The live feed is a four-column grid.
    fullWidth: true,
  }),
  surface({
    key: 'ratioed',
    urlByView: true,
    label: 'Ratioed catalogue',
    shortLabel: 'Catalogue',
    nsid: COLLECTIONS.ratioedPiece,
    group: 'studios',
    kind: 'studio',
    icon: 'ChartNoAxesColumn',
    blurb: 'Per-piece measurements for the Ratioed project.',
    // Same collection and the same project as `ratioed-studio` above, and its
    // cards are measurement tables — a `<dl>` on a 5.5rem/1fr grid that uses
    // every pixel it is given. Clamped to the measure while its sibling was not,
    // the pair rendered at 544px and 1189px in the same 1224px pane, so flipping
    // between them jumped the content column by 645px.
    fullWidth: true,
  }),

  /* --- Legacy ------------------------------------------------------------- */
  surface({
    key: 'legacy-blogs',
    urlByView: true,
    label: 'Legacy blog migration',
    shortLabel: 'Legacy blogs',
    // No NSID of its own: it READS site.standard.document to decide what is
    // already migrated, but it is a tool, not a collection.
    nsid: null,
    group: 'legacy',
    kind: 'studio',
    icon: 'PackageOpen',
    blurb: 'The old markdown blog, ready to publish to your PDS.',
  }),
]);

/**
 * First sentence of a lexicon summary. Tile subtitles are one clause; the
 * lexicon summaries are paragraphs written for a different context.
 */
function firstSentence(text) {
  if (!text) return '';
  const m = String(text).match(/^[^.!?]*[.!?]/);
  return (m ? m[0] : String(text)).trim();
}

/**
 * Legacy record types are DERIVED, never enumerated: any lexicon flagged
 * `legacy: true` gets a records-list surface. Today that is exactly
 * `is.dame.creating.work` — which is absent from the live repo, so it will count
 * 0 and render dimmed — but the derivation means flagging a lexicon legacy is the
 * whole change, with no second list to remember.
 */
function derivedLegacySurfaces() {
  return knownCollections()
    .filter((nsid) => LEXICONS[nsid]?.legacy)
    .map((nsid) =>
      surface({
        key: `legacy-${nsid}`,
        label: LEXICONS[nsid].label || nsid,
        nsid,
        group: 'legacy',
        kind: 'records-list',
        icon: 'Archive',
        blurb: firstSentence(LEXICONS[nsid].summary),
        // Explicitly none. `pageSlugForCollection('is.dame.creating.work')`
        // answers `creating`, so the legacy surface was hosting the /creating
        // page's content card — a card titled for a different surface, editing
        // the same record the Creating surface already edits, on a surface whose
        // records are a retired lexicon. A derived surface is a record list and
        // nothing else.
        pageSlug: null,
      }),
    );
}

// Computed once. Object identity matters: these surfaces end up in React effect
// dependency arrays and as `useMemo` inputs, and a fresh array per call would
// re-run every one of them on every render.
let allCache = null;

/** @returns {AdminSurface[]} SURFACES plus one derived entry per legacy lexicon. */
export function allSurfaces() {
  if (!allCache) allCache = Object.freeze([...SURFACES, ...derivedLegacySurfaces()]);
  return allCache;
}

/**
 * @param {string} key
 * @returns {AdminSurface|null}
 */
export function surfaceByKey(key) {
  if (!key) return null;
  if (key === DASHBOARD_SURFACE.key) return DASHBOARD_SURFACE;
  return allSurfaces().find((s) => s.key === key) || null;
}

/**
 * Resolve the surface for a URL state. Mirrors today's Admin.jsx precedence
 * exactly, in three steps:
 *
 *  1. `view` names a `urlByView` surface → that surface.
 *  2. otherwise `collection` is set → the records-list surface for that NSID, or
 *     a synthetic one when the NSID is unknown.
 *  3. otherwise → the Front Desk.
 *
 * **A `?c=` URL never resolves to a studio.** `?c=site.standard.publication` must
 * land on the generic record list, not PublicationsManager, and
 * `?c=is.dame.guestbook&r=self` must land on the generic editor for the book
 * record, not the moderation panel — GuestbookModerationPanel and
 * PageContentPanel both link into the generic editor and depend on it.
 *
 * `r` and `mode` are legal on a `urlByView` surface and are ignored here; the
 * shell passes them on. An unrecognised `view` falls through to step 2, then 3.
 *
 * @param {{ view?: string|null, collection?: string|null }} params
 * @returns {AdminSurface} Never null.
 */
export function resolveSurface({ view = null, collection = null } = {}) {
  if (view) {
    const byView = surfaceByKey(view);
    if (byView && byView.urlByView) return byView;
  }
  if (collection) {
    const byNsid = allSurfaces().find((s) => !s.urlByView && s.nsid === collection);
    if (byNsid) return byNsid;
    return syntheticSurface(collection);
  }
  return DASHBOARD_SURFACE;
}

// Synthetic surfaces are minted per call, so they are memoized by NSID to keep
// the same identity across renders for the same URL.
const syntheticCache = new Map();

/**
 * The surface for an NSID the registry has never heard of — what the Front Desk's
 * "open any NSID" control produces. It is deliberately `countable: false`: an
 * arbitrary collection may be enormous, and this is the one place we cannot know.
 */
function syntheticSurface(nsid) {
  const hit = syntheticCache.get(nsid);
  if (hit) return hit;
  // A synthetic surface never appears in the grid or the rail — both iterate
  // allSurfaces() — but the BREADCRUMB reads its group, and `legacy` was a lie in
  // the common case: `?c=is.dame.sky&r=…` is how you reach the raw record behind
  // the Sky studio, and drilling out of a Site-group studio announced "Legacy".
  // So borrow the group from whichever registered surface already owns this NSID,
  // and keep `legacy` only for an NSID nothing here has heard of, where it is the
  // honest bucket for "an old collection you typed in by hand".
  const home = allSurfaces().find((s) => s.nsids.includes(nsid));
  const made = Object.freeze({
    ...surface({
      key: `c:${nsid}`,
      label: lexiconFor(nsid)?.label || nsid,
      nsid,
      group: home?.group || 'legacy',
      kind: 'records-list',
      icon: 'Database',
      blurb: '',
    }),
    countable: false,
    synthetic: true,
  });
  syntheticCache.set(nsid, made);
  return made;
}

/**
 * The href for one record row, PRESERVING the surface it was reached through.
 * Keyed on `urlByView`, never on `kind`: a `urlByView` records surface keeps its
 * `?view=` (so a draft opened from Creating comes back to Creating), and
 * everything else addresses the collection directly.
 *
 * For a studio-homed collection this yields `/admin?c=<nsid>&r=<rkey>`, which by
 * design lands on the GENERIC editor rather than the studio — the only way to
 * reach the raw record behind a studio.
 *
 * @param {AdminSurface} surf
 * @param {string} rkey
 * @returns {string}
 */
export function rowHrefFor(surf, rkey) {
  const key = encodeURIComponent(rkey);
  if (surf?.urlByView && surf.kind === 'records-list') return `/admin?view=${surf.key}&r=${key}`;
  const nsid = surf?.nsid;
  if (!nsid) return '/admin';
  return `/admin?c=${encodeURIComponent(nsid)}&r=${key}`;
}
