// Invariants for the analytics derivations. The charts are only as honest as
// these: dense buckets (a quiet week must draw as a quiet week), local-time
// bucketing, comparisons that refuse to invent a percentage over zero, and
// archive shapers that never let somebody else's repost into the post archive.
//
// Times in these tests are built with the LOCAL Date constructor on purpose —
// bucketing is local by design (see analytics.js), so a test pinned to a UTC
// string would pass or fail depending on the timezone the suite runs in.

import { describe, it, expect } from 'vitest';
import {
  ANALYTICS_PERIODS,
  ENGAGEMENT_KINDS,
  EVENT_KINDS,
  bucketSeries,
  bucketStartMs,
  comparePeriods,
  compactPostFromFeedItem,
  cumulativeSeries,
  defaultUnitFor,
  didFromAtUri,
  engagementOf,
  fmtCompact,
  fmtDelta,
  inboundFromNotification,
  movingAverage,
  nextBucketMs,
  oldestEventMs,
  outboundFromPosts,
  outboundFromRecord,
  topActors,
  topPosts,
  unitChoicesFor,
} from './analytics.js';

/** Local-time helper: June 2026 sits away from month and DST boundaries. */
const at = (day, hour = 12) => new Date(2026, 5, day, hour).getTime();

describe('buckets', () => {
  it('starts a day bucket at local midnight', () => {
    expect(bucketStartMs(at(10, 23), 'day')).toBe(new Date(2026, 5, 10).getTime());
  });

  it('starts weeks on Monday', () => {
    // 2026-06-10 is a Wednesday; its week began Monday the 8th.
    expect(bucketStartMs(at(10), 'week')).toBe(new Date(2026, 5, 8).getTime());
    // A Monday is its own week start; a Sunday belongs to the PREVIOUS Monday.
    expect(bucketStartMs(at(8), 'week')).toBe(new Date(2026, 5, 8).getTime());
    expect(bucketStartMs(at(7), 'week')).toBe(new Date(2026, 5, 1).getTime());
  });

  it('starts months on the 1st and steps by calendar, not by 30 days', () => {
    expect(bucketStartMs(at(30), 'month')).toBe(new Date(2026, 5, 1).getTime());
    expect(nextBucketMs(at(10), 'month')).toBe(new Date(2026, 6, 1).getTime());
    // January → February is 31 days; a fixed-width step would drift.
    expect(nextBucketMs(new Date(2026, 0, 15).getTime(), 'month')).toBe(new Date(2026, 1, 1).getTime());
  });

  it('returns NaN rather than a wrong bucket for garbage', () => {
    expect(Number.isNaN(bucketStartMs('not a date', 'day'))).toBe(true);
  });
});

describe('bucketSeries', () => {
  const items = [{ at: at(10) }, { at: at(10, 18) }, { at: at(12) }];

  it('zero-fills every bucket between t0 and t1 — density is the contract', () => {
    const series = bucketSeries(items, { unit: 'day', t0: at(9), t1: at(13) });
    expect(series.map((p) => p.v)).toEqual([0, 2, 0, 1, 0]);
    expect(series[0].t).toBe(new Date(2026, 5, 9).getTime());
  });

  it('drops items outside the window instead of clamping them into it', () => {
    const series = bucketSeries([{ at: at(1) }, { at: at(10) }], { unit: 'day', t0: at(9), t1: at(11) });
    expect(series.reduce((s, p) => s + p.v, 0)).toBe(1);
  });

  it('sums a pickValue measure, not just a count', () => {
    const posts = [
      { at: at(10), likes: 3 },
      { at: at(10), likes: 4 },
    ];
    const series = bucketSeries(posts, {
      unit: 'day',
      t0: at(10),
      t1: at(10),
      pickValue: (p) => p.likes,
    });
    expect(series).toEqual([{ t: new Date(2026, 5, 10).getTime(), v: 7 }]);
  });

  it('answers an empty window and an inverted one with []', () => {
    expect(bucketSeries(items, { unit: 'day', t0: at(13), t1: at(9) })).toEqual([]);
    expect(bucketSeries(items, { unit: 'day', t0: NaN, t1: at(9) })).toEqual([]);
  });
});

describe('growth math', () => {
  it('climbs from the baseline, not from zero', () => {
    const counts = [
      { t: 1, v: 2 },
      { t: 2, v: 0 },
      { t: 3, v: 3 },
    ];
    expect(cumulativeSeries(counts, 100).map((p) => p.v)).toEqual([102, 102, 105]);
  });

  it('averages with a window that shrinks at the edges instead of zero-padding', () => {
    const series = [4, 4, 4, 4].map((v, i) => ({ t: i, v }));
    // Zero-padding would dip the first and last points below 4.
    expect(movingAverage(series, 3).map((p) => p.v)).toEqual([4, 4, 4, 4]);
    expect(movingAverage([], 7)).toEqual([]);
  });

  it('compares a period against the one immediately before it', () => {
    const now = at(20);
    const items = [
      { at: at(19) }, // current 7d
      { at: at(18) }, // current 7d
      { at: at(12) }, // previous 7d
      { at: at(1) }, // outside both
    ];
    const cmp = comparePeriods(items, { days: 7, now });
    expect(cmp).toEqual({ current: 2, previous: 1, delta: 1, pct: 100 });
  });

  it('refuses to invent a percentage over zero', () => {
    const cmp = comparePeriods([{ at: at(19) }], { days: 7, now: at(20) });
    expect(cmp.pct).toBeNull();
    expect(fmtDelta(cmp.pct)).toBe('new');
  });
});

