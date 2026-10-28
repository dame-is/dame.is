import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DECLARED_ROUTES,
  buildCrumbs,
  isDeclaredRoute,
  parentPathFor,
} from './breadcrumbs.js';

const APP = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

describe('DECLARED_ROUTES', () => {
  it('lists exactly the paths App.jsx declares', () => {
    const declared = new Set([
      ...[...APP.matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
      ...[...APP.matchAll(/'(\/exploring[^']*)'/g)].map((m) => m[1]),
    ]);
    declared.delete('*');
    expect(new Set(DECLARED_ROUTES)).toEqual(declared);
  });
});

describe('isDeclaredRoute', () => {
  it('knows the section indexes and generated record routes', () => {
    expect(isDeclaredRoute('/posting')).toBe(true);
    expect(isDeclaredRoute('/listening/albums')).toBe(true);
    expect(isDeclaredRoute('/app.bsky.feed.like/3kabc')).toBe(true);
    expect(isDeclaredRoute('/reposting/3kabc')).toBe(true);
  });

  it('rejects prefixes no page answers', () => {
    expect(isDeclaredRoute('/app.bsky.feed.like')).toBe(false);
    expect(isDeclaredRoute('/reposting')).toBe(false);
    expect(isDeclaredRoute('/flushing')).toBe(false);
    expect(isDeclaredRoute('/creating/ratioed/participant')).toBe(false);
  });
});

describe('buildCrumbs', () => {
  const links = (path) => buildCrumbs(path).map((c) => c.to);

  it('is empty on home', () => {
    expect(buildCrumbs('/')).toEqual([]);
  });

  it('keeps the labels, and never links the current page', () => {
    const crumbs = buildCrumbs('/app.bsky.feed.like/3kabc');
    expect(crumbs.map((c) => c.label)).toEqual(['app.bsky.feed.like', '3kabc']);
    expect(crumbs.at(-1).to).toBe(null);
  });

  it('sends a lexicon with no index of its own to the home feed filtered to its verb', () => {
    expect(links('/app.bsky.feed.like/3kabc')).toEqual([
      '/?verbs=liking',
      null,
    ]);
    expect(links('/reposting/3kabc')).toEqual(['/?verbs=reposting', null]);
    expect(links('/flushing/3kabc')).toEqual(['/?verbs=flushing', null]);
  });

  it('sends a lexicon whose verb has an index to that index', () => {
    expect(links('/app.bsky.feed.post/3kabc')).toEqual(['/posting', null]);
    expect(links('/fm.teal.feed.play/3kabc')).toEqual(['/listening', null]);
  });

  it('links the sections that are pages', () => {
    expect(links('/blogging/a-post')).toEqual(['/blogging', null]);
    expect(links('/listening/albums/charm')).toEqual([
      '/listening',
      '/listening/albums',
      null,
    ]);
    expect(links('/exploring/did:plc:x/app.bsky.feed.post/3k')).toEqual([
      '/exploring',
      '/exploring/did:plc:x',
      '/exploring/did:plc:x/app.bsky.feed.post',
      null,
    ]);
  });

  it('draws the participant segment as text, not a link to "no such piece"', () => {
    expect(links('/creating/ratioed/participant/alice.bsky.social')).toEqual([
      '/creating',
      '/creating/ratioed',
      null,
      null,
    ]);
  });

  it('draws a 404 path without links', () => {
    expect(links('/not-a-page/deeper')).toEqual([null, null]);
  });

  it('only ever links to a declared route or the filtered home feed', () => {
    const samples = [
      '/app.bsky.feed.like/x',
      '/reposting/x',
      '/flushing/x',
      '/creating/ratioed/participant/h',
      '/creating/ratioed/participants',
      '/creating/ratioed/07',
      '/blogging/slug',
      '/listening/albums/slug',
      '/curating/slug',
      '/mothing/2026-10-16',
      '/oauth/callback',
    ];
    for (const path of samples) {
      for (const to of links(path)) {
        if (to == null) continue;
        expect(
          to.startsWith('/?verbs=') || isDeclaredRoute(to),
          `${path} → ${to}`,
        ).toBe(true);
      }
    }
  });
});

describe('parentPathFor', () => {
  it('is the nearest linked crumb above the page', () => {
    expect(parentPathFor(buildCrumbs('/blogging/a-post'))).toBe('/blogging');
    expect(parentPathFor(buildCrumbs('/app.bsky.feed.like/x'))).toBe(
      '/?verbs=liking',
    );
    expect(
      parentPathFor(
        buildCrumbs('/creating/ratioed/participant/alice.bsky.social'),
      ),
    ).toBe('/creating/ratioed');
  });

  it('falls back to home', () => {
    expect(parentPathFor(buildCrumbs('/posting'))).toBe('/');
    expect(parentPathFor(buildCrumbs('/not-a-page/deeper'))).toBe('/');
    expect(parentPathFor([])).toBe('/');
  });
});
