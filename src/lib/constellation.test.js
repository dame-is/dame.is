import { describe, it, expect } from 'vitest';
import { backlinkRows, flattenSources } from './constellation.js';

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
