import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveSlice,
  normalisePost,
  engagementOf,
  authorWindow,
  circleWindow,
  feedWindow,
  summariseWindow,
  selectPosts,
  mergeCopy,
  ampOf,
  renderPosts,
  domainOf,
  pulse,
  clearPulseCache,
  MAX_WINDOW_HOURS,
} from './pulse.js';

const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

/** One getAuthorFeed item, with only the fields this module reads. */
function item({
  uri = `at://did:plc:a/app.bsky.feed.post/${Math.random().toString(36).slice(2)}`,
  did = 'did:plc:a',
  handle = 'a.test',
  text = 'hello',
  at = hoursAgo(1),
  likes = 0,
  reposts = 0,
  replies = 0,
  quotes = 0,
  reply = null,
  reason = null,
  embed = null,
  facets = null,
} = {}) {
  return {
    post: {
      uri,
      author: { did, handle },
      record: {
        text,
        createdAt: at,
        ...(reply ? { reply } : {}),
        ...(facets ? { facets } : {}),
      },
      likeCount: likes,
      repostCount: reposts,
      replyCount: replies,
      quoteCount: quotes,
      ...(embed ? { embed } : {}),
    },
    ...(reason ? { reason } : {}),
  };
}

/** A fetch that answers from a map of url-substring -> body, and counts calls. */
function fakeFetch(routes) {
  const calls = [];
  const impl = vi.fn(async (url) => {
    calls.push(url);
    for (const [needle, body] of routes) {
      if (url.includes(needle)) {
        if (typeof body === 'number') {
          return { ok: false, status: body, json: async () => ({}) };
        }
        const resolved = typeof body === 'function' ? body(url) : body;
        return { ok: true, status: 200, json: async () => resolved };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  impl.calls = calls;
  return impl;
}

describe('resolveSlice', () => {
  it('treats the circle as the default and as several names for it', async () => {
    for (const spec of ['', '  ', 'circle', 'Circle', 'follows', 'my circle']) {
      expect(await resolveSlice(spec)).toEqual({ kind: 'circle' });
    }
  });

  it('reads the kind off the collection, not off the URL shape', async () => {
    // An at:// list URI arriving where a feed was expected still has to be
    // fetched with getListFeed: the two endpoints take different parameter
    // names, and guessing wrong returns an empty feed rather than an error.
    expect(
      await resolveSlice('at://did:plc:x/app.bsky.graph.list/abc'),
    ).toEqual({ kind: 'list', uri: 'at://did:plc:x/app.bsky.graph.list/abc' });
    expect(
      await resolveSlice('at://did:plc:x/app.bsky.feed.generator/for-you'),
    ).toEqual({
      kind: 'feed',
      uri: 'at://did:plc:x/app.bsky.feed.generator/for-you',
    });
  });

  it('resolves a bsky.app feed link, handle and all', async () => {
    const fetchImpl = fakeFetch([['resolveHandle', { did: 'did:plc:sc' }]]);
    expect(
      await resolveSlice(
        'https://bsky.app/profile/spacecowboy17.bsky.social/feed/for-you',
        { fetchImpl },
      ),
    ).toEqual({
      kind: 'feed',
      uri: 'at://did:plc:sc/app.bsky.feed.generator/for-you',
    });
  });

  it('resolves a bsky.app list link', async () => {
    const fetchImpl = fakeFetch([['resolveHandle', { did: 'did:plc:d' }]]);
    expect(
      await resolveSlice('https://bsky.app/profile/dame.is/lists/xyz', {
        fetchImpl,
      }),
    ).toEqual({ kind: 'list', uri: 'at://did:plc:d/app.bsky.graph.list/xyz' });
  });

  it('refuses a collection that is not a stream of posts', async () => {
    // A post URI is the thing dame pastes at this tool most often by mistake,
    // and "no posts found" would be a lie about a post that exists.
    await expect(
      resolveSlice('at://did:plc:x/app.bsky.feed.post/abc'),
    ).rejects.toThrow(/not a feed or a list/);
    await expect(resolveSlice('what my friends said')).rejects.toThrow(
      /not a slice I can read/,
    );
  });
});

describe('normalisePost', () => {
  it('tells "they said this" from "they amplified this"', () => {
    const said = normalisePost(item({ handle: 'a.test' }));
    expect(said.said).toBe(true);
    expect(said.viaRepost).toBe(false);
    expect(said.amplifiedBy).toEqual([]);

    const amplified = normalisePost(
      item({
        handle: 'stranger.test',
        reason: {
          $type: 'app.bsky.feed.defs#reasonRepost',
          by: { handle: 'a.test', did: 'did:plc:a' },
        },
      }),
    );
    expect(amplified.said).toBe(false);
    expect(amplified.viaRepost).toBe(true);
    expect(amplified.amplifiedBy).toEqual(['a.test']);
    expect(amplified.handle).toBe('stranger.test');
  });

  it('collects links from facets and from an external embed', () => {
    const p = normalisePost(
      item({
        facets: [
          {
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://www.example.com/a',
              },
              { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:z' },
            ],
          },
        ],
        embed: {
          $type: 'app.bsky.embed.external#view',
          external: { uri: 'https://other.test/b' },
        },
      }),
    );
    expect(p.links).toEqual([
      'https://www.example.com/a',
      'https://other.test/b',
    ]);
    expect(p.links.map(domainOf)).toEqual(['example.com', 'other.test']);
  });

  it('drops anything without text rather than emitting a blank row', () => {
    expect(normalisePost({ post: { uri: 'at://x' } })).toBe(null);
    expect(normalisePost(null)).toBe(null);
  });

  it('counts every deliberate engagement, not just likes', () => {
    expect(
      engagementOf(
        normalisePost(item({ likes: 3, reposts: 2, replies: 1, quotes: 4 })),
      ),
    ).toBe(10);
  });
});

describe('authorWindow', () => {
  it('sizes the first page to the window instead of always asking for 100', async () => {
    const fetchImpl = fakeFetch([['getAuthorFeed', { feed: [item()] }]]);
    await authorWindow('did:plc:a', {
      sinceMs: NOW - 86_400_000,
      hours: 24,
      fetchImpl,
    });
    // 24h of a circle averaging 3.4 posts a day. Measured: limit=36 costs
    // 24 MB across the circle and limit=15 costs 10.2 MB for the same answer.
    expect(fetchImpl.calls[0]).toContain('limit=15');
  });

  it('stops paging as soon as a page reaches past the window', async () => {
    const fetchImpl = fakeFetch([
      [
        'getAuthorFeed',
        {
          feed: [item({ at: hoursAgo(1) }), item({ at: hoursAgo(40) })],
          cursor: 'more',
        },
      ],
    ]);
    const r = await authorWindow('did:plc:a', {
      sinceMs: NOW - 86_400_000,
      hours: 24,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.complete).toBe(true);
    expect(r.posts).toHaveLength(1);
  });

  it('reports being cut by the page cap rather than looking complete', async () => {
    // Every page is entirely inside the window and there is always a cursor,
    // so this author runs the cap out. Saying so is the point: a digest that
    // silently saw half of the busiest account is wrong about the slice.
    const fetchImpl = fakeFetch([
      ['getAuthorFeed', { feed: [item({ at: hoursAgo(1) })], cursor: 'more' }],
    ]);
    const r = await authorWindow('did:plc:a', {
      sinceMs: NOW - 86_400_000,
      hours: 24,
      fetchImpl,
    });
    expect(r.complete).toBe(false);
    expect(fetchImpl.mock.calls.length).toBe(4);
  });

  it('gives up immediately on a permanent failure', async () => {
    // A deactivated account answers 400 forever; retrying it is how a fan-out
    // spends its budget on the one member who cannot be read.
    const fetchImpl = fakeFetch([['getAuthorFeed', 400]]);
    const r = await authorWindow('did:plc:gone', { sinceMs: 0, fetchImpl });
    expect(r.permanent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('asks for replies only when replies were asked for', async () => {
    const fetchImpl = fakeFetch([['getAuthorFeed', { feed: [] }]]);
    await authorWindow('did:plc:a', { sinceMs: 0, fetchImpl });
    expect(fetchImpl.calls[0]).toContain('filter=posts_no_replies');
    await authorWindow('did:plc:a', {
      sinceMs: 0,
      fetchImpl,
      includeReplies: true,
    });
    expect(fetchImpl.calls[1]).toContain('filter=posts_with_replies');
  });
});

describe('circleWindow', () => {
  it('does not let one unreadable account take the rest down with it', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('did%3Aplc%3Agone')) {
        return { ok: false, status: 400, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ feed: [item({ at: hoursAgo(2) })] }),
      };
    });
    const r = await circleWindow({
      dids: ['did:plc:a', 'did:plc:gone', 'did:plc:b'],
      sinceMs: NOW - 86_400_000,
      fetchImpl,
    });
    expect(r.posts).toHaveLength(2);
    expect(r.coverage).toMatchObject({
      accounts: 3,
      read: 2,
      unreadable: 1,
      unread: 0,
    });
  });

  it('collapses a post seen from several members, keeping every amplifier', async () => {
    // The bug the first live run exposed. One post reposted by two members
    // arrived twice, took two of the three sample slots its author was allowed,
    // and inflated the post count -- so the digest measured reposting rather
    // than conversation. The duplicate is signal, not noise: how many of the
    // circle passed something on is the most useful number in a follow-graph
    // digest, so the copies collapse into one post that carries the list.
    const shared = {
      uri: 'at://did:plc:stranger/app.bsky.feed.post/viral',
      handle: 'stranger.test',
      did: 'did:plc:stranger',
      at: hoursAgo(3),
      likes: 13808,
    };
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({
        feed: [
          item({
            ...shared,
            reason: {
              by: { handle: url.includes('plc%3Aa') ? 'a.test' : 'b.test' },
            },
          }),
        ],
      }),
    }));
    const r = await circleWindow({
      dids: ['did:plc:a', 'did:plc:b'],
      sinceMs: NOW - 86_400_000,
      fetchImpl,
    });
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0].amplifiedBy.sort()).toEqual(['a.test', 'b.test']);
    expect(ampOf(r.posts[0])).toBe(2);
    expect(r.posts[0].said).toBe(false);
  });

  it('counts a post as written when any member wrote it, whoever passed it on', async () => {
    const uri = 'at://did:plc:a/app.bsky.feed.post/mine';
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({
        feed: [
          url.includes('plc%3Aa')
            ? item({ uri, handle: 'a.test', did: 'did:plc:a', at: hoursAgo(2) })
            : item({
                uri,
                handle: 'a.test',
                did: 'did:plc:a',
                at: hoursAgo(2),
                reason: { by: { handle: 'b.test' } },
              }),
        ],
      }),
    }));
    const r = await circleWindow({
      dids: ['did:plc:a', 'did:plc:b'],
      sinceMs: NOW - 86_400_000,
      fetchImpl,
    });
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0].said).toBe(true);
    expect(r.posts[0].amplifiedBy).toEqual(['b.test']);
  });

  it('says how many accounts went unread when the budget runs out', async () => {
    // A short answer that looks complete is the failure mode worth a test:
    // "my circle barely posted today" and "I only managed to read forty of
    // them" are different sentences.
    const fetchImpl = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                json: async () => ({ feed: [] }),
              }),
            30,
          ),
        ),
    );
    const r = await circleWindow({
      dids: Array.from({ length: 200 }, (_, i) => `did:plc:${i}`),
      sinceMs: 0,
      fetchImpl,
      concurrency: 2,
      budgetMs: 60,
    });
    expect(r.coverage.unread).toBeGreaterThan(0);
    expect(r.coverage.read).toBeLessThan(200);
  });
});

