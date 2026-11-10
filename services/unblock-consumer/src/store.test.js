import { describe, expect, it } from 'vitest';
import { memoryStore } from './memoryStore.js';
import { openStore, sqliteAvailable } from './store.js';

// Every rule in fold.js is run twice: over Maps, which works on any Node, and
// over the SQLite store wherever node:sqlite exists (Node 22.5+; CI is on 20,
// where those runs are skipped and say so).
const HAS_SQLITE = await sqliteAvailable();

const A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'did:plc:cccccccccccccccccccccccc';
const WEB = 'did:web:example.com';

const T0 = 1_794_000_000;
const DAY = 86_400;

const put = (did, rkey, subject, at) => ({ type: 'put', did, rkey, subject, at });
const del = (did, rkey, at) => ({ type: 'delete', did, rkey, at });
const gone = (did, at) => ({ type: 'gone', did, at });

const BACKENDS = [
  { name: 'in memory', open: async () => memoryStore(), run: true },
  { name: 'in SQLite', open: async () => openStore({ file: ':memory:' }), run: HAS_SQLITE },
];

for (const backend of BACKENDS) {
  describe.skipIf(!backend.run)(`the rules, ${backend.name}`, () => {
    it('records an unblock when a block it saw made is deleted', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0)]);
      expect(store.unblocks()).toEqual([]);
      store.apply([del(A, 'r1', T0 + 3 * DAY)]);

      expect(store.unblocks()).toEqual([
        { subject: B, blocker: A, blockedAt: T0, unblockedAt: T0 + 3 * DAY },
      ]);
      expect(store.blocks()).toEqual([]);
      expect(store.outbox().map((row) => row.op)).toEqual([
        { op: 'unblock', subject: B, blocker: A, blockedAt: T0, unblockedAt: T0 + 3 * DAY },
      ]);
      const { counters, live } = store.state();
      expect(counters).toMatchObject({ blocks: 1, deletes: 1, placed: 1, unplaced: 0 });
      expect(live).toBe(0);
      store.close();
    });

    it('can’t place a delete of a block it never saw, and says so in the count', async () => {
      const store = await backend.open();
      store.apply([del(A, 'made-before-tracking', T0)]);
      expect(store.unblocks()).toEqual([]);
      expect(store.outbox()).toEqual([]);
      expect(store.state().counters).toMatchObject({ deletes: 1, placed: 0, unplaced: 1 });
      store.close();
    });

    it('takes an unblock back when the same account blocks them again', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0), del(A, 'r1', T0 + DAY)]);
      expect(store.unblocks()).toHaveLength(1);

      store.apply([put(A, 'r2', B, T0 + 2 * DAY)]);
      expect(store.unblocks()).toEqual([]);
      expect(store.outbox().map((row) => row.op.op)).toEqual(['unblock', 'reblock']);
      expect(store.state().counters.reblocked).toBe(1);

      // And a second change of heart is a new unblock, dated from the new block.
      store.apply([del(A, 'r2', T0 + 5 * DAY)]);
      expect(store.unblocks()).toEqual([
        { subject: B, blocker: A, blockedAt: T0 + 2 * DAY, unblockedAt: T0 + 5 * DAY },
      ]);
      store.close();
    });

    it('keeps one line per pair however many times it happens', async () => {
      const store = await backend.open();
      const events = [];
      for (let i = 0; i < 5; i += 1) {
        events.push(put(A, `r${i}`, B, T0 + i * 10), del(A, `r${i}`, T0 + i * 10 + 5));
      }
      store.apply(events);
      expect(store.unblocks()).toEqual([
        { subject: B, blocker: A, blockedAt: T0 + 40, unblockedAt: T0 + 45 },
      ]);
      store.close();
    });

    it('leaves the first sighting alone when an event is delivered twice', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0)]);
      store.apply([put(A, 'r1', B, T0 + 500)]);
      expect(store.blocks()).toEqual([{ blocker: A, rkey: 'r1', subject: B, seen: T0 }]);
      expect(store.state().counters.blocks).toBe(1);
      expect(store.state().live).toBe(1);

      store.apply([del(A, 'r1', T0 + DAY)]);
      store.apply([del(A, 'r1', T0 + DAY)]);
      expect(store.unblocks()).toHaveLength(1);
      expect(store.outbox()).toHaveLength(1);
      // The repeat leaves one trace: a delete it had nothing left to place.
      expect(store.state().counters).toMatchObject({ deletes: 2, placed: 1, unplaced: 1 });
      store.close();
    });

    it('counts nothing as undone while a second record still blocks the same person', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0), put(A, 'r2', B, T0 + 10)]);
      store.apply([del(A, 'r1', T0 + DAY)]);
      expect(store.unblocks()).toEqual([]);
      expect(store.outbox()).toEqual([]);
      expect(store.state().counters).toMatchObject({ deletes: 1, placed: 0, duplicate: 1 });

      store.apply([del(A, 'r2', T0 + 2 * DAY)]);
      expect(store.unblocks()).toHaveLength(1);
      store.close();
    });

    it('reads a record rewritten to name someone else as one block ending and another beginning', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0)]);
      store.apply([put(A, 'r1', C, T0 + DAY)]);

      expect(store.blocks()).toEqual([{ blocker: A, rkey: 'r1', subject: C, seen: T0 + DAY }]);
      expect(store.unblocks()).toEqual([
        { subject: B, blocker: A, blockedAt: T0, unblockedAt: T0 + DAY },
      ]);
      expect(store.state().live).toBe(1);
      // Not a delete, so it is not counted among the deletes that were placed.
      expect(store.state().counters).toMatchObject({ deletes: 0, placed: 0, rewritten: 1, blocks: 2 });
      store.close();
    });

    it('keeps accounts apart: who blocked whom is never crossed', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0), put(B, 'r1', A, T0), put(C, 'r1', B, T0)]);
      store.apply([del(B, 'r1', T0 + DAY)]);
      expect(store.unblocks()).toEqual([
        { subject: A, blocker: B, blockedAt: T0, unblockedAt: T0 + DAY },
      ]);
      expect(store.blocks()).toHaveLength(2);
      store.close();
    });

    it('holds a DID that is not a did:plc as faithfully as one that is', async () => {
      const store = await backend.open();
      store.apply([put(WEB, 'r1', A, T0), put(A, 'r1', WEB, T0)]);
      store.apply([del(WEB, 'r1', T0 + DAY), del(A, 'r1', T0 + DAY)]);
      expect(store.unblocks()).toEqual([
        { subject: A, blocker: WEB, blockedAt: T0, unblockedAt: T0 + DAY },
        { subject: WEB, blocker: A, blockedAt: T0, unblockedAt: T0 + DAY },
      ]);
      store.close();
    });

    it('never dates an unblock before its block', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0), del(A, 'r1', T0 - 30)]);
      expect(store.unblocks()).toEqual([{ subject: B, blocker: A, blockedAt: T0, unblockedAt: T0 }]);
      store.close();
    });

    it('lets a deleted account’s blocks go without calling them unblocks', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0), put(A, 'r2', C, T0), put(B, 'r1', C, T0)]);
      store.apply([gone(A, T0 + DAY)]);

      expect(store.blocks()).toEqual([{ blocker: B, rkey: 'r1', subject: C, seen: T0 }]);
      expect(store.unblocks()).toEqual([]);
      expect(store.outbox()).toEqual([]);
      expect(store.state().live).toBe(1);
      expect(store.state().counters.gone).toBe(1);
      store.close();
    });

    it('forgets what it said about a deleted account, on both sides', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0), put(B, 'r1', C, T0), put(C, 'r1', A, T0)]);
      store.apply([del(A, 'r1', T0 + 1), del(B, 'r1', T0 + 2), del(C, 'r1', T0 + 3)]);
      expect(store.unblocks()).toHaveLength(3);

      store.apply([gone(B, T0 + DAY)]);
      // B as the one unblocked (by A) and B as the one who unblocked (C).
      expect(store.unblocks()).toEqual([
        { subject: A, blocker: C, blockedAt: T0, unblockedAt: T0 + 3 },
      ]);
      expect(store.outbox().at(-1).op).toEqual({ op: 'forget', did: B });
      store.close();
    });

    it('says nothing about an account that deletes itself with nothing here', async () => {
      const store = await backend.open();
      store.apply([gone(A, T0)]);
      expect(store.outbox()).toEqual([]);
      expect(store.state().counters.gone).toBe(0);
      store.close();
    });

    it('remembers where the stream was and when the index begins', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0 + 50), put(A, 'r2', C, T0)], 1794000050000000);
      expect(store.state()).toMatchObject({
        cursor: 1794000050000000,
        startedAt: T0,
        lastEventAt: T0 + 50,
      });
      store.close();
    });

    it('hands the outbox over in order and lets go of what was sent', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0), del(A, 'r1', T0 + 1), put(A, 'r2', B, T0 + 2)]);
      const waiting = store.outbox();
      expect(waiting.map((row) => row.op.op)).toEqual(['unblock', 'reblock']);
      expect(store.outboxDepth()).toBe(2);

      store.ack(waiting[0].id);
      expect(store.outbox().map((row) => row.op.op)).toEqual(['reblock']);
      store.ack(waiting[1].id);
      expect(store.outbox()).toEqual([]);
      store.close();
    });
  });
}

