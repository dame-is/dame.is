import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fetchChromeSeed, fetchSnapshot, mergeByKey } from './snapshot.js';

// fetchSnapshot's reads are held at module level, so each test asks for a
// snapshot name of its own.

const json = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchSnapshot', () => {
  it('shares one request and one parse between concurrent callers', async () => {
    const fetchMock = vi.fn(async () => json([{ uri: 'at://a' }]));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b, c] = await Promise.all([
      fetchSnapshot('shared'),
      fetchSnapshot('shared'),
      fetchSnapshot('shared'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/data/shared.json');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('keeps a read for a few minutes, then reads again', async () => {
    const fetchMock = vi.fn(async () => json({ v: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSnapshot('kept');
    vi.advanceTimersByTime(4 * 60_000);
    await fetchSnapshot('kept');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2 * 60_000);
    await fetchSnapshot('kept');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forgets a miss, so the next caller tries again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ found: true }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchSnapshot('missing')).toBeNull();
    expect(await fetchSnapshot('missing')).toBeNull();
    expect(await fetchSnapshot('missing')).toEqual({ found: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('a read that never answers', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  });

  /** A fetch that only ever settles by being aborted. */
  const hangingFetch = () =>
    vi.fn(
      (url, { signal } = {}) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

  it('is given up as a miss after 20s, and the next caller asks again', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const read = fetchSnapshot('hung');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await read).toBeNull();

    fetchMock.mockImplementationOnce(async () => json({ late: true }));
    expect(await fetchSnapshot('hung')).toEqual({ late: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never cuts off a body that is still arriving', async () => {
    let finish;
    const body = new Promise((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: () => body })),
    );
    const read = fetchSnapshot('slow-body');
    await vi.advanceTimersByTimeAsync(60_000);
    finish({ big: true });
    expect(await read).toEqual({ big: true });
  });
});

describe('fetchChromeSeed', () => {
  it('reads the one record from chrome.json, without the full file', async () => {
    const now = { uri: 'at://now/1', value: { text: 'hello' } };
    const fetchMock = vi.fn(async (url) =>
      url === '/data/chrome.json'
        ? json({ now, listening: null, state: null })
        : json([]),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchChromeSeed('now')).toEqual(now);
    expect(await fetchChromeSeed('listening')).toBeNull();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/data/chrome.json',
    ]);
  });

  it('falls back to the newest record of the full file without a chrome.json', async () => {
    // Past the keep window, so the chrome.json read above is let go.
    vi.setSystemTime(new Date('2026-10-27T12:10:00Z'));
    const newest = { uri: 'at://state/2', value: { heartRate: 61 } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url === '/data/state.json'
          ? json([newest, { uri: 'at://state/1' }])
          : { ok: false, status: 404 },
      ),
    );
    expect(await fetchChromeSeed('state')).toEqual(newest);
  });
});

describe('mergeByKey', () => {
  it('prefers live items and keeps newest first', () => {
    const seed = [
      { id: 'a', createdAt: '2026-01-01T00:00:00Z', v: 'seed' },
      { id: 'b', createdAt: '2026-01-03T00:00:00Z' },
    ];
    const live = [{ id: 'a', createdAt: '2026-01-01T00:00:00Z', v: 'live' }];
    const merged = mergeByKey(seed, live, (i) => i.id);
    expect(merged.map((i) => i.id)).toEqual(['b', 'a']);
    expect(merged[1].v).toBe('live');
  });
});
