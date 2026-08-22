// The set of URL shapes this site actually answers to.
//
// dame.is is a client-rendered SPA behind a catch-all rewrite, so until this
// module existed EVERY path returned HTTP 200 with the app shell — a soft 404.
// A crawler probing /pricing, /api/v2/users or /does-not-exist was told all
// three exist, and an agent had no way to learn otherwise short of running our
// JavaScript and reading the rendered page.
//
// `middleware.js` uses the table below to answer honestly: a path whose SHAPE
// matches no route gets a real 404 before the rewrite ever fires. Shape, not
// existence — `/blogging/:slug` matches any slug, so a nonexistent post is
// still a 200 here and is caught one layer up (middleware resolves the record
// and 404s when nothing comes back).
//
// The table mirrors the <Route> declarations in src/App.jsx. That duplication
// is load-bearing — the router's routes are React elements and can't be read at
// the edge — so routes.test.js parses App.jsx and fails the build if the two
// ever drift.

import { VERB_REGISTRY } from '../src/lib/verbRegistry.js';

/**
 * Verbs whose short `/{verb}/:rkey` route is hand-written in App.jsx rather
 * than generated, so `generatedRoutePatterns()` must not emit it a second time.
 * Keep in sync with BESPOKE_VERB_ROUTES in src/App.jsx.
 */
const BESPOKE_VERB_ROUTES = new Set(['blogging', 'creating', 'mothing']);

/** Route shapes declared by hand in src/App.jsx, in the order they appear. */
export const STATIC_ROUTE_PATTERNS = [
  '/',
  '/themself',
  '/posting',
  '/logging',
  '/listening',
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

/**
 * The `/{verb}/:rkey` and `/{nsid}/:rkey` routes App.jsx generates from the
 * verb registry. Mirrors generatedRecordRoutes() there.
 */
export function generatedRoutePatterns() {
  const out = [];
  for (const v of VERB_REGISTRY) {
    if (!BESPOKE_VERB_ROUTES.has(v.verb)) out.push(`/${v.verb}/:rkey`);
    for (const c of v.collections) out.push(`/${c.nsid}/:rkey`);
  }
  return out;
}

/** Every route shape the SPA answers to, hand-written and generated alike. */
export const ROUTE_PATTERNS = [...STATIC_ROUTE_PATTERNS, ...generatedRoutePatterns()];

const PATTERN_SEGMENTS = ROUTE_PATTERNS.map((p) => ({
  pattern: p,
  segs: p.split('/').filter(Boolean),
}));

/**
 * Paths served by something other than the SPA: build output, generated
 * discovery files, and the serverless functions. Middleware must fall through
 * for these rather than judge them against the route table — they are real
 * files and would otherwise 404.
 *
 * Prefixes are also excluded by the middleware matcher; this list is the second
 * net, so a matcher edit can never accidentally 404 a live asset.
 */
const STATIC_PREFIXES = ['/api/', '/assets/', '/data/', '/_vercel/', '/.well-known/'];
const STATIC_FILES = new Set([
  '/robots.txt',
  '/sitemap.xml',
  '/feed.xml',
  '/llms.txt',
  '/version.json',
  '/oauth-client-metadata.json',
  '/index.html',
  '/favicon.ico',
]);

/** True when the path is served from the filesystem or a function, not the SPA. */
export function isStaticPath(pathname) {
  const p = String(pathname || '');
  if (STATIC_FILES.has(p)) return true;
  return STATIC_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * Paths vercel.json answers with an HTTP redirect, mirrored from its
 * `redirects` array (routes.test.js fails if the two drift).
 *
 * Vercel applies those redirects before middleware, so in practice none of
 * these reach the code below. Listing them anyway is the cheap insurance: if
 * that order ever changes, the alternative is middleware 404ing twenty-one
 * live redirects, because a legacy path like /blog is deliberately absent from
 * the route table above. A `*` suffix matches the path and anything under it,
 * standing in for vercel.json's `:path*`.
 */
export const REDIRECT_SOURCES = [
  '/index',
  '/home',
  '/about',
  '/for-hire',
  '/for-hire/*',
  '/resume',
  '/resume/*',
  '/work',
  '/blog',
  '/blog/*',
  '/writing/blogs',
  '/writing/blogs/*',
  '/posts',
  '/writing/posts',
  '/log',
  '/guestbook',
  '/patrons',
  '/ethos',
  '/skeet-tools',
  '/ratingalttext',
  '/flushing',
];

/** True when vercel.json redirects this path, so middleware must not judge it. */
export function isRedirectSource(pathname) {
  const p = String(pathname || '');
  return REDIRECT_SOURCES.some((src) =>
    src.endsWith('/*') ? p.startsWith(src.slice(0, -1)) : p === src,
  );
}

/**
 * The route shape a path resolves to, or null when nothing matches.
 *
 * Static segments outrank parameters at the same position, mirroring React
 * Router's own ranking — so `/creating/ratioed/participants` resolves to the
 * roster route rather than to `/creating/:slug/:piece`. Only the pattern is
 * returned; nothing here reads or resolves a record.
 */
export function matchRoute(pathname) {
  const path = String(pathname || '/');
  const segs = path.split('/').filter(Boolean);
  let best = null;
  let bestScore = -1;

  for (const { pattern, segs: pSegs } of PATTERN_SEGMENTS) {
    if (pSegs.length !== segs.length) continue;
    let score = 0;
    let ok = true;
    for (let i = 0; i < pSegs.length; i++) {
      if (pSegs[i].startsWith(':')) continue; // parameter: matches any segment
      if (pSegs[i] !== segs[i]) {
        ok = false;
        break;
      }
      score++; // a literal segment is a stronger match than a parameter
    }
    if (ok && score > bestScore) {
      best = pattern;
      bestScore = score;
    }
  }
  return best;
}

/** True when some route shape answers to this path. */
export function isKnownRoute(pathname) {
  return matchRoute(pathname) !== null;
}