describe('mergeCopy', () => {
  it('unions the amplifiers and lets "written" win', () => {
    const a = normalisePost(item({ reason: { by: { handle: 'x.test' } } }));
    const b = normalisePost(item({ reason: { by: { handle: 'y.test' } } }));
    const merged = mergeCopy(a, b);
    expect(merged.amplifiedBy).toEqual(['x.test', 'y.test']);
    expect(merged.said).toBe(false);

    const direct = normalisePost(item({}));
    expect(mergeCopy(merged, direct).said).toBe(true);
  });

  it('does not double-count the same amplifier', () => {
    const a = normalisePost(item({ reason: { by: { handle: 'x.test' } } }));
    const b = normalisePost(item({ reason: { by: { handle: 'x.test' } } }));
    expect(ampOf(mergeCopy(a, b))).toBe(1);
  });

  it('returns the incoming copy when there is nothing to merge into', () => {
    const only = normalisePost(item({}));
    expect(mergeCopy(undefined, only)).toBe(only);
  });
});

describe('feedWindow', () => {
  it('uses the parameter name the endpoint actually takes', async () => {
    const fetchImpl = fakeFetch([['getListFeed', { feed: [] }]]);
    await feedWindow({
      uri: 'at://x/app.bsky.graph.list/l',
      kind: 'list',
      sinceMs: 0,
      fetchImpl,
    });
    expect(fetchImpl.calls[0]).toContain('getListFeed?list=');

    const f2 = fakeFetch([['getFeed', { feed: [] }]]);
    await feedWindow({
      uri: 'at://x/app.bsky.feed.generator/g',
      kind: 'feed',
      sinceMs: 0,
      fetchImpl: f2,
    });
    expect(f2.calls[0]).toContain('getFeed?feed=');
  });

  it('counts a post once when a feed serves it twice across pages', async () => {
    // A ranked feed reshuffles under the cursor. Double-counting overstates
    // how much of the window one post is.
    let page = 0;
    const dupe = item({
      uri: 'at://did:plc:a/app.bsky.feed.post/same',
      at: hoursAgo(1),
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        page += 1;
        return page === 1
          ? { feed: [dupe], cursor: 'p2' }
          : { feed: [dupe, item({ at: hoursAgo(40) })] };
      },
    }));
    const r = await feedWindow({
      uri: 'at://x/app.bsky.feed.generator/g',
      sinceMs: NOW - 86_400_000,
      fetchImpl,
    });
    expect(r.posts).toHaveLength(1);
  });
});