describe.skipIf(!HAS_SQLITE)('the SQLite store', () => {
  it('picks up where it left off when reopened', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unblock-store-'));
    const file = path.join(dir, 'index.db');
    try {
      const first = await openStore({ file });
      first.apply([put(A, 'r1', B, T0)], 111);
      first.close();

      const second = await openStore({ file });
      expect(second.state()).toMatchObject({ cursor: 111, live: 1, startedAt: T0, horizon: T0 });
      second.apply([del(A, 'r1', T0 + DAY)], 222);
      expect(second.unblocks()).toHaveLength(1);
      expect(second.state().cursor).toBe(222);
      second.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('undoes the whole batch, cursor included, when one event in it fails', async () => {
    const store = await openStore({ file: ':memory:' });
    store.apply([put(A, 'r1', B, T0)], 111);
    // A subject that can't be bound stands in for any failure mid-batch.
    expect(() => store.apply([put(A, 'r2', C, T0 + 1), put(A, 'r3', Symbol('bad'), T0 + 2)], 222)).toThrow();
    expect(store.blocks()).toHaveLength(1);
    expect(store.state()).toMatchObject({ cursor: 111, live: 1 });
    expect(store.state().counters.blocks).toBe(1);
    store.close();
  });

  it('reads only so many of an account’s blocks when checking for a second one', async () => {
    // The known cost of the bound: an account with more blocks than it reads
    // can have a second record on the same person go unseen. Three is the
    // bound here; in production it is five thousand.
    const store = await openStore({ file: ':memory:', duplicateScan: 3 });
    store.apply([
      put(A, 'a1', 'did:plc:dddddddddddddddddddddddd', T0),
      put(A, 'a2', 'did:plc:eeeeeeeeeeeeeeeeeeeeeeee', T0),
      put(A, 'a3', 'did:plc:ffffffffffffffffffffffff', T0),
      // Two records on B, both sorting after the three the check will read.
      put(A, 'z1', B, T0),
      put(A, 'z2', B, T0),
    ]);
    store.apply([del(A, 'z1', T0 + DAY)]);
    expect(store.state().counters).toMatchObject({ duplicate: 0, placed: 1 });
    store.close();

    // Within the bound, the second record is found.
    const roomy = await openStore({ file: ':memory:', duplicateScan: 5 });
    roomy.apply([
      put(A, 'a1', 'did:plc:dddddddddddddddddddddddd', T0),
      put(A, 'a2', 'did:plc:eeeeeeeeeeeeeeeeeeeeeeee', T0),
      put(A, 'a3', 'did:plc:ffffffffffffffffffffffff', T0),
      put(A, 'z1', B, T0),
      put(A, 'z2', B, T0),
    ]);
    roomy.apply([del(A, 'z1', T0 + DAY)]);
    expect(roomy.state().counters).toMatchObject({ duplicate: 1, placed: 0 });
    roomy.close();
  });

  describe('dropping the oldest to stay inside its ceiling', () => {
    /** `n` blocks by `n` accounts spread over the key space, all seen at `at`. */
    function manyBlocks(n, at, tag) {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
      const out = [];
      for (let i = 0; i < n; i += 1) {
        let id = '';
        let x = i * 2654435761 + 12345;
        for (let c = 0; c < 24; c += 1) {
          id += alphabet[Math.abs(x) % 32];
          x = Math.floor(x / 7) + i * 31 + c;
        }
        out.push(put(`did:plc:${id}`, `${tag}${i}`, B, at));
      }
      return out;
    }

    function sweepToEnd(store, now) {
      let steps = 0;
      let removed = 0;
      for (;;) {
        const step = store.tend(now);
        steps += 1;
        if (step.did !== 'sweep') return { steps, removed, last: step };
        removed += step.removed;
        if (step.finished) return { steps, removed, last: step };
        if (steps > 1000) throw new Error('a sweep that never ends');
      }
    }

    it('does nothing while there is no limit to keep to', async () => {
      const store = await openStore({ file: ':memory:' });
      store.apply(manyBlocks(200, T0, 'a'));
      expect(store.tend(T0 + 400 * DAY)).toEqual({ did: 'idle' });
      expect(store.state().live).toBe(200);
      store.close();
    });

    it('drops blocks past the age limit, a slice at a time, and moves the horizon', async () => {
      const store = await openStore({ file: ':memory:', retentionDays: 30 });
      store.apply([...manyBlocks(300, T0, 'old'), put(WEB, 'old-web', B, T0)]);
      store.apply(manyBlocks(300, T0 + 40 * DAY, 'new'));
      expect(store.state().horizon).toBe(T0);

      const now = T0 + 45 * DAY;
      const first = store.tend(now);
      expect(first.did).toBe('sweep');
      expect(first.finished).toBe(false);

      const { steps } = sweepToEnd(store, now);
      // 257 slices in all: one for DIDs kept as text, 256 for the rest.
      expect(steps + 1).toBe(257);
      const state = store.state();
      expect(state.live).toBe(300);
      expect(state.pruned).toBe(301);
      expect(state.horizon).toBe(now - 30 * DAY);
      expect(state.sweep).toBeNull();
      expect(store.blocks().every((row) => row.seen === T0 + 40 * DAY)).toBe(true);

      // An unblock of one of the dropped blocks can no longer be placed.
      store.apply([del(WEB, 'old-web', now)]);
      expect(store.state().counters.unplaced).toBe(1);
      // Nothing more to do until the horizon is an hour behind again.
      expect(store.tend(now + 60)).toEqual({ did: 'idle' });
      store.close();
    });

    it('carries on from the slice it reached if it is stopped mid-sweep', async () => {
      const os = await import('node:os');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unblock-sweep-'));
      const file = path.join(dir, 'index.db');
      try {
        const first = await openStore({ file, retentionDays: 30 });
        first.apply(manyBlocks(300, T0, 'old'));
        const now = T0 + 45 * DAY;
        for (let i = 0; i < 100; i += 1) first.tend(now);
        const midway = first.state();
        expect(midway.sweep.next).toBe(100);
        first.close();

        const second = await openStore({ file, retentionDays: 30 });
        expect(second.state().sweep).toEqual(midway.sweep);
        sweepToEnd(second, now);
        expect(second.state().live).toBe(0);
        expect(second.state().pruned).toBe(300);
        second.close();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('moves the horizon forward when the index outgrows its ceiling', async () => {
      const store = await openStore({ file: ':memory:', maxBytes: 600_000 });
      // Ten days of blocks at an even rate, well past 600 kB.
      for (let day = 0; day < 10; day += 1) {
        store.apply(manyBlocks(3000, T0 + day * DAY, `d${day}-`));
      }
      const before = store.size().usedBytes;
      expect(before).toBeGreaterThan(600_000);

      let now = T0 + 10 * DAY;
      // Each sweep is an estimate, corrected by the next.
      for (let round = 0; round < 12 && store.size().usedBytes > 600_000; round += 1) {
        sweepToEnd(store, now);
        now += 60;
      }
      const state = store.state();
      expect(store.size().usedBytes).toBeLessThanOrEqual(600_000);
      expect(state.horizon).toBeGreaterThan(T0);
      expect(state.live).toBeLessThan(30_000);
      // What is left is the newest of it.
      expect(store.blocks().every((row) => row.seen >= state.horizon)).toBe(true);
      // And it stopped dropping once it fit: most of the index is still there.
      expect(state.live).toBeGreaterThan(3000);
      store.close();
    });

    it('hands the space back to the disk when the ceiling is lowered', async () => {
      const os = await import('node:os');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unblock-shrink-'));
      const file = path.join(dir, 'index.db');
      try {
        const roomy = await openStore({ file });
        for (let day = 0; day < 10; day += 1) roomy.apply(manyBlocks(3000, T0 + day * DAY, `d${day}-`));
        roomy.close();
        const before = fs.statSync(file).size;
        expect(before).toBeGreaterThan(1_500_000);

        // The same file, reopened with a ceiling a third of its size.
        const tight = await openStore({ file, maxBytes: 600_000, vacuumAtBytes: 100_000 });
        let now = T0 + 10 * DAY;
        let vacuums = 0;
        for (let step = 0; step < 6000; step += 1) {
          const did = tight.tend(now).did;
          if (did === 'vacuum') vacuums += 1;
          if (did === 'idle') break;
          now += 1;
        }
        expect(vacuums).toBeGreaterThan(0);
        expect(tight.size().usedBytes).toBeLessThanOrEqual(600_000);
        tight.close();
        // The file itself is smaller, not merely emptier.
        expect(fs.statSync(file).size).toBeLessThan(before * 0.6);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('keeps the last hour whatever the ceiling says', async () => {
      const store = await openStore({ file: ':memory:', maxBytes: 1 });
      store.apply(manyBlocks(500, T0, 'a'));
      expect(store.tend(T0 + 1800)).toEqual({ did: 'idle' });
      expect(store.state().live).toBe(500);
      store.close();
    });
  });
});
