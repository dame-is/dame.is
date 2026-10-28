// The page-chunk recovery reload. A wrong answer either leaves a page broken
// until a manual reload, or reloads in a loop on a deploy that can't serve it.

import { describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_KEY, recoverFromChunkError } from './chunkRecovery.js';

function fakeStorage(items = {}) {
  const map = new Map(Object.entries(items));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    map,
  };
}

function fakeWin(href = 'https://dame.is/blogging?q=moth') {
  return { location: { href, replace: vi.fn() } };
}

describe('recoverFromChunkError', () => {
  it('reloads once onto a cache-busted URL and remembers the build it left', () => {
    const win = fakeWin();
    const storage = fakeStorage();
    expect(
      recoverFromChunkError({ win, storage, volatile: false, buildId: 'a' }),
    ).toBe(true);
    expect(win.location.replace).toHaveBeenCalledTimes(1);
    const url = new URL(win.location.replace.mock.calls[0][0]);
    expect(url.pathname).toBe('/blogging');
    expect(url.searchParams.get('q')).toBe('moth');
    expect(url.searchParams.has('_r')).toBe(true);
    expect(storage.map.get(CHUNK_RELOAD_KEY)).toBe('a');
  });

  it('waits on a reload already under way rather than giving up', () => {
    const win = fakeWin();
    const storage = fakeStorage();
    recoverFromChunkError({ win, storage, volatile: false, buildId: 'a' });
    expect(
      recoverFromChunkError({ win, storage, volatile: false, buildId: 'a' }),
    ).toBe(true);
    expect(win.location.replace).toHaveBeenCalledTimes(1);
  });

  it('gives up when a reload from this build already landed back on it', () => {
    const win = fakeWin();
    const storage = fakeStorage({ [CHUNK_RELOAD_KEY]: 'a' });
    expect(
      recoverFromChunkError({ win, storage, volatile: false, buildId: 'a' }),
    ).toBe(false);
    expect(win.location.replace).not.toHaveBeenCalled();
  });

  it('reloads again once the tab is running a newer build', () => {
    const win = fakeWin();
    const storage = fakeStorage({ [CHUNK_RELOAD_KEY]: 'a' });
    expect(
      recoverFromChunkError({ win, storage, volatile: false, buildId: 'b' }),
    ).toBe(true);
    expect(storage.map.get(CHUNK_RELOAD_KEY)).toBe('b');
  });

  it('never reloads when the guard could not survive the reload', () => {
    const win = fakeWin();
    expect(
      recoverFromChunkError({
        win,
        storage: fakeStorage(),
        volatile: true,
        buildId: 'a',
      }),
    ).toBe(false);
    expect(
      recoverFromChunkError({
        win,
        storage: null,
        volatile: false,
        buildId: 'a',
      }),
    ).toBe(false);
    expect(win.location.replace).not.toHaveBeenCalled();
  });
});
