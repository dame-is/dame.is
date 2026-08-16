import { describe, it, expect } from 'vitest';
import { classify, createMeter, replayCursor, withinLookback, replayWindow } from './jetstream.js';

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

describe('createMeter', () => {
  it('reports nothing until a full window has passed', () => {
    const m = createMeter();
    // The first call is the baseline: there is no window before it, and a rate
    // over a zero-length one is worse than no rate at all.
    expect(m.mark(0, 0, 0)).toBeNull();
    expect(m.mark(500, 130, 66_000)).toBeNull();
  });

  it('measures the window that actually elapsed, not the one asked for', () => {
    const m = createMeter();
    m.mark(0, 0, 0);
    // 64-message masks don't land on the second, so the sample is divided by
    // the real interval rather than assuming 1000ms.
    expect(m.mark(1250, 325, 208_000)).toEqual({ rate: 260, kbps: 163 });
  });

  it('rebases after a sample, so rates don’t drift toward the average', () => {
    const m = createMeter();
    m.mark(0, 0, 0);
    m.mark(1000, 260, 170_000);
    // The stream halves. The next sample says so rather than splitting the
    // difference with the busy second before it.
    expect(m.mark(2000, 390, 255_000)).toEqual({ rate: 130, kbps: 83 });
  });
});

describe('replayCursor', () => {
  const NOW = 1_786_666_000_000; // ms
  const SEQ = 24_705_551_465;

  // v2 numbers every event, so resuming is exact — the seq is handed straight
  // back with no rewind and therefore no duplicates and no gap.
  it('resumes from the exact sequence after a brief drop', () => {
    expect(replayCursor(SEQ, NOW - 2000, NOW)).toBe(SEQ);
  });

  // The failure this exists for: a laptop sleeps, wakes, and asks Jetstream for
  // an hour of firehose as fast as it will send it — about a gigabyte.
  it('starts live rather than replaying a long gap', () => {
    expect(replayCursor(SEQ, NOW - 60 * 60 * 1000, NOW)).toBeNull();
    expect(replayCursor(SEQ, NOW - 31_000, NOW)).toBeNull();
  });

  it('holds the line right at the bound', () => {
    expect(replayCursor(SEQ, NOW - 29_000, NOW)).toBe(SEQ);
    expect(replayCursor(SEQ, NOW - 30_000, NOW)).toBeNull();
  });

  it('starts live when nothing has been seen yet', () => {
    expect(replayCursor(0, 0, NOW)).toBeNull();
    expect(replayCursor(SEQ, 0, NOW)).toBeNull();
    expect(replayCursor(0, NOW - 1000, NOW)).toBeNull();
  });

  // The decision is made on the clock, so a clock that disagrees with the
  // stream must not be able to request an unbounded replay.
  it('starts live on a timestamp from the future, which clock skew produces', () => {
    expect(replayCursor(SEQ, NOW + 5000, NOW)).toBeNull();
  });
});

describe('withinLookback', () => {
  const NOW = 1_786_666_000_000;
  const hours = (h) => NOW - h * 3600 * 1000;

  it('covers the window the live socket will actually replay', () => {
    expect(withinLookback(hours(1), NOW)).toBe(true);
    expect(withinLookback(hours(35), NOW)).toBe(true);
  });

  // Past this the like that ended a piece is gone for good — which is what
  // happened to six of the first thirteen.
  it('refuses anything older than the lookback', () => {
    expect(withinLookback(hours(36), NOW)).toBe(false);
    expect(withinLookback(hours(24 * 30), NOW)).toBe(false);
  });

  it('refuses the future and the unset', () => {
    expect(withinLookback(NOW + 5000, NOW)).toBe(false);
    expect(withinLookback(0, NOW)).toBe(false);
    expect(withinLookback(null, NOW)).toBe(false);
  });
});

describe('replayWindow guards', () => {
  it('refuses a window it cannot reach rather than opening a socket', async () => {
    const r = await replayWindow('at://did:plc:x/app.bsky.feed.post/abc', {
      fromMs: Date.now() - 40 * 3600 * 1000,
      toMs: Date.now() - 39 * 3600 * 1000,
    });
    expect(r.events).toEqual([]);
    expect(r.reachedEnd).toBe(false);
    expect(r.error).toMatch(/lookback/);
  });

  it('refuses a nonsensical window', async () => {
    const now = Date.now();
    for (const w of [{ fromMs: now, toMs: now - 1000 }, { fromMs: 0, toMs: now }, {}]) {
      const r = await replayWindow('at://did:plc:x/app.bsky.feed.post/abc', w);
      expect(r.error).toBeTruthy();
      expect(r.events).toEqual([]);
    }
  });
});
