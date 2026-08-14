import { describe, it, expect } from 'vitest';
import { classify, replayCursor } from './jetstream.js';

const SUBJECT = 'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/app.bsky.feed.post/3msyb4kntps2e';
const OTHER = 'at://did:plc:someone/app.bsky.feed.post/3zzzzzzzzzz2z';

describe('classify', () => {
  it('reads a like on the piece', () => {
    expect(classify('app.bsky.feed.like', { subject: { uri: SUBJECT } }, SUBJECT)).toBe('like');
  });

  it('reads a repost on the piece', () => {
    expect(classify('app.bsky.feed.repost', { subject: { uri: SUBJECT } }, SUBJECT)).toBe('repost');
  });

  it('reads a reply by its root, so a nested subthread still counts', () => {
    // The same thing `.reply.root.uri` counts in every other reader here: a
    // reply to a reply is engagement with the piece.
    expect(
      classify('app.bsky.feed.post', { reply: { root: { uri: SUBJECT }, parent: { uri: OTHER } } }, SUBJECT),
    ).toBe('reply');
  });

  it('reads a direct reply too', () => {
    expect(
      classify('app.bsky.feed.post', { reply: { root: { uri: OTHER }, parent: { uri: SUBJECT } } }, SUBJECT),
    ).toBe('reply');
  });

  it('reads a quote, including the nested form', () => {
    expect(classify('app.bsky.feed.post', { embed: { record: { uri: SUBJECT } } }, SUBJECT)).toBe('quote');
    // recordWithMedia wraps the ref one level deeper.
    expect(
      classify('app.bsky.feed.post', { embed: { record: { record: { uri: SUBJECT } } } }, SUBJECT),
    ).toBe('quote');
  });

  it('ignores everything pointing somewhere else, which is nearly all of it', () => {
    expect(classify('app.bsky.feed.like', { subject: { uri: OTHER } }, SUBJECT)).toBeNull();
    expect(classify('app.bsky.feed.post', { reply: { root: { uri: OTHER } } }, SUBJECT)).toBeNull();
    expect(classify('app.bsky.feed.post', { text: 'hello' }, SUBJECT)).toBeNull();
    expect(classify('app.bsky.graph.follow', { subject: SUBJECT }, SUBJECT)).toBeNull();
  });

  it('is safe on the junk a public firehose carries', () => {
    expect(classify('app.bsky.feed.like', null, SUBJECT)).toBeNull();
    expect(classify('app.bsky.feed.like', {}, SUBJECT)).toBeNull();
    expect(classify('app.bsky.feed.like', { subject: 'not-an-object' }, SUBJECT)).toBeNull();
    expect(classify('app.bsky.feed.like', { subject: { uri: SUBJECT } }, null)).toBeNull();
  });
});

describe('replayCursor', () => {
  const NOW = 1_786_666_000_000; // ms
  const us = (ms) => ms * 1000;

  it('asks for a second of overlap after a brief drop', () => {
    const cursor = us(NOW - 2000); // saw something 2s ago
    expect(replayCursor(cursor, NOW)).toBe(cursor - 1_000_000);
  });

  // The failure this exists for: a laptop sleeps, wakes, and asks Jetstream for
  // an hour of firehose as fast as it will send it — about a gigabyte.
  it('starts live rather than replaying a long gap', () => {
    expect(replayCursor(us(NOW - 60 * 60 * 1000), NOW)).toBeNull();
    expect(replayCursor(us(NOW - 31_000), NOW)).toBeNull();
  });

  it('holds the line right at the bound', () => {
    expect(replayCursor(us(NOW - 29_000), NOW)).not.toBeNull();
    expect(replayCursor(us(NOW - 30_000), NOW)).toBeNull();
  });

  it('starts live when nothing has been seen yet', () => {
    expect(replayCursor(null, NOW)).toBeNull();
    expect(replayCursor(0, NOW)).toBeNull();
  });

  it('starts live on a cursor from the future, which a clock skew can produce', () => {
    expect(replayCursor(us(NOW + 5000), NOW)).toBeNull();
  });
});
