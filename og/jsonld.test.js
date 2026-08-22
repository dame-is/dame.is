import { describe, it, expect } from 'vitest';
import { pageJsonLd, jsonLdScript } from './jsonld.js';
import { ME_DID, ME_HANDLE } from '../src/config.js';

const HOME = {
  canonical: 'https://dame.is/',
  title: 'dame.is',
  desc: 'An atmospheric personal website.',
};

const nodeOfType = (graph, type) => graph['@graph'].find((n) => n['@type'] === type);

describe('pageJsonLd', () => {
  it('is a schema.org graph of Person, WebSite and the page', () => {
    const g = pageJsonLd(HOME);
    expect(g['@context']).toBe('https://schema.org');
    expect(g['@graph'].map((n) => n['@type'])).toEqual(['Person', 'WebSite', 'WebPage']);
  });

  it('identifies the person by handle and by DID', () => {
    const person = nodeOfType(pageJsonLd(HOME), 'Person');
    expect(person.name).toBe('dame');
    expect(person.alternateName).toBe(ME_HANDLE);
    expect(person.identifier).toBe(ME_DID);
    expect(person.url).toBe('https://dame.is/');
  });

  it('lists only profiles derived from config, so none can be wrong', () => {
    const person = nodeOfType(pageJsonLd(HOME), 'Person');
    expect(person.sameAs).toContain(`https://bsky.app/profile/${ME_HANDLE}`);
    expect(person.sameAs).toContain('https://github.com/dame-is');
    expect(person.sameAs).toContain('https://www.inaturalist.org/people/anisota');
    expect(person.sameAs).toContain('https://www.are.na/dame');
    for (const url of person.sameAs) expect(url.startsWith('https://')).toBe(true);
  });

  it('cross-references its nodes by @id rather than repeating them', () => {
    const g = pageJsonLd(HOME);
    const person = nodeOfType(g, 'Person');
    const site = nodeOfType(g, 'WebSite');
    const page = nodeOfType(g, 'WebPage');
    expect(site.author['@id']).toBe(person['@id']);
    expect(page.isPartOf['@id']).toBe(site['@id']);
    expect(page.author['@id']).toBe(person['@id']);
  });

  it('anchors the page node at its canonical URL', () => {
    const page = nodeOfType(pageJsonLd({ ...HOME, canonical: 'https://dame.is/blogging' }), 'WebPage');
    expect(page['@id']).toBe('https://dame.is/blogging');
    expect(page.url).toBe('https://dame.is/blogging');
  });

  it('renders a blog post as a dated BlogPosting', () => {
    const g = pageJsonLd({
      canonical: 'https://dame.is/blogging/a-post',
      title: 'A post — dame.is',
      heading: 'A post',
      desc: 'About something.',
      isArticle: true,
      date: '2026-04-01',
      image: 'https://dame.is/api/og?section=blogging',
    });
    const post = nodeOfType(g, 'BlogPosting');
    expect(post.headline).toBe('A post');
    expect(post.datePublished).toBe('2026-04-01');
    expect(post.dateModified).toBe('2026-04-01');
    expect(post.publisher['@id']).toBe('https://dame.is/#person');
    expect(post.image).toBe('https://dame.is/api/og?section=blogging');
  });

  it('omits a date it was not given rather than inventing one', () => {
    const page = nodeOfType(pageJsonLd(HOME), 'WebPage');
    expect(page.datePublished).toBeUndefined();
    expect(page.dateModified).toBeUndefined();
  });

  it('describes a person, never an organization with an address', () => {
    const json = JSON.stringify(pageJsonLd(HOME));
    expect(json).not.toContain('PostalAddress');
    expect(json).not.toContain('"Organization"');
  });
});

describe('jsonLdScript', () => {
  it('emits a parseable application/ld+json block', () => {
    const tag = jsonLdScript(pageJsonLd(HOME));
    expect(tag.startsWith('<script type="application/ld+json">')).toBe(true);
    const body = tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(body)['@context']).toBe('https://schema.org');
  });

  it('cannot be closed early by text inside the data', () => {
    const tag = jsonLdScript(pageJsonLd({ ...HOME, desc: 'ends here </script><img src=x>' }));
    expect(tag.match(/<\/script>/g)).toHaveLength(1);
    const body = tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    // The escape is a JSON string escape, so the text round-trips intact.
    expect(JSON.parse(body)['@graph'][2].description).toBe('ends here </script><img src=x>');
  });
});
