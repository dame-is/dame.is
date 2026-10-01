import { describe, it, expect } from 'vitest';
import {
  adminUrl,
  planLink,
  whyLink,
  ownLinkFacets,
  postWebUrl,
  handleInPostUrl,
} from './links.js';

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

describe('the web URL for a post', () => {
  it('turns an at:// post URI into something a person can open', () => {
    expect(postWebUrl('at://did:plc:abc/app.bsky.feed.post/3xyz')).toBe(
      'https://bsky.app/profile/did:plc:abc/post/3xyz',
    );
  });

  it('refuses anything that is not a post', () => {
    // A broken link in an audit log is worse than no link: it looks like the
    // record is gone when the truth is we built the URL wrong.
    expect(postWebUrl('at://did:plc:abc/app.bsky.graph.list/3xyz')).toBe(null);
    expect(postWebUrl('https://bsky.app/profile/x/post/y')).toBe(null);
    expect(postWebUrl('')).toBe(null);
    expect(postWebUrl(null)).toBe(null);
  });
});

describe('post links in a digest', () => {
  const uri = 'at://did:plc:abc/app.bsky.feed.post/3xyz';

  it('names the account when it can, so a link says whose post it is', () => {
    expect(postWebUrl(uri, { handle: 'chadtmiller.com' })).toBe(
      'https://bsky.app/profile/chadtmiller.com/post/3xyz',
    );
    expect(handleInPostUrl(postWebUrl(uri, { handle: 'a.test' }))).toBe(
      'a.test',
    );
  });

  it('falls back to the DID rather than rendering a handle it cannot trust', () => {
    // Constrained to the DNS shape a handle actually is: nothing that could
    // carry a path separator or a query gets rendered into a URL this account
    // then marks as tappable.
    for (const bad of ['../../evil', 'a/b', 'no-dot', '', null, 'x?y.com']) {
      expect(postWebUrl(uri, { handle: bad })).toBe(
        'https://bsky.app/profile/did:plc:abc/post/3xyz',
      );
    }
  });
});

describe('the facet allowlist', () => {
  const ours = 'https://bsky.app/profile/a.test/post/3aaa';
  const theirs = 'https://bsky.app/profile/evil.test/post/3zzz';

  it('facets a post link only when the caller built it', () => {
    // A bsky.app URL this codebase built is indistinguishable by shape from
    // one the analyst copied out of a stranger's post, so the caller passes
    // the exact set and nothing else matches.
    const text = `see ${ours} and ${theirs}`;
    const facets = ownLinkFacets(text, { allow: [ours] });
    expect(facets).toHaveLength(1);
    expect(facets[0].features[0].uri).toBe(ours);
  });

  it('still facets our own admin links, with no allowlist at all', () => {
    const facets = ownLinkFacets(`open ${adminUrl({ tab: 'plans' })}`);
    expect(facets).toHaveLength(1);
    expect(facets[0].features[0].uri).toContain('dame.is/admin?');
  });

  it('returns ranges in order and never overlapping', () => {
    // Two passes over one string produce facets out of order, and a range that
    // overlaps another is a record the server is entitled to reject.
    const text = `${ours} then ${adminUrl({ tab: 'list' })} then ${ours}`;
    const facets = ownLinkFacets(text, { allow: [ours] });
    for (let i = 1; i < facets.length; i += 1) {
      expect(facets[i].index.byteStart).toBeGreaterThanOrEqual(
        facets[i - 1].index.byteEnd,
      );
    }
  });

  it('counts offsets in utf-8 bytes, not js indices', () => {
    const text = `🏳️‍⚧️ ${ours}`;
    const [facet] = ownLinkFacets(text, { allow: [ours] });
    const bytes = new TextEncoder().encode(text);
    expect(
      new TextDecoder().decode(
        bytes.slice(facet.index.byteStart, facet.index.byteEnd),
      ),
    ).toBe(ours);
  });
});