describe('selectPosts', () => {
  const loud = Array.from({ length: 20 }, (_, i) =>
    normalisePost(
      item({ handle: 'loud.test', did: 'did:plc:loud', likes: 500 + i }),
    ),
  );
  const others = Array.from({ length: 10 }, (_, i) =>
    normalisePost(
      item({ handle: `q${i}.test`, did: `did:plc:q${i}`, likes: 1 }),
    ),
  );

  it('caps how much of the sample one account can be', () => {
    // Engagement order alone hands the whole sample to the loudest account and
    // produces a confident answer about 228 people built from the output of
    // one. Breadth is the thing being measured.
    const { kept } = selectPosts([...loud, ...others], {
      limit: 12,
      perAuthor: 3,
    });
    const fromLoud = kept.filter((p) => p.handle === 'loud.test');
    expect(fromLoud).toHaveLength(3);
    expect(new Set(kept.map((p) => p.handle)).size).toBeGreaterThan(5);
  });

  it('orders by engagement by default and by time when asked', () => {
    const { kept } = selectPosts([...others, ...loud], {
      limit: 3,
      perAuthor: 3,
    });
    expect(kept.every((p) => p.handle === 'loud.test')).toBe(true);

    const old = normalisePost(
      item({ handle: 'z.test', at: hoursAgo(20), likes: 9999 }),
    );
    const fresh = normalisePost(
      item({ handle: 'y.test', at: hoursAgo(1), likes: 0 }),
    );
    const byTime = selectPosts([old, fresh], { sort: 'recent' });
    expect(byTime.kept[0].handle).toBe('y.test');
  });

  it('keeps what the slice wrote apart from what it passed on', () => {
    const wrote = normalisePost(
      item({ handle: 'member.test', text: 'mine', likes: 4 }),
    );
    const passed = normalisePost(
      item({
        handle: 'stranger.test',
        text: 'theirs',
        likes: 13808,
        reason: { by: { handle: 'member.test' } },
      }),
    );
    const r = selectPosts([passed, wrote], { limit: 10 });
    expect(r.said.map((p) => p.text)).toEqual(['mine']);
    expect(r.amplified.map((p) => p.text)).toEqual(['theirs']);
  });

  it('ranks what was amplified by how many passed it on, not by global likes', () => {
    // The second bug the live run exposed. Ranking both groups together by
    // engagement put four reposts of thirteen-thousand-like posts at the top
    // of the digest -- a correct ranking of the wrong thing, which rebuilds
    // the network-wide answer dame already has and calls it her circle.
    const viral = normalisePost(
      item({
        handle: 'famous.test',
        text: 'viral',
        likes: 13808,
        reason: { by: { handle: 'one.test' } },
      }),
    );
    const local = normalisePost(
      item({ handle: 'niche.test', text: 'niche', likes: 40 }),
    );
    local.said = false;
    local.viaRepost = true;
    local.amplifiedBy = [
      'a.test',
      'b.test',
      'c.test',
      'd.test',
      'e.test',
      'f.test',
    ];

    const r = selectPosts([viral, local], { limit: 10 });
    expect(r.amplified.map((p) => p.text)).toEqual(['niche', 'viral']);
    // Asking for recency instead orders by time, not by either of those.
    const recent = selectPosts([viral, local], { limit: 10, sort: 'recent' });
    expect(recent.amplified).toHaveLength(2);
  });

  it('gives unused slots from one group to the other', () => {
    const wrote = Array.from({ length: 8 }, (_, i) =>
      normalisePost(item({ handle: `m${i}.test`, did: `did:plc:m${i}` })),
    );
    const r = selectPosts(wrote, { limit: 8 });
    // Nothing was amplified, so the written group is not capped at 65%.
    expect(r.said).toHaveLength(8);
    expect(r.omitted).toBe(0);
  });

  it('narrows to a focus term and reports what it left out', () => {
    const posts = [
      normalisePost(
        item({ handle: 'a.test', text: 'thinking about ATProto lexicons' }),
      ),
      normalisePost(item({ handle: 'b.test', text: 'lunch' })),
    ];
    const r = selectPosts(posts, { focus: 'atproto' });
    expect(r.matched).toBe(1);
    expect(r.kept[0].text).toMatch(/lexicons/);

    const all = selectPosts(posts, { limit: 1, perAuthor: 3 });
    expect(all.omitted).toBe(1);
  });
});