describe('ranked lists', () => {
  it('ranks posts by the chosen kind and breaks ties newest-first', () => {
    const posts = [
      { uri: 'a', at: new Date(at(10)).toISOString(), likes: 5, reposts: 0, replies: 9, quotes: 0 },
      { uri: 'b', at: new Date(at(11)).toISOString(), likes: 5, reposts: 0, replies: 1, quotes: 0 },
      { uri: 'c', at: new Date(at(12)).toISOString(), likes: 1, reposts: 0, replies: 0, quotes: 0 },
    ];
    expect(topPosts(posts, { kind: 'like', limit: 2 }).map((p) => p.uri)).toEqual(['b', 'a']);
    expect(topPosts(posts, { kind: 'reply', limit: 1 })[0].uri).toBe('a');
    expect(topPosts(posts, { kind: 'all', t0: at(12), limit: 5 }).map((p) => p.uri)).toEqual(['c']);
  });

  it('ranks actors, filters by kind, and never ranks the owner', () => {
    const events = [
      { uri: '1', did: 'did:plc:ana', kind: 'like', at: at(10) },
      { uri: '2', did: 'did:plc:ana', kind: 'reply', at: at(11) },
      { uri: '3', did: 'did:plc:bo', kind: 'like', at: at(11) },
      { uri: '4', did: 'did:plc:me', kind: 'like', at: at(11) },
      { uri: '5', did: 'did:plc:old', kind: 'like', at: at(1) },
    ];
    const top = topActors(events, { t0: at(9), t1: at(12), excludeDid: 'did:plc:me' });
    expect(top.map((r) => r.did)).toEqual(['did:plc:ana', 'did:plc:bo']);
    expect(top[0].byKind).toEqual({ like: 1, reply: 1 });
    const likesOnly = topActors(events, { kind: 'like', t0: at(9), t1: at(12) });
    expect(likesOnly.find((r) => r.did === 'did:plc:ana').total).toBe(1);
  });
});

describe('compactPostFromFeedItem', () => {
  const base = {
    post: {
      uri: 'at://did:plc:me/app.bsky.feed.post/3abc',
      likeCount: 2,
      repostCount: 1,
      replyCount: 0,
      quoteCount: 4,
      record: { text: 'hello atmosphere', createdAt: '2026-06-10T12:00:00.000Z' },
    },
  };

  it('keeps the counts, the rkey and a snippet', () => {
    const row = compactPostFromFeedItem(base);
    expect(row).toMatchObject({
      uri: base.post.uri,
      rkey: '3abc',
      likes: 2,
      reposts: 1,
      replies: 0,
      quotes: 4,
      text: 'hello atmosphere',
      replyTo: null,
      quoteOf: null,
      hasMedia: false,
    });
  });

  it("refuses somebody else's post arriving as a repost", () => {
    expect(compactPostFromFeedItem({ ...base, reason: { $type: 'app.bsky.feed.defs#reasonRepost' } })).toBeNull();
  });

  it('reads the reply target and both quote-embed shapes', () => {
    const reply = compactPostFromFeedItem({
      post: {
        ...base.post,
        record: { ...base.post.record, reply: { parent: { uri: 'at://did:plc:parent/app.bsky.feed.post/1' } } },
      },
    });
    expect(reply.replyTo).toBe('did:plc:parent');

    const quote = compactPostFromFeedItem({
      post: {
        ...base.post,
        record: {
          ...base.post.record,
          embed: { $type: 'app.bsky.embed.record', record: { uri: 'at://did:plc:quoted/app.bsky.feed.post/2' } },
        },
      },
    });
    expect(quote.quoteOf).toBe('did:plc:quoted');

    const quoteWithMedia = compactPostFromFeedItem({
      post: {
        ...base.post,
        record: {
          ...base.post.record,
          embed: {
            $type: 'app.bsky.embed.recordWithMedia',
            record: { record: { uri: 'at://did:plc:quoted/app.bsky.feed.post/3' } },
            media: { $type: 'app.bsky.embed.images' },
          },
        },
      },
    });
    expect(quoteWithMedia.quoteOf).toBe('did:plc:quoted');
    expect(quoteWithMedia.hasMedia).toBe(true);
  });

  it('drops a post it cannot date', () => {
    expect(
      compactPostFromFeedItem({ post: { ...base.post, record: { text: 'x' } } }),
    ).toBeNull();
  });

  it('truncates the snippet', () => {
    const row = compactPostFromFeedItem({
      post: { ...base.post, record: { ...base.post.record, text: 'y'.repeat(500) } },
    });
    expect(row.text).toHaveLength(200);
  });
});

