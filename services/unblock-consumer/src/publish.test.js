import { describe, expect, it, vi } from 'vitest';
import { memoryStore } from './memoryStore.js';
import { createPublisher, statusBody } from './publish.js';

const A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'did:plc:cccccccccccccccccccccccc';
const T0 = 1_794_000_000;

const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** A store with three conclusions waiting: an unblock, another, and one taken back. */
function storeWithWork() {
  const store = memoryStore();
  store.apply([
    { type: 'put', did: A, rkey: 'r1', subject: B, at: T0 },
    { type: 'delete', did: A, rkey: 'r1', at: T0 + 100 },
    { type: 'put', did: C, rkey: 'r1', subject: B, at: T0 },
    { type: 'delete', did: C, rkey: 'r1', at: T0 + 200 },
    { type: 'put', did: A, rkey: 'r2', subject: B, at: T0 + 300 },
  ]);
  return store;
}

describe('sending the outbox on', () => {
  it('sends what is waiting in order, with the status, and lets go of it once it is taken', async () => {
    const store = storeWithWork();
    const rpc = vi.fn().mockResolvedValue(3);
    const publisher = createPublisher({ store, rpc, logger: quiet });

    expect(await publisher.tick(1_000_000)).toBe(3);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('ingest');
    expect(args.ops.map((op) => op.op)).toEqual(['unblock', 'unblock', 'reblock']);
    expect(args.ops[0]).toEqual({ op: 'unblock', subject: B, blocker: A, blockedAt: T0, unblockedAt: T0 + 100 });
    expect(args.status).toMatchObject({ deletesSeen: 2, deletesPlaced: 2, blocksHeld: 1 });
    expect(store.outbox()).toEqual([]);
    expect(publisher.sent()).toBe(3);
  });

  it('keeps everything when Supabase refuses, and sends the same batch again later', async () => {
    const store = storeWithWork();
    const rpc = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue(3);
    const publisher = createPublisher({ store, rpc, logger: quiet });

    expect(await publisher.tick(1_000_000)).toBe(-1);
    expect(store.outboxDepth()).toBe(3);
    expect(publisher.failing()).toBe(true);

    // Backing off: a tick that comes too soon doesn't even ask.
    expect(await publisher.tick(1_000_500)).toBe(-1);
    expect(rpc).toHaveBeenCalledTimes(1);

    expect(await publisher.tick(1_010_000)).toBe(3);
    expect(rpc.mock.calls[1][1].ops).toEqual(rpc.mock.calls[0][1].ops);
    expect(store.outbox()).toEqual([]);
    expect(publisher.failing()).toBe(false);
  });

  it('waits longer each time it is refused, up to a limit', async () => {
    const store = storeWithWork();
    const rpc = vi.fn().mockRejectedValue(new Error('no schema yet'));
    const publisher = createPublisher({ store, rpc, logger: quiet, maxBackoffMs: 60_000 });

    // Two seconds, then double each time, held at the limit.
    let now = 0;
    for (const wait of [2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]) {
      const asked = rpc.mock.calls.length;
      await publisher.tick(now);
      expect(rpc.mock.calls.length).toBe(asked + 1);
      // A moment too soon, it doesn't ask.
      await publisher.tick(now + wait - 1);
      expect(rpc.mock.calls.length).toBe(asked + 1);
      now += wait;
    }
    // Nothing was let go of in all that.
    expect(store.outboxDepth()).toBe(3);
  });

  it('sends in batches, never more than it was told to at once', async () => {
    const store = storeWithWork();
    const rpc = vi.fn().mockResolvedValue(0);
    const publisher = createPublisher({ store, rpc, logger: quiet, batch: 2 });

    expect(await publisher.tick(1_000_000)).toBe(2);
    expect(store.outbox().map((row) => row.op.op)).toEqual(['reblock']);
    expect(await publisher.tick(1_005_000)).toBe(1);
    expect(store.outbox()).toEqual([]);
  });

  it('still sends the status when there is nothing else to say, but not every time', async () => {
    const store = memoryStore();
    store.apply([{ type: 'put', did: A, rkey: 'r1', subject: B, at: T0 }]);
    const rpc = vi.fn().mockResolvedValue(0);
    const publisher = createPublisher({ store, rpc, logger: quiet, statusMs: 60_000 });

    expect(await publisher.tick(1_000_000)).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ ops: [], status: { blocksHeld: 1 } });

    expect(await publisher.tick(1_005_000)).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(1);

    expect(await publisher.tick(1_061_000)).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('doesn’t start a second send while one is in flight', async () => {
    const store = storeWithWork();
    let release;
    const rpc = vi.fn().mockReturnValue(new Promise((resolve) => (release = resolve)));
    const publisher = createPublisher({ store, rpc, logger: quiet });

    const first = publisher.tick(1_000_000);
    expect(await publisher.tick(1_000_001)).toBe(-1);
    release(3);
    expect(await first).toBe(3);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('what the tracker says about itself', () => {
  it('dates everything in ISO and reports how much it could place', () => {
    expect(
      statusBody({
        startedAt: T0,
        horizon: T0 + 86_400,
        lastEventAt: T0 + 2 * 86_400,
        live: 480_000,
        counters: { deletes: 100, placed: 7, duplicate: 2 },
      }),
    ).toEqual({
      startedAt: new Date(T0 * 1000).toISOString(),
      horizonAt: new Date((T0 + 86_400) * 1000).toISOString(),
      lastEventAt: new Date((T0 + 2 * 86_400) * 1000).toISOString(),
      blocksHeld: 480_000,
      deletesSeen: 100,
      // The seven that became unblocks and the two whose subject it knew but
      // which undid nothing.
      deletesPlaced: 9,
    });
  });

  it('has nothing to date before the first event', () => {
    const blank = { startedAt: null, horizon: null, lastEventAt: null, live: 0, counters: { deletes: 0, placed: 0, duplicate: 0 } };
    expect(statusBody(blank)).toMatchObject({
      startedAt: null,
      horizonAt: null,
      lastEventAt: null,
    });
  });
});