describe('summariseWindow', () => {
  it('counts what the model should not be asked to count', () => {
    const posts = [
      normalisePost(
        item({
          handle: 'a.test',
          likes: 5,
          facets: [
            {
              features: [
                {
                  $type: 'app.bsky.richtext.facet#link',
                  uri: 'https://www.nyt.com/x',
                },
              ],
            },
          ],
        }),
      ),
      normalisePost(
        item({ handle: 'a.test', likes: 1, reply: { root: {}, parent: {} } }),
      ),
      normalisePost(
        item({
          handle: 'b.test',
          embed: {
            $type: 'app.bsky.embed.external#view',
            external: { uri: 'https://nyt.com/y' },
          },
        }),
      ),
    ];
    const s = summariseWindow(posts);
    expect(s).toMatchObject({
      posts: 3,
      said: 3,
      amplified: 0,
      authors: 2,
      replies: 1,
      withLinks: 2,
      engagement: 6,
    });
    expect(s.topAuthors[0]).toMatchObject({ handle: 'a.test', posts: 2 });
    // www. stripped, so one domain rather than two that look different.
    expect(s.topDomains).toEqual([{ domain: 'nyt.com', count: 2 }]);
  });
});

describe('renderPosts', () => {
  it('flattens a post to one readable block with its age and counts', () => {
    const out = renderPosts(
      [
        normalisePost(
          item({
            handle: 'a.test',
            text: 'line one\n\nline two',
            at: hoursAgo(3),
            likes: 7,
          }),
        ),
      ],
      { now: NOW },
    );
    expect(out).toContain('@a.test · 3h · 7L 0R 0C');
    expect(out).toContain('line one line two');
  });

  it('marks a repost as one rather than passing it off as the account speaking', () => {
    const amplified = normalisePost(
      item({ handle: 'stranger.test', reason: { by: { handle: 'a.test' } } }),
    );
    const out = renderPosts({ said: [], amplified: [amplified] }, { now: NOW });
    expect(out).toContain('AMPLIFIED BY THE SLICE');
    expect(out).toContain('amplified by 1 of the slice (@a.test)');
  });

  it('says what a post IS when it has no words', () => {
    // Image and video posts carry an empty text field. The first live run
    // rendered two of them as blank lines, which tells the model nothing and
    // invites it to describe a post it cannot see.
    const img = normalisePost(
      item({ text: '', embed: { $type: 'app.bsky.embed.images#view' } }),
    );
    const vid = normalisePost(
      item({ text: '   ', embed: { $type: 'app.bsky.embed.video#view' } }),
    );
    const out = renderPosts({ said: [img, vid], amplified: [] }, { now: NOW });
    expect(out).toContain('(image, no text)');
    expect(out).toContain('(video, no text)');
  });

  it('labels the two groups rather than interleaving them', () => {
    // A model handed one list cannot tell "someone dame follows wrote this"
    // from "someone dame follows passed this on", and those become the same
    // sentence in the reply.
    const wrote = normalisePost(item({ handle: 'member.test', text: 'mine' }));
    const passed = normalisePost(
      item({
        handle: 'stranger.test',
        text: 'theirs',
        reason: { by: { handle: 'member.test' } },
      }),
    );
    const out = renderPosts(
      { said: [wrote], amplified: [passed] },
      { now: NOW },
    );
    expect(out.indexOf('WRITTEN BY THE SLICE')).toBeLessThan(
      out.indexOf('AMPLIFIED BY THE SLICE'),
    );
    expect(out.indexOf('mine')).toBeLessThan(out.indexOf('theirs'));
  });
});

