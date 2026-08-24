// Stop-rule invariants for the analytics sweeps. Each sweep is a paginated
// walk whose entire correctness is WHERE IT STOPS: an incremental post sweep
// that stops one page early silently loses posts forever, and one that never
// stops re-downloads a 250-page archive on every visit. These tests pin the
// stopping logic with fake agents and a fake AppView.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sweepFollowers, sweepInbound, sweepOutbound, sweepPosts } from './analyticsSync.js';
import { tidToTimestamp } from './atproto.js';

/** Mint a real TID for a timestamp — the same encoding tidToTimestamp reads. */
const B32 = '234567abcdefghijklmnopqrstuvwxyz';
function tidFor(ms) {
  let n = ((BigInt(Math.floor(ms)) * 1000n) << 10n) | 5n;
  let s = '';
  for (let i = 0; i < 13; i++) {
    s = B32[Number(n & 31n)] + s;
    n >>= 5n;
  }
  return s;
}

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-20T12:00:00.000Z');

function feedItem(uri, atMs) {
  return {
    post: {
      uri,
      likeCount: 1,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
      record: { text: uri, createdAt: new Date(atMs).toISOString() },
    },
  };
}

/** getAuthorFeed fake: fixed pages keyed by cursor (null → page 0). */
function fakeAuthorFeed(pages) {
  return vi.fn(async (url) => {
    const cursor = new URL(url).searchParams.get('cursor');
    const i = cursor ? Number(cursor) : 0;
    const feed = pages[i] || [];
    const body = { feed, cursor: i + 1 < pages.length ? String(i + 1) : undefined };
    return { ok: true, json: async () => body };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sweepPosts', () => {
  it('pages a full build to exhaustion and hands each page over as it lands', async () => {
    const pages = [
      [feedItem('at://me/app.bsky.feed.post/a', NOW - 1 * DAY)],
      [feedItem('at://me/app.bsky.feed.post/b', NOW - 2 * DAY)],
    ];
    vi.stubGlobal('fetch', fakeAuthorFeed(pages));
    const banked = [];
    const res = await sweepPosts({ did: 'did:plc:me', onPage: (rows) => banked.push(...rows) });
    expect(res).toMatchObject({ fetched: 2, complete: true, cursor: null, error: null });
    expect(banked.map((r) => r.rkey)).toEqual(['a', 'b']);
  });

  it('stops an incremental sweep only once a page is all-known AND past the rehydrate window', async () => {
    const recent = NOW - 1 * DAY; // known, but inside the window → counts refresh
    const old = NOW - 40 * DAY; // known and old → the stopping page
    const pages = [
      [feedItem('at://me/app.bsky.feed.post/new1', NOW), feedItem('at://me/app.bsky.feed.post/recent', recent)],
      [feedItem('at://me/app.bsky.feed.post/old1', old), feedItem('at://me/app.bsky.feed.post/old2', old)],
      [feedItem('at://me/app.bsky.feed.post/never', NOW - 50 * DAY)],
    ];
    const fetchFake = fakeAuthorFeed(pages);
    vi.stubGlobal('fetch', fetchFake);
    const banked = [];
    const res = await sweepPosts({
      did: 'did:plc:me',
      knownUris: new Set(['at://me/app.bsky.feed.post/recent', 'at://me/app.bsky.feed.post/old1', 'at://me/app.bsky.feed.post/old2']),
      rehydrateSinceMs: NOW - 30 * DAY,
      onPage: (rows) => banked.push(...rows),
    });
    expect(res.complete).toBe(true);
    // Page 3 was never requested — page 2 was all-known and all-old.
    expect(fetchFake).toHaveBeenCalledTimes(2);
    // The known-but-recent row was re-emitted so its counts refresh.
    expect(banked.map((r) => r.rkey)).toContain('recent');
    expect(banked.map((r) => r.rkey)).not.toContain('never');
  });

  it("is not fooled into stopping by a page of other people's reposts", async () => {
    const repost = { ...feedItem('at://them/app.bsky.feed.post/x', NOW - 40 * DAY), reason: { $type: 'app.bsky.feed.defs#reasonRepost' } };
    const pages = [[repost], [feedItem('at://me/app.bsky.feed.post/mine', NOW - 45 * DAY)]];
    vi.stubGlobal('fetch', fakeAuthorFeed(pages));
    const res = await sweepPosts({
      did: 'did:plc:me',
      knownUris: new Set(),
      rehydrateSinceMs: NOW - 30 * DAY,
    });
    // The repost page banked nothing but did NOT end the sweep; page 2's own
    // post was new, so it was fetched and kept.
    expect(res.fetched).toBe(1);
    expect(res.complete).toBe(true);
  });

  it('hands back the cursor when a page fails, so a build resumes instead of restarting', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const cursor = new URL(url).searchParams.get('cursor');
        if (!cursor) {
          calls++;
          return { ok: true, json: async () => ({ feed: [feedItem('at://me/app.bsky.feed.post/a', NOW)], cursor: '1' }) };
        }
        return { ok: false, status: 500 };
      }),
    );
    const res = await sweepPosts({ did: 'did:plc:me' });
    expect(calls).toBe(1);
    expect(res.complete).toBe(false);
    expect(res.cursor).toBe('1');
    expect(res.error).toMatch(/500/);
  });
});

