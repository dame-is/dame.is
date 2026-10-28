import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { openAnalyticsStore, resetAnalyticsStore } from './analyticsStore.js';

// Just enough IndexedDB to drive an open from the outside: each open() hands
// back a request whose events the test fires.
function fakeIndexedDB() {
  const requests = [];
  const makeDb = () => ({
    objectStoreNames: { contains: () => true },
    closed: false,
    close() {
      this.closed = true;
    },
  });
  return {
    requests,
    open() {
      const req = { result: null, error: null };
      requests.push(req);
      return req;
    },
    succeed(req) {
      req.result = makeDb();
      req.onsuccess?.();
      return req.result;
    },
  };
}

let idb;

beforeEach(() => {
  vi.useFakeTimers();
  idb = fakeIndexedDB();
  vi.stubGlobal('indexedDB', idb);
  resetAnalyticsStore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetAnalyticsStore();
});

describe('openAnalyticsStore', () => {
  it('waits out another tab holding an older version instead of giving up', async () => {
    const opening = openAnalyticsStore();
    const [req] = idb.requests;
    req.onblocked();
    await vi.advanceTimersByTimeAsync(1_000);
    // The other tab lets go; the blocked open goes through.
    idb.succeed(req);
    const store = await opening;
    expect(store.persistent).toBe(true);
  });

  it('falls back for now when the block outlasts its wait, and tries again next time', async () => {
    const opening = openAnalyticsStore();
    const [first] = idb.requests;
    first.onblocked();
    await vi.advanceTimersByTimeAsync(5_000);
    const fallback = await opening;
    expect(fallback).toMatchObject({ persistent: false, blocked: true });

    // A late success on the abandoned request is closed, not kept.
    const late = idb.succeed(first);
    expect(late.closed).toBe(true);

    const retry = openAnalyticsStore();
    expect(idb.requests).toHaveLength(2);
    idb.succeed(idb.requests[1]);
    expect((await retry).persistent).toBe(true);
  });

  it('steps aside when a newer build asks to upgrade', async () => {
    const opening = openAnalyticsStore();
    const db = idb.succeed(idb.requests[0]);
    await opening;
    db.onversionchange();
    expect(db.closed).toBe(true);

    openAnalyticsStore();
    expect(idb.requests).toHaveLength(2);
  });
});