describe('pulse', () => {
  beforeEach(() => clearPulseCache());

  const circleFetch = () =>
    fakeFetch([
      [
        'getAuthorFeed',
        (url) => ({
          feed: [
            item({
              handle: url.includes('plc%3Aa') ? 'a.test' : 'b.test',
              did: url.includes('plc%3Aa') ? 'did:plc:a' : 'did:plc:b',
              text: url.includes('plc%3Aa') ? 'about lexicons' : 'about lunch',
              at: hoursAgo(2),
            }),
          ],
        }),
      ],
    ]);

  it('reads the circle and reports the window it read', async () => {
    const fetchImpl = circleFetch();
    const r = await pulse({
      source: 'circle',
      circleDids: ['did:plc:a', 'did:plc:b'],
      fetchImpl,
      now: NOW,
    });
    expect(r.slice).toMatchObject({ kind: 'circle' });
    expect(r.window).toMatchObject({
      hours: 24,
      until: new Date(NOW).toISOString(),
    });
    expect(r.totals.posts).toBe(2);
    expect(r.coverage).toMatchObject({ accounts: 2, read: 2, cached: false });
  });

  it('caches the FETCH, so a follow-up re-selects instead of re-reading', async () => {
    // "What about the AI ones" after "what is my circle talking about" is the
    // common shape, and it must not cost another 228-account fan-out.
    const fetchImpl = circleFetch();
    const opts = {
      circleDids: ['did:plc:a', 'did:plc:b'],
      fetchImpl,
      now: NOW,
    };
    await pulse(opts);
    const calls = fetchImpl.mock.calls.length;
    const second = await pulse({ ...opts, focus: 'lexicons' });
    expect(fetchImpl.mock.calls.length).toBe(calls);
    expect(second.coverage.cached).toBe(true);
    expect(second.matched).toBe(1);
    expect(second.posts[0].text).toContain('lexicons');
  });

  it('re-reads when the window changes, because that is a different question', async () => {
    const fetchImpl = circleFetch();
    const opts = { circleDids: ['did:plc:a'], fetchImpl, now: NOW };
    await pulse(opts);
    const calls = fetchImpl.mock.calls.length;
    await pulse({ ...opts, hours: 72 });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(calls);
  });

  it('clamps an absurd window instead of attempting it', async () => {
    const fetchImpl = circleFetch();
    const r = await pulse({
      circleDids: ['did:plc:a'],
      hours: 10_000,
      fetchImpl,
      now: NOW,
    });
    expect(r.window.hours).toBe(MAX_WINDOW_HOURS);
    const tiny = await pulse({
      circleDids: ['did:plc:a'],
      hours: 0,
      fetchImpl,
      now: NOW,
      useCache: false,
    });
    expect(tiny.window.hours).toBe(24);
  });

  it('refuses to answer for an empty circle rather than reporting silence', async () => {
    // An empty snapshot would otherwise produce "nobody you follow posted
    // today", which is a confident answer to a question that was never asked.
    await expect(
      pulse({ circleDids: [], fetchImpl: circleFetch() }),
    ).rejects.toThrow(/mod-precompute/);
  });

  it('has no For You slice, and does not invent one from the unauthenticated feed', async () => {
    // The generator personalises off the requester's DID. Reading it as nobody
    // returns a real feed that is not dame's, which is the dangerous outcome.
    await expect(resolveSlice('foryou')).rejects.toThrow(
      /not a slice I can read/,
    );
    await expect(resolveSlice('my for you feed')).rejects.toThrow(
      /not a slice I can read/,
    );
  });
});
