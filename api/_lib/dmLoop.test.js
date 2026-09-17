import { describe, it, expect } from 'vitest';
import { sharedPostUri, composeMessage } from './dmLoop.js';

describe('a post shared into a DM', () => {
  // Sharing from the Bluesky app puts no link in the text: the post travels in
  // embed.record.uri. Scanning the text found nothing and the analyst answered
  // "no link in your message" about a message with a post attached to it.
  const embed = (uri) => ({ record: { uri, cid: 'bafy' } });

  it('finds the uri in the embed', () => {
    const uri = 'at://did:plc:abc/app.bsky.feed.post/3xyz';
    expect(sharedPostUri({ text: 'check this', embed: embed(uri) })).toBe(uri);
  });

  it('ignores an embed that is not a record', () => {
    expect(sharedPostUri({ text: 'x' })).toBe(null);
    expect(sharedPostUri({ text: 'x', embed: {} })).toBe(null);
    expect(
      sharedPostUri({
        text: 'x',
        embed: { record: { uri: 'https://ex.com' } },
      }),
    ).toBe(null);
    expect(sharedPostUri(null)).toBe(null);
  });

  it('hands the model the text and the shared post together', () => {
    const uri = 'at://did:plc:abc/app.bsky.feed.post/3xyz';
    const out = composeMessage({ text: 'who liked this', embed: embed(uri) });
    expect(out).toContain('who liked this');
    expect(out).toContain(uri);
  });

  it('leaves a plain message alone', () => {
    expect(composeMessage({ text: 'hello' })).toBe('hello');
  });
});

describe('composeMessage with facets', () => {
  it('hands the model the full link, not the truncated text', () => {
    const out = composeMessage({
      text: 'can you add this user to the block list bsky.app/profile/free...',
      facets: [
        {
          features: [
            {
              $type: 'app.bsky.richtext.facet#link',
              uri: 'https://bsky.app/profile/freeuse.toys',
            },
          ],
        },
      ],
    });
    expect(out).toContain('https://bsky.app/profile/freeuse.toys');
  });

  it('does not repeat a link that was already written out in full', () => {
    const url = 'https://bsky.app/profile/a.bsky.social';
    const out = composeMessage({
      text: `check ${url}`,
      facets: [
        { features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }] },
      ],
    });
    expect(out).toBe(`check ${url}`);
  });

  it('surfaces mentioned accounts as DIDs', () => {
    const out = composeMessage({
      text: '@someone',
      facets: [
        {
          features: [
            { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:abc' },
          ],
        },
      ],
    });
    expect(out).toContain('did:plc:abc');
  });
});
