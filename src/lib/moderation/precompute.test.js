import { describe, it, expect, vi } from 'vitest';
import {
  followsOf,
  indexCircleFollows,
  referenceFrom,
  nextAction,
} from './precompute.js';

/** A getFollows stub: `pages` responses, each optionally taking time. */
function fakeFetch(pages, { msPerPage = 0 } = {}) {
  let n = 0;
  return vi.fn(async () => {
    const page = pages[Math.min(n++, pages.length - 1)];
    if (msPerPage) vi.advanceTimersByTime(msPerPage);
    return { ok: true, json: async () => page };
  });
}

const page = (dids, cursor) => ({
  follows: dids.map((did) => ({ did })),
  ...(cursor ? { cursor } : {}),
});

describe('followsOf', () => {
  it('pages until the cursor runs out', async () => {
    const fetchImpl = fakeFetch([
      page(['did:plc:a'], 'c1'),
      page(['did:plc:b']),
    ]);
    const out = await followsOf('did:plc:m', { fetchImpl });
    expect(out).toEqual({
      dids: ['did:plc:a', 'did:plc:b'],
      complete: true,
      aborted: false,
      permanent: false,
    });
  });

  it('aborts mid-member once the deadline passes', async () => {
    // The bug this guards: the budget used to be checked only BETWEEN members,
    // so eight workers could each start a 1,500-follow member just under the
    // limit and run tens of seconds past it. Vercel answered with a 504.
    vi.useFakeTimers();
    try {
      const fetchImpl = fakeFetch(
        Array.from({ length: 15 }, (_, i) => page([`did:plc:${i}`], `c${i}`)),
        { msPerPage: 400 },
      );
      const out = await followsOf('did:plc:m', {
        fetchImpl,
        deadline: Date.now() + 1000,
      });
      expect(out.aborted).toBe(true);
      expect(out.complete).toBe(false);
      // Stopped early rather than reading all fifteen pages.
      expect(fetchImpl.mock.calls.length).toBeLessThan(15);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports incomplete without aborting when it hits the page cap', async () => {
    // Truncation at MAX_PAGES is accepted and recorded; a deadline abort is not.
    const fetchImpl = fakeFetch([page(['did:plc:a'], 'always-more')]);
    const out = await followsOf('did:plc:m', { fetchImpl });
    expect(out.complete).toBe(false);
    expect(out.aborted).toBe(false);
  });
});

describe('permanently unreadable members', () => {
  // The first real snapshot livelocked here. Five of the 233 accounts dame
  // follows are deactivated or taken down; getFollows answers 400 for them and
  // always will. finalise_snapshot correctly refuses to aggregate while any
  // member is unindexed, so 228 of 233 done meant nothing would ever finish.
  const status = (code) =>
    vi.fn(async () => ({ ok: false, status: code, json: async () => ({}) }));

  it('marks a 400 as permanent, so the caller can stop asking', async () => {
    const out = await followsOf('did:plc:gone', { fetchImpl: status(400) });
    expect(out.permanent).toBe(true);
    expect(out.dids).toEqual([]);
  });

  it('does not mark a rate limit as permanent', async () => {
    // Slower than it looks: a retryable status burns the full backoff ladder
    // (500 + 1000 + 1500ms) before giving up, which is the point — the caller
    // should come back for this one. A permanent 400 returns on the first
    // response with no backoff at all, which is why that test is instant.
    const out = await followsOf('did:plc:busy', { fetchImpl: status(429) });
    expect(out.permanent).toBe(false);
  }, 10_000);

  it('reports the failure and its permanence up to the caller', async () => {
    const out = await indexCircleFollows({
      pending: ['did:plc:gone', 'did:plc:busy'],
      fetchImpl: vi.fn(async (url) => ({
        ok: false,
        status: url.includes('gone') ? 400 : 503,
        json: async () => ({}),
      })),
      writeEdges: async () => {},
      markDone: async () => {},
    });
    expect(out.indexed).toBe(0);
    expect(out.unreadable).toHaveLength(2);
    expect(
      out.unreadable.find((u) => u.member === 'did:plc:gone').permanent,
    ).toBe(true);
    expect(
      out.unreadable.find((u) => u.member === 'did:plc:busy').permanent,
    ).toBe(false);
  });
});

describe('indexCircleFollows', () => {
  it('writes and marks each member it finishes', async () => {
    const written = [];
    const done = [];
    const out = await indexCircleFollows({
      pending: ['did:plc:m1', 'did:plc:m2'],
      fetchImpl: fakeFetch([page(['did:plc:t'])]),
      writeEdges: async (rows) => written.push(...rows),
      markDone: async (m) => done.push(m),
    });
    expect(out.indexed).toBe(2);
    expect(done.sort()).toEqual(['did:plc:m1', 'did:plc:m2']);
    expect(written).toHaveLength(2);
  });

  it('discards a member it could not finish, rather than recording a partial', async () => {
    // Marking a truncated follow list as done would understate that member's
    // vouches for the life of the snapshot — and understating a vouch sends
    // someone to review who did not need it. Leaving it pending costs a retry.
    vi.useFakeTimers();
    try {
      const written = [];
      const done = [];
      await indexCircleFollows({
        pending: ['did:plc:m1'],
        budgetMs: 1000,
        fetchImpl: fakeFetch(
          Array.from({ length: 15 }, (_, i) => page([`did:plc:${i}`], `c${i}`)),
          { msPerPage: 400 },
        ),
        writeEdges: async (rows) => written.push(...rows),
        markDone: async (m) => done.push(m),
      });
      expect(done).toEqual([]);
      expect(written).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a member unmarked when the read fails outright', async () => {
    const done = [];
    const out = await indexCircleFollows({
      pending: ['did:plc:m1'],
      fetchImpl: vi.fn(async () => ({ ok: false, status: 400 })),
      writeEdges: async () => {},
      markDone: async (m) => done.push(m),
    });
    expect(done).toEqual([]);
    expect(out.indexed).toBe(0);
  });

  it('deduplicates a follow list before writing edges', async () => {
    const written = [];
    await indexCircleFollows({
      pending: ['did:plc:m1'],
      fetchImpl: fakeFetch([page(['did:plc:t', 'did:plc:t'])]),
      writeEdges: async (rows) => written.push(...rows),
      markDone: async () => {},
    });
    expect(written).toHaveLength(1);
  });
});

describe('referenceFrom', () => {
  it('treats the vouch table as the one-hop neighbourhood', () => {
    const ref = referenceFrom({
      vouchRows: [{ did: 'did:plc:a', vouches: 2 }],
      circleDids: ['did:plc:c'],
    });
    expect(ref.neighbourhood.has('did:plc:a')).toBe(true);
    expect(ref.circle.has('did:plc:c')).toBe(true);
  });
});

describe('nextAction', () => {
  const at = (o) => nextAction({ pending: 0, vouches: 1, ageDays: 0, ...o });

  it('collects while any member is unread', () => {
    expect(at({ pending: 5, vouches: 0 })).toBe('collect');
    expect(at({ pending: 1, vouches: 73215 })).toBe('collect');
  });

  it('finalises a snapshot that is collected but not aggregated', () => {
    // The bug: this state answered `idle` with "0 scored", which reads as
    // finished. Every member was read, no vouch rows existed, and nothing
    // would ever write them.
    expect(at({ pending: 0, vouches: 0 })).toBe('finalise');
  });

  it('is idle only once aggregated AND fresh', () => {
    expect(at({ pending: 0, vouches: 73215, ageDays: 1 })).toBe('idle');
  });

  it('rebuilds when a finalised snapshot ages out', () => {
    expect(at({ pending: 0, vouches: 73215, ageDays: 8 })).toBe('start');
  });

  it('does not rebuild an unaggregated snapshot just because it is old', () => {
    // Finishing the one in hand beats throwing away 173,649 staged edges.
    expect(at({ pending: 0, vouches: 0, ageDays: 30 })).toBe('finalise');
  });

  it('starts when asked, or when there is nothing yet', () => {
    expect(at({ restart: true, vouches: 73215 })).toBe('start');
    expect(at({ exists: false })).toBe('start');
  });
});