describe('event shapers', () => {
  it('keeps the five inbound engagement reasons and drops the rest', () => {
    const n = (reason) => ({
      uri: `at://did:plc:them/x/${reason}`,
      reason,
      author: { did: 'did:plc:them' },
      indexedAt: '2026-06-10T12:00:00.000Z',
    });
    for (const reason of ['like', 'repost', 'reply', 'quote', 'mention']) {
      expect(inboundFromNotification(n(reason))).toMatchObject({ did: 'did:plc:them', kind: reason });
    }
    expect(inboundFromNotification(n('follow'))).toBeNull();
    expect(inboundFromNotification(n('starterpack-joined'))).toBeNull();
  });

  it('prefers the record createdAt over indexedAt for the event time', () => {
    const ev = inboundFromNotification({
      uri: 'at://did:plc:them/app.bsky.feed.like/1',
      reason: 'like',
      author: { did: 'did:plc:them' },
      record: { createdAt: '2026-06-09T00:00:00.000Z' },
      indexedAt: '2026-06-10T12:00:00.000Z',
    });
    expect(ev.at).toBe('2026-06-09T00:00:00.000Z');
  });

  it('aims an outbound like at the DID behind the liked post', () => {
    const ev = outboundFromRecord('like', {
      uri: 'at://did:plc:me/app.bsky.feed.like/3abc',
      value: { subject: { uri: 'at://did:plc:them/app.bsky.feed.post/9' }, createdAt: '2026-06-10T12:00:00.000Z' },
    });
    expect(ev).toMatchObject({ kind: 'like', did: 'did:plc:them' });
    expect(outboundFromRecord('like', { uri: 'at://x', value: { createdAt: '2026-06-10T12:00:00.000Z' } })).toBeNull();
  });

  it('derives reply and quote events from the archive — both from one post', () => {
    const events = outboundFromPosts([
      { uri: 'at://me/p/1', at: '2026-06-10T12:00:00.000Z', replyTo: 'did:plc:a', quoteOf: 'did:plc:b' },
      { uri: 'at://me/p/2', at: '2026-06-10T12:00:00.000Z', replyTo: null, quoteOf: null },
    ]);
    expect(events).toHaveLength(2);
    expect(events.map((e) => [e.kind, e.did])).toEqual([
      ['reply', 'did:plc:a'],
      ['quote', 'did:plc:b'],
    ]);
    // Distinct keys, so the two acts survive a keyed store together.
    expect(new Set(events.map((e) => e.uri)).size).toBe(2);
  });
});

describe('small helpers', () => {
  it('reads a DID out of an at-uri and nothing out of garbage', () => {
    expect(didFromAtUri('at://did:plc:abc/app.bsky.feed.post/1')).toBe('did:plc:abc');
    expect(didFromAtUri('https://bsky.app/x')).toBeNull();
    expect(didFromAtUri(null)).toBeNull();
  });

  it('sums engagement across the four kinds, and only the four', () => {
    const post = { likes: 1, reposts: 2, replies: 3, quotes: 4 };
    expect(engagementOf(post)).toBe(10);
    expect(engagementOf(post, 'repost')).toBe(2);
    expect(engagementOf(post, 'mention')).toBe(0);
    expect(engagementOf(null)).toBe(0);
  });

  it('offers day buckets only while the bars would still be bars', () => {
    expect(unitChoicesFor(7)).toEqual(['day', 'week']);
    expect(unitChoicesFor(90)).toContain('day');
    expect(unitChoicesFor(365)).toEqual(['week', 'month']);
    expect(unitChoicesFor(null)).toEqual(['week', 'month']);
    expect(defaultUnitFor(30)).toBe('day');
    expect(defaultUnitFor(90)).toBe('week');
    expect(defaultUnitFor(null)).toBe('month');
  });

  it('formats tile values exactly while short and compactly past 10k', () => {
    expect(fmtCompact(5935)).toBe('5,935');
    expect(fmtCompact(24736)).toBe('24.7K');
    expect(fmtCompact(10000)).toBe('10K');
    expect(fmtCompact(1_200_000)).toBe('1.2M');
    expect(fmtCompact(null)).toBe('—');
  });

  it('formats deltas with a sign, and "new" for something over nothing', () => {
    expect(fmtDelta(12.4)).toBe('+12%');
    expect(fmtDelta(-3.21)).toBe('−3.2%');
    expect(fmtDelta(0)).toBe('±0%');
    expect(fmtDelta(null)).toBe('new');
  });

  it('finds the oldest event for coverage captions', () => {
    expect(oldestEventMs([{ at: at(10) }, { at: at(3) }])).toBe(at(3));
    expect(oldestEventMs([])).toBeNull();
  });

  it('keeps the filter vocabularies aligned', () => {
    // The People tab renders EVENT_KINDS; everything post-count-based renders
    // ENGAGEMENT_KINDS. The former must extend the latter, never diverge.
    expect(EVENT_KINDS.slice(0, ENGAGEMENT_KINDS.length)).toEqual([...ENGAGEMENT_KINDS]);
    expect(ANALYTICS_PERIODS.at(-1).days).toBeNull();
  });
});
