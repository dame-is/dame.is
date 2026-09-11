import { afterEach, describe, it, expect, vi } from 'vitest';
import { backlinkRows, flattenSources, getBacklinks } from './constellation.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('getBacklinks', () => {
  it('backs off and retries when the public instance rate-limits a request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => '2' },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ records: [{ did: 'did:plc:a' }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const request = getBacklinks('did:plc:me', 'app.bsky.graph.block:subject');
    await vi.advanceTimersByTimeAsync(2000);

    expect(await request).toEqual({ records: [{ did: 'did:plc:a' }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('backlinkRows', () => {
  it('reads the XRPC route, which calls them `records`', () => {
    // The bug this guards: reading only `linking_records` turned a 200 with
    // 34 backlinks into "this post was never touched" — silently, because an
    // undefined array iterates as an empty one.
    const page = { total: 2, records: [{ did: 'did:plc:a', rkey: '3l' }], cursor: null };
    expect(backlinkRows(page)).toHaveLength(1);
  });

  it('still reads the older /links route, which calls them `linking_records`', () => {
    expect(backlinkRows({ linking_records: [{ did: 'did:plc:a' }, { did: 'did:plc:b' }] })).toHaveLength(2);
  });

  it('gives an empty array for an empty or failed page', () => {
    expect(backlinkRows({ records: [] })).toEqual([]);
    expect(backlinkRows(null)).toEqual([]);
    expect(backlinkRows({})).toEqual([]);
  });
});

describe('flattenSources', () => {
  it('strips the leading dot /links/all puts on each path', () => {
    // getBacklinks rejects ".subject.uri"; its source param wants it bare.
    const [row] = flattenSources({
      links: { 'app.bsky.feed.like': { '.subject.uri': { records: 3, distinct_dids: 2 } } },
    });
    expect(row.source).toBe('app.bsky.feed.like:subject.uri');
    expect(row.count).toBe(3);
    expect(row.distinctDids).toBe(2);
  });

  it('sorts by count, busiest first', () => {
    const rows = flattenSources({
      links: {
        'app.bsky.feed.like': { '.subject.uri': { records: 1 } },
        'app.bsky.feed.post': { '.reply.root.uri': { records: 29 } },
      },
    });
    expect(rows.map((r) => r.count)).toEqual([29, 1]);
  });

  it('returns null when the call itself failed', () => {
    expect(flattenSources(null)).toBeNull();
  });
});
