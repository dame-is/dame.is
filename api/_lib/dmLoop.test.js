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

import { ackFor } from './dmLoop.js';

describe('the acknowledgement', () => {
  it('says what it is about to do, not just that it heard', () => {
    // A harvest or a model call is 5-20s of silence, which reads as broken
    // rather than busy. "Acknowledged" alone would be a second message that
    // adds nothing.
    expect(ackFor({ action: 'plan' })).toMatch(/harvesting and scoring/);
    expect(ackFor({ action: 'approve' })).toMatch(/writing to the list/);
    expect(ackFor({ action: 'review' })).toMatch(/need a look/);
    expect(ackFor(null)).toMatch(/thinking/);
  });

  it('always acknowledges', () => {
    for (const cmd of [null, { action: 'plan' }, { action: 'list_add' }]) {
      expect(ackFor(cmd)).toMatch(/^Acknowledged/);
    }
  });
});
