import { describe, expect, it } from 'vitest';
import { publicRecordPath } from './publicRecordPath.js';
import { ME_DID, PORTFOLIO_PUBLICATION } from '../config.js';

const OTHER_DID = 'did:plc:ragtjsm2j2vknwkz3zp4oxrd';

function path(
  collection,
  rkey,
  value = { createdAt: '2026-01-01T00:00:00Z' },
  extra = {},
) {
  return publicRecordPath({ repo: ME_DID, collection, rkey, value, ...extra });
}

describe('publicRecordPath', () => {
  it('links records on Dame’s repo to the page their verb declares', () => {
    expect(path('app.bsky.feed.post', 'abc')).toBe('/posting/abc');
    expect(path('app.bsky.feed.repost', 'abc')).toBe('/reposting/abc');
    expect(path('is.dame.now', 'abc')).toBe('/logging/abc');
    expect(path('fm.teal.feed.play', 'abc')).toBe('/listening/abc');
    expect(path('is.dame.mothing.observation', '408837728')).toBe(
      '/mothing/408837728',
    );
  });

  it('falls back to the lexicon-form route for verbs without a short one', () => {
    expect(path('app.bsky.feed.like', 'abc')).toBe('/app.bsky.feed.like/abc');
    expect(path('app.bsky.graph.follow', 'abc')).toBe(
      '/app.bsky.graph.follow/abc',
    );
  });

  it('offers nothing for another account’s records', () => {
    expect(
      publicRecordPath({
        repo: OTHER_DID,
        collection: 'app.bsky.feed.post',
        rkey: 'abc',
        value: {},
      }),
    ).toBeNull();
  });

  it('offers nothing for Anisota posts and reposts, which have no page', () => {
    expect(path('net.anisota.feed.post', 'abc')).toBeNull();
    expect(path('net.anisota.feed.repost', 'abc')).toBeNull();
  });

  it('offers nothing for collections the site never renders', () => {
    expect(path('site.standard.publication', 'abc')).toBeNull();
    expect(path('com.example.unknown', 'abc')).toBeNull();
  });

  it('routes documents by publication, and hides drafts', () => {
    expect(path('site.standard.document', 'abc', { title: 'A post' })).toBe(
      '/blogging/abc',
    );
    expect(path('pub.leaflet.document', 'abc', { title: 'A leaflet' })).toBe(
      '/blogging/abc',
    );
    const work = {
      title: 'A work',
      site: PORTFOLIO_PUBLICATION,
      path: '/a-work',
    };
    expect(path('site.standard.document', 'abc', work)).toBe(
      '/creating/a-work',
    );
    expect(
      path('site.standard.document', 'abc', { ...work, draft: true }),
    ).toBeNull();
    expect(
      path('is.dame.creating.work', 'abc', { slug: 'old-work', draft: true }),
    ).toBeNull();
  });

  it('lets the surface break the tie for a document on both feeds', () => {
    const both = { title: 'Both', path: '/both', tags: ['creating'] };
    expect(path('site.standard.document', 'abc', both)).toBe('/blogging/abc');
    expect(
      path('site.standard.document', 'abc', both, { surface: 'creating' }),
    ).toBe('/creating/both');
  });

  it('needs the record value before it will link', () => {
    expect(path('app.bsky.feed.post', 'abc', null)).toBeNull();
    expect(path('app.bsky.feed.post', '', {})).toBeNull();
  });
});
