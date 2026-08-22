import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROUTE_PATTERNS,
  STATIC_ROUTE_PATTERNS,
  generatedRoutePatterns,
  matchRoute,
  isKnownRoute,
  isStaticPath,
  isRedirectSource,
  REDIRECT_SOURCES,
} from './routes.js';
import { VERB_REGISTRY } from '../src/lib/verbRegistry.js';

const APP_JSX = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'),
  'utf-8',
);

/**
 * The routes App.jsx declares as string literals — `path="/themself"` — plus
 * the ones it maps over an array of literals (the /exploring block). Template
 * literals (`path={`/${v.verb}/:rkey`}`) are the generated ones and are checked
 * separately against the verb registry.
 */
function declaredRoutesInApp() {
  const found = new Set();
  for (const m of APP_JSX.matchAll(/<Route[^>]*?\spath="([^"]+)"/gs)) found.add(m[1]);
  // The /exploring routes are declared as an array of literals and mapped into
  // <Route path={path}>, so they carry no path="…" of their own.
  const block = APP_JSX.match(/\[((?:\s*'\/exploring[^']*',?)+)\s*\]\.map/);
  if (block) for (const m of block[1].matchAll(/'([^']+)'/g)) found.add(m[1]);
  found.delete('*'); // the catch-all is NotFound, not a route shape we serve
  return found;
}

describe('route table stays in sync with src/App.jsx', () => {
  it('lists every route App.jsx declares, and no others', () => {
    expect(new Set(STATIC_ROUTE_PATTERNS)).toEqual(declaredRoutesInApp());
  });

  it('declares each route exactly once', () => {
    expect(ROUTE_PATTERNS.length).toBe(new Set(ROUTE_PATTERNS).size);
  });

  it('uses the same bespoke-verb exclusions as App.jsx', () => {
    const inApp = APP_JSX.match(/BESPOKE_VERB_ROUTES = new Set\(\[([^\]]*)\]\)/);
    expect(inApp).toBeTruthy();
    const verbs = [...inApp[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    // Every bespoke verb must have a hand-written route in the table, and must
    // NOT appear among the generated ones.
    const generated = generatedRoutePatterns();
    for (const verb of verbs) {
      expect(STATIC_ROUTE_PATTERNS).toContain(`/${verb}`);
      expect(generated).not.toContain(`/${verb}/:rkey`);
    }
  });

  it('generates a route for every verb and every NSID in the registry', () => {
    const generated = new Set(generatedRoutePatterns());
    for (const v of VERB_REGISTRY) {
      for (const c of v.collections) expect(generated).toContain(`/${c.nsid}/:rkey`);
    }
  });
});

describe('matchRoute', () => {
  it('matches the site’s top-level surfaces', () => {
    for (const p of ['/', '/themself', '/blogging', '/creating', '/mothing', '/welcoming']) {
      expect(matchRoute(p)).toBe(p);
    }
  });

  it('matches parameterised leaves', () => {
    expect(matchRoute('/blogging/some-post')).toBe('/blogging/:slug');
    expect(matchRoute('/mothing/2026-04-24')).toBe('/mothing/:rkey');
    expect(matchRoute('/curating/red-blue-yellow')).toBe('/curating/:slug');
  });

  it('prefers a literal segment over a parameter at the same position', () => {
    // Both /creating/:slug/:piece and /creating/:slug/participants have three
    // segments; the roster must win, or a take numbered 01 could shadow it.
    expect(matchRoute('/creating/ratioed/participants')).toBe('/creating/:slug/participants');
    expect(matchRoute('/creating/ratioed/14')).toBe('/creating/:slug/:piece');
    expect(matchRoute('/creating/ratioed/participant/dame.is')).toBe(
      '/creating/:slug/participant/:handle',
    );
  });

  it('matches the generated record routes', () => {
    expect(matchRoute('/is.dame.now/3abc')).toBe('/is.dame.now/:rkey');
    expect(matchRoute('/app.bsky.feed.post/3xyz')).toBe('/app.bsky.feed.post/:rkey');
  });

  it('returns null for paths no route answers to', () => {
    for (const p of [
      '/does-not-exist',
      '/pricing',
      '/blogging/some-post/extra',
      '/api/v2/users',
      '/themself/nested',
      '/creating/a/b/c/d',
    ]) {
      expect(matchRoute(p)).toBeNull();
    }
  });

  it('treats a trailing-slash path as its own shape', () => {
    // vercel.json sets trailingSlash:false, so '/blogging/' never reaches the
    // route table with an empty final segment — filtering empties makes the two
    // forms equivalent here.
    expect(isKnownRoute('/blogging/')).toBe(true);
  });
});

describe('isStaticPath', () => {
  it('recognises generated and build-output files', () => {
    for (const p of [
      '/robots.txt',
      '/sitemap.xml',
      '/feed.xml',
      '/llms.txt',
      '/version.json',
      '/oauth-client-metadata.json',
    ]) {
      expect(isStaticPath(p)).toBe(true);
    }
  });

  it('recognises the served prefixes', () => {
    for (const p of [
      '/api/og',
      '/assets/index-abc123.js',
      '/data/blogging.json',
      '/_vercel/insights/script.js',
      '/.well-known/site.standard.publication/blogging',
    ]) {
      expect(isStaticPath(p)).toBe(true);
    }
  });

  it('does not claim SPA routes', () => {
    for (const p of ['/', '/blogging', '/creating/ratioed/14', '/does-not-exist']) {
      expect(isStaticPath(p)).toBe(false);
    }
  });
});

describe('isRedirectSource stays in sync with vercel.json', () => {
  const vercel = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../vercel.json'), 'utf-8'),
  );

  it('lists every redirect source declared in vercel.json', () => {
    const declared = vercel.redirects
      .map((r) => r.source.replace(/\/:path\*$/, '/*'))
      .sort();
    expect([...REDIRECT_SOURCES].sort()).toEqual(declared);
  });

  it('matches each redirect source, and the paths beneath a wildcard', () => {
    for (const r of vercel.redirects) {
      const literal = r.source.replace(/\/:path\*$/, '/anything/deeper');
      expect(isRedirectSource(literal)).toBe(true);
    }
  });

  it('does not claim live routes that merely share a prefix', () => {
    // /blogging must not be swallowed by the /blog redirect, and /logging must
    // not be swallowed by /log — both are exact-match sources, not wildcards.
    for (const p of ['/blogging', '/blogging/a-post', '/logging', '/available', '/']) {
      expect(isRedirectSource(p)).toBe(false);
    }
  });
});
