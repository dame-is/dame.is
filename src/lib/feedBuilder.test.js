import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  buildUnifiedFeed,
  localizeObservationInstants,
  transformRecords,
} from './feedBuilder.js';

const ME = 'did:plc:test';
const PDS = 'https://pds.example';

// A stand-in for the subject resolver, so nothing here reaches past `fetch`.
const resolver = {
  hydrateSubjects: async (records) => {
    for (const r of records) r._subject = { missing: true };
  },
};

function ok(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** A fetch serving `byCollection` (nsid → records) and an author feed. */
function fakeFetch({
  authorFeed = [],
  byCollection = {},
  fail = () => false,
} = {}) {
  return async (url) => {
    const u = new URL(String(url));
    if (fail(u)) throw new TypeError('Failed to fetch');
    if (u.pathname.endsWith('getAuthorFeed')) return ok({ feed: authorFeed });
    if (u.pathname.endsWith('listRecords')) {
      const records = byCollection[u.searchParams.get('collection')] || [];
      const limit = Number(u.searchParams.get('limit'));
      return ok({ records: records.slice(0, limit) });
    }
    return ok({});
  };
}

function build(verbs, extra = {}) {
  return buildUnifiedFeed({
    pds: PDS,
    me: ME,
    options: {
      initialMax: 3,
      authorFeedMax: 3,
      skipListMembers: true,
      subjectResolver: resolver,
      verbs,
      ...extra,
    },
  });
}

function post(rkey, createdAt) {
  return {
    post: {
      uri: `at://${ME}/app.bsky.feed.post/${rkey}`,
      cid: `c-${rkey}`,
      author: { did: ME, handle: 'me.test' },
      record: { text: rkey, createdAt },
      indexedAt: createdAt,
    },
  };
}

function status(rkey, createdAt) {
  return {
    uri: `at://${ME}/is.dame.now/${rkey}`,
    cid: `c-${rkey}`,
    value: { status: rkey, createdAt },
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('buildUnifiedFeed failure tally', () => {
  it('reports every core fetch failing when nothing can be reached', async () => {
    globalThis.fetch = fakeFetch({ fail: () => true });
    const { unified, failures } = await build(['posting', 'logging']);
    expect(unified).toEqual([]);
    expect(failures.attempted).toBeGreaterThan(0);
    expect(failures.failed).toBe(failures.attempted);
    expect(failures.labels).toContain('app.bsky.feed.post');
    expect(failures.labels).toContain('is.dame.now');
  });

  it('names only the source that failed in a partial outage', async () => {
    globalThis.fetch = fakeFetch({
      byCollection: { 'is.dame.now': [status('a', '2026-10-20T12:00:00Z')] },
      fail: (u) => u.pathname.endsWith('getAuthorFeed'),
    });
    const { unified, failures } = await build(['posting', 'logging']);
    expect(failures.failed).toBe(1);
    expect(failures.failed).toBeLessThan(failures.attempted);
    expect(failures.labels).toEqual(['app.bsky.feed.post']);
    expect(unified.map((i) => i.verb)).toEqual(['logging']);
  });

  it('attempts nothing for an empty verb set, which is a valid empty feed', async () => {
    globalThis.fetch = fakeFetch({ fail: () => true });
    const { unified, failures } = await build([]);
    expect(unified).toEqual([]);
    expect(failures).toEqual({ attempted: 0, failed: 0, labels: [] });
  });
});

describe('buildUnifiedFeed horizons', () => {
  it('marks where a capped source runs out, and nothing for one under its cap', async () => {
    globalThis.fetch = fakeFetch({
      authorFeed: [
        post('p3', '2026-10-27T10:00:00Z'),
        post('p2', '2026-10-26T10:00:00Z'),
        post('p1', '2026-10-25T10:00:00Z'),
      ],
      byCollection: {
        'is.dame.now': [status('s1', '2026-09-01T12:00:00Z')],
      },
    });
    const { horizons } = await build(['posting', 'logging']);
    expect(horizons).toEqual({ posting: '2026-10-25T10:00:00Z' });
  });

  it("takes the newest of a verb's capped sources", async () => {
    globalThis.fetch = fakeFetch({
      authorFeed: [
        post('p3', '2026-10-27T10:00:00Z'),
        post('p2', '2026-10-26T10:00:00Z'),
        post('p1', '2026-10-25T10:00:00Z'),
      ],
      byCollection: {
        'net.anisota.feed.post': [1, 2, 3].map((n) => ({
          uri: `at://${ME}/net.anisota.feed.post/a${n}`,
          value: { text: 'a', createdAt: `2025-0${n}-01T00:00:00Z` },
        })),
      },
    });
    const { horizons } = await build(['posting']);
    expect(horizons.posting).toBe('2026-10-25T10:00:00Z');
  });
});

describe('buildUnifiedFeed timeline', () => {
  it('leaves out records with no instant at all', async () => {
    globalThis.fetch = fakeFetch({
      byCollection: {
        'site.standard.publication': [
          {
            uri: `at://${ME}/site.standard.publication/x`,
            value: { name: 'A publication' },
          },
        ],
        'site.standard.document': [
          {
            uri: `at://${ME}/site.standard.document/d`,
            value: { title: 'A post', publishedAt: '2026-10-01T00:00:00Z' },
          },
        ],
      },
    });
    const { unified, perCollection } = await build(['blogging']);
    expect(unified.map((i) => i.atUri)).toEqual([
      `at://${ME}/site.standard.document/d`,
    ]);
    // The per-collection snapshot keeps it for the pages that list it.
    expect(perCollection['site-standard-publication']).toHaveLength(1);
  });
});

describe('transformRecords', () => {
  it("bakes a CDN avatar URL onto a custom feed's avatar blob", () => {
    const records = [
      {
        uri: `at://${ME}/app.bsky.feed.generator/f`,
        value: {
          displayName: 'Feed',
          avatar: { ref: { $link: 'bafyavatar' } },
        },
      },
      {
        uri: `at://${ME}/app.bsky.feed.generator/g`,
        value: { displayName: 'No avatar' },
      },
    ];
    transformRecords(records, 'app.bsky.feed.generator', PDS, ME);
    expect(records[0].value.avatar._url).toBe(
      `https://cdn.bsky.app/img/avatar/plain/${ME}/bafyavatar@jpeg`,
    );
    expect(records[1].value.avatar).toBeUndefined();
  });
});

describe('localizeObservationInstants (viewer in New York)', () => {
  // Observation records pin the observer's wall clock to Z. The snapshot is
  // built in UTC, where that's a no-op; a viewer's browser has to redo it.
  const realTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = realTz;
    if (realTz === undefined) delete process.env.TZ;
  });

  it('puts a 1am moth on its own local night, and re-sorts', () => {
    const items = [
      { verb: 'posting', createdAt: '2026-10-17T03:00:00Z', atUri: 'post' },
      {
        verb: 'mothing',
        createdAt: '2026-10-17T01:00:00Z',
        atUri: 'moth',
        payload: { observedDate: '2026-10-17', observedTime: '01:00' },
      },
    ];
    const out = localizeObservationInstants(items);
    const moth = out.find((i) => i.atUri === 'moth');
    const local = new Date(moth.createdAt);
    expect([local.getDate(), local.getHours()]).toEqual([17, 1]);
    // 01:00 New York is 05:00Z, now newer than the 03:00Z post.
    expect(out.map((i) => i.atUri)).toEqual(['moth', 'post']);
  });

  it("measures a capped observation source's horizon on that same clock", async () => {
    const moth = (rkey, date, time) => ({
      uri: `at://${ME}/is.dame.mothing.observation/${rkey}`,
      value: {
        observedDate: date,
        observedTime: time,
        createdAt: `${date}T${time}:00Z`,
      },
    });
    globalThis.fetch = fakeFetch({
      byCollection: {
        'is.dame.mothing.observation': [
          moth('m3', '2026-10-17', '23:00'),
          moth('m2', '2026-10-17', '22:00'),
          moth('m1', '2026-10-17', '21:00'),
        ],
      },
    });
    const { unified, horizons } = await build(['mothing']);
    // The oldest moth as drawn, not its fake-UTC instant: that's hours off,
    // and east of Greenwich it would trim the oldest moths of the night.
    expect(horizons.mothing).toBe(unified[unified.length - 1].createdAt);
  });
});
