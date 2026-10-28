import { describe, it, expect, vi, beforeEach } from 'vitest';

const pages = { script: [] };
vi.mock('../constellation.js', () => ({
  getBacklinkSources: vi.fn(async () => ({})),
  flattenSources: vi.fn(() => [
    {
      collection: 'app.bsky.feed.like',
      path: '.subject.uri',
      source: 'app.bsky.feed.like:subject.uri',
      count: 300,
    },
  ]),
  // Each call takes the next scripted answer: a page, or null for a failure.
  getBacklinks: vi.fn(async () => pages.script.shift() ?? null),
  backlinkRows: (page) => page.records,
}));

const { harvestPost } = await import('./harvest.js');

const page = (n, cursor) => ({
  records: Array.from({ length: 2 }, (_, i) => ({
    did: `did:plc:p${n}x${i}`,
    rkey: `r${n}${i}`,
  })),
  cursor,
});

beforeEach(() => {
  pages.script = [];
});

describe('a harvest that fails part way', () => {
  it('says it is not everyone, rather than passing for a complete read', async () => {
    pages.script = [page(1, 'c1'), page(2, 'c2'), null, null];
    const h = await harvestPost('at://did:plc:a/app.bsky.feed.post/1');
    expect(h.participants).toHaveLength(4);
    expect(h.truncated).toBe(true);
    expect(h.sources[0]).toMatchObject({ truncated: true, failed: false });
  });

  it('asks for a failed page once more before giving up on it', async () => {
    pages.script = [page(1, 'c1'), null, page(2, undefined)];
    const h = await harvestPost('at://did:plc:a/app.bsky.feed.post/1');
    expect(h.participants).toHaveLength(4);
    expect(h.truncated).toBe(false);
  });

  it('still calls a source that never answered failed, not truncated', async () => {
    pages.script = [null, null];
    const h = await harvestPost('at://did:plc:a/app.bsky.feed.post/1');
    expect(h.sources[0]).toMatchObject({ truncated: false, failed: true });
  });
});
