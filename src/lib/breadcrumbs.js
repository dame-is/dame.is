// The top chrome's breadcrumb trail, and the bottom bar's Back fallback that
// reads it.
//
// Every prefix of the path is a crumb, but not every prefix is a page. Record
// pages live at `/{verb}/:rkey` or `/{nsid}/:rkey`, and most verbs have no
// index of their own: liking, reposting, flushing and the rest are only ever
// shown inside the home feed. So the trail of a like, `/ app.bsky.feed.like /
// 3k…`, used to link its middle crumb to `/app.bsky.feed.like`, which is the
// 404 page. Likes are over half of the home feed, so that was the trail on
// most record pages, and the Back button sent a deep-linked visitor to the
// same place.
//
// A crumb now links only where a route answers. A verb (or a lexicon that
// belongs to one) with no index links to the home feed filtered to that verb,
// which is where its records are actually listed. Anything else that isn't a
// page is drawn as plain text, labelled as it always was.

import { VERB_REGISTRY, nsidConfig, verbConfig } from './verbRegistry.js';

/**
 * The paths App.jsx declares a page for, minus the `*` catch-all. Kept here
 * rather than imported because App.jsx is JSX that also pulls in every page;
 * breadcrumbs.test.js reads App.jsx and fails if the two drift apart.
 */
export const DECLARED_ROUTES = [
  '/',
  '/themself',
  '/posting',
  '/logging',
  '/listening',
  '/listening/albums',
  '/listening/albums/:slug',
  '/blogging',
  '/blogging/:slug',
  '/creating',
  '/creating/:slug',
  '/creating/:slug/participants',
  '/creating/:slug/participant/:handle',
  '/creating/:slug/:piece',
  '/curating',
  '/curating/:slug',
  '/available',
  '/available/:slug',
  '/for-hire',
  '/for-hire/:slug',
  '/sharing',
  '/mothing',
  '/mothing/:rkey',
  '/welcoming',
  '/guestbook',
  '/participants',
  '/admin',
  '/exploring',
  '/exploring/:repo',
  '/exploring/:repo/:collection',
  '/exploring/:repo/:collection/:rkey',
  '/oauth/callback',
];

// App.jsx generates a record route for every verb and every one of its
// lexicons (generatedRecordRoutes). A param matches any segment, so one
// pattern per verb or NSID covers them all.
const RECORD_ROUTES = VERB_REGISTRY.flatMap((v) => [
  `/${v.verb}/:rkey`,
  ...v.collections.map((c) => `/${c.nsid}/:rkey`),
]);

/**
 * Prefixes that a route pattern happens to match but that are not pages.
 * `/creating/ratioed/participant` matches `/creating/:slug/:piece`, which
 * answers "no such piece": `participant` only exists as the first half of
 * `/participant/:handle`.
 */
const NOT_PAGES = ['/creating/:slug/participant'];

const PATTERNS = [...DECLARED_ROUTES, ...RECORD_ROUTES].map(split);

function split(path) {
  return path.split('/').filter(Boolean);
}

function matches(parts, pattern) {
  if (parts.length !== pattern.length) return false;
  return pattern.every((seg, i) => seg.startsWith(':') || seg === parts[i]);
}

/** Does a route in App.jsx render a page (not the 404) at this path? */
export function isDeclaredRoute(path) {
  const parts = split(path);
  if (NOT_PAGES.some((p) => matches(parts, split(p)))) return false;
  return PATTERNS.some((p) => matches(parts, p));
}

/** Where a crumb for `path` (a strict prefix of the current page) leads, or
 *  null when nothing there is worth a link. */
function crumbTarget(path, parts) {
  if (isDeclaredRoute(path)) return path;
  if (parts.length !== 1) return null;
  const verb = verbConfig(parts[0])?.verb || nsidConfig(parts[0])?.verb.verb;
  if (!verb) return null;
  if (isDeclaredRoute(`/${verb}`)) return `/${verb}`;
  return `/?verbs=${encodeURIComponent(verb)}`;
}

/**
 * Split a pathname into breadcrumb crumbs, each `{ label, path, to }`. `path`
 * is the cumulative path up to and including that segment, unique per crumb;
 * `to` is where the crumb links, or null for one drawn as plain text. The last
 * crumb is the current page and never links. The home root (`/`) is rendered
 * separately as the leading slash, so this returns an empty array on the home
 * page. Segments are URL-decoded for display.
 */
export function buildCrumbs(pathname) {
  const parts = split(pathname);
  return parts.map((p, i) => {
    let label = p;
    try {
      label = decodeURIComponent(p);
    } catch {
      // A malformed escape shows as typed.
    }
    const own = parts.slice(0, i + 1);
    const path = `/${own.join('/')}`;
    const last = i === parts.length - 1;
    return { label, path, to: last ? null : crumbTarget(path, own) };
  });
}

/** The Back button's destination on a visit with no in-app history to walk
 *  back through: the nearest crumb above the current page that links, else
 *  home. */
export function parentPathFor(crumbs) {
  for (let i = crumbs.length - 2; i >= 0; i -= 1) {
    if (crumbs[i].to) return crumbs[i].to;
  }
  return '/';
}
