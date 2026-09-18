import { describe, it, expect } from 'vitest';
import { adminUrl, planLink, whyLink, ownLinkFacets } from './links.js';

describe('admin links', () => {
  it('always names the moderation view', () => {
    expect(adminUrl()).toBe('https://dame.is/admin?view=moderation');
  });

  it('carries a plan and the filter the message was about', () => {
    const url = planLink('6fa2491d', { label: 'hostile', state: 'pending' });
    expect(url).toContain('view=moderation');
    expect(url).toContain('tab=plans');
    expect(url).toContain('code=6fa2491d');
    expect(url).toContain('label=hostile');
    expect(url).toContain('state=pending');
  });

  it('leaves out what was not asked for', () => {
    const url = planLink('6fa2491d');
    expect(url).not.toContain('label=');
    expect(url).not.toContain('band=');
  });

  it('strips the @ a handle is usually written with', () => {
    expect(whyLink('@a.bsky.social')).toContain('actor=a.bsky.social');
  });
});

describe('link facets', () => {
  const uri = 'https://dame.is/admin?view=moderation&tab=plans&code=abc12345';

  it('finds our own link and ranges it', () => {
    const text = `Read them: ${uri}`;
    const [facet] = ownLinkFacets(text);
    expect(facet.features[0].uri).toBe(uri);
    expect(facet.index.byteStart).toBe(11);
    expect(facet.index.byteEnd).toBe(11 + uri.length);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // atproto ranges are byte offsets. An emoji or an accented handle earlier
    // in the message shifts every offset after it, and a facet that is off by
    // three bytes underlines the wrong text.
    const text = `🔥 ${uri}`;
    const [facet] = ownLinkFacets(text);
    // The emoji is four bytes, plus one space.
    expect(facet.index.byteStart).toBe(5);
    expect(facet.index.byteEnd - facet.index.byteStart).toBe(uri.length);
  });

  it('ignores links this codebase did not build', () => {
    // The analyst quotes bios and post text. A general linkifier would
    // eventually hand-render a stranger's URL as tappable inside a moderation
    // report about them.
    expect(ownLinkFacets('see https://example.com/evil')).toEqual([]);
    expect(ownLinkFacets('https://dame.is/about')).toEqual([]);
    expect(ownLinkFacets('http://dame.is/admin?view=moderation')).toEqual([]);
  });

  it('finds several in one message', () => {
    expect(ownLinkFacets(`a ${uri} b ${uri}`)).toHaveLength(2);
  });

  it('is empty for a message with no links', () => {
    expect(ownLinkFacets('Added 3 to the list.')).toEqual([]);
    expect(ownLinkFacets('')).toEqual([]);
    expect(ownLinkFacets(null)).toEqual([]);
  });
});