describe('sweepFollowers', () => {
  it('dates each follower from their follow record TID and sweeps to the end', async () => {
    const followedMs = NOW - 3 * DAY;
    const agent = {
      app: { bsky: { graph: {
        getFollowers: vi.fn(async ({ cursor }) =>
          cursor
            ? { data: { followers: [], cursor: undefined } }
            : {
                data: {
                  followers: [
                    {
                      did: 'did:plc:fan',
                      handle: 'fan.example',
                      viewer: { followedBy: `at://did:plc:fan/app.bsky.graph.follow/${tidFor(followedMs)}` },
                    },
                    { did: 'did:plc:mystery', viewer: {} },
                  ],
                  cursor: 'next',
                },
              },
        ),
      } } },
    };
    const res = await sweepFollowers(agent, 'did:plc:me');
    expect(res.complete).toBe(true);
    expect(res.followers).toHaveLength(2);
    expect(Date.parse(res.followers[0].followedAt)).toBe(Date.parse(tidToTimestamp(tidFor(followedMs))));
    // No follow record visible → no invented date, but still a counted follower.
    expect(res.followers[1].followedAt).toBeNull();
  });
});

describe('sweepInbound', () => {
  const notif = (uri, reason, atMs) => ({
    uri,
    reason,
    author: { did: 'did:plc:them' },
    indexedAt: new Date(atMs).toISOString(),
  });

  function fakeAgent(pages) {
    return {
      app: { bsky: { notification: {
        listNotifications: vi.fn(async ({ cursor }) => {
          const i = cursor ? Number(cursor) : 0;
          return {
            data: {
              notifications: pages[i] || [],
              cursor: i + 1 < pages.length ? String(i + 1) : undefined,
            },
          };
        }),
      } } },
    };
  }

  it('banks events down to the cutoff and stops there', async () => {
    const agent = fakeAgent([
      [notif('n1', 'like', NOW - 1 * DAY), notif('n2', 'follow', NOW - 1 * DAY)],
      [notif('n3', 'reply', NOW - 400 * DAY)],
      [notif('n4', 'like', NOW - 401 * DAY)],
    ]);
    const res = await sweepInbound(agent, { cutoffMs: NOW - 365 * DAY });
    expect(res.complete).toBe(true);
    // The follow was dropped as a non-engagement reason; the too-old reply was
    // seen (it proves the cutoff) but not banked.
    expect(res.events.map((e) => e.uri)).toEqual(['n1']);
    expect(agent.app.bsky.notification.listNotifications).toHaveBeenCalledTimes(2);
    expect(res.reachedMs).toBe(NOW - 400 * DAY);
  });

  it('stops at known events only when previous coverage already reaches the cutoff', async () => {
    const pages = [
      [notif('known1', 'like', NOW - 1 * DAY)],
      [notif('known2', 'like', NOW - 2 * DAY)],
    ];
    const known = new Set(['known1', 'known2']);
    // Covered at least as deep as asked → the first all-known page ends it.
    const covered = await sweepInbound(fakeAgent(pages), {
      cutoffMs: NOW - 30 * DAY,
      knownUris: known,
      coveredToMs: NOW - 365 * DAY,
    });
    expect(covered.complete).toBe(true);
    // Not covered that deep → known pages are paged THROUGH to the end.
    const uncovered = await sweepInbound(fakeAgent(pages), {
      cutoffMs: NOW - 30 * DAY,
      knownUris: known,
      coveredToMs: NOW - 7 * DAY,
    });
    expect(uncovered.complete).toBe(true);
    expect(uncovered.events).toHaveLength(2);
  });
});

describe('sweepOutbound', () => {
  const likeRecord = (rkey, targetDid, atMs) => ({
    uri: `at://did:plc:me/app.bsky.feed.like/${rkey}`,
    value: {
      subject: { uri: `at://${targetDid}/app.bsky.feed.post/x` },
      createdAt: new Date(atMs).toISOString(),
    },
  });

  it('stops each collection at the cutoff by rkey TID and tolerates a missing one', async () => {
    const pages = {
      'app.bsky.feed.like': [
        { records: [likeRecord(tidFor(NOW - 1 * DAY), 'did:plc:a', NOW - 1 * DAY)], cursor: 'c1' },
        { records: [likeRecord(tidFor(NOW - 400 * DAY), 'did:plc:b', NOW - 400 * DAY)], cursor: 'c2' },
        { records: [likeRecord(tidFor(NOW - 500 * DAY), 'did:plc:c', NOW - 500 * DAY)], cursor: undefined },
      ],
    };
    const calls = { 'app.bsky.feed.like': 0, 'app.bsky.feed.repost': 0 };
    const agent = {
      com: { atproto: { repo: {
        listRecords: vi.fn(async ({ collection }) => {
          if (collection === 'app.bsky.feed.repost') throw new Error('Could not locate record');
          const page = pages[collection][calls[collection]++];
          return { data: page };
        }),
      } } },
    };
    const res = await sweepOutbound(agent, 'did:plc:me', { cutoffMs: NOW - 365 * DAY });
    expect(res.complete).toBe(true);
    expect(res.error).toBeNull();
    // Banked the in-window like; the past-cutoff page ended the walk before page 3.
    expect(res.events.map((e) => e.did)).toEqual(['did:plc:a']);
    expect(calls['app.bsky.feed.like']).toBe(2);
  });
});
