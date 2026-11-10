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

    it('doesn’t call it an unblock when the account that was blocked has since deleted itself', async () => {
      // Other people's blocks on a deleted account are still in the index. One
      // being tidied away later is not somebody unblocking an account that no
      // longer exists.
      const store = await backend.open();
      store.apply([put(A, 'r1', C, T0), put(B, 'r1', C, T0)]);
      store.apply([gone(C, T0 + DAY)]);
      store.apply([del(A, 'r1', T0 + 2 * DAY)]);

      expect(store.unblocks()).toEqual([]);
      expect(store.outbox()).toEqual([]);
      expect(store.state().counters).toMatchObject({ deletes: 1, placed: 0, moot: 1 });
      // The same goes for a record rewritten away from it.
      store.apply([put(B, 'r1', A, T0 + 3 * DAY)]);
      expect(store.unblocks()).toEqual([]);
      store.close();
    });

    it('ends in the same place when a deletion and what follows it are delivered again', async () => {
      const once = await backend.open();
      const twice = await backend.open();
      const before = [put(A, 'r1', C, T0), put(C, 'r1', B, T0), del(C, 'r1', T0 + 5)];
      const after = [gone(C, T0 + DAY), del(A, 'r1', T0 + 2 * DAY)];
      once.apply([...before, ...after]);
      twice.apply([...before, ...after]);
      twice.apply(after);

      expect(twice.unblocks()).toEqual(once.unblocks());
      expect(twice.blocks()).toEqual(once.blocks());
      expect(once.unblocks()).toEqual([]);
      // Whatever was sent, nothing in it leaves C on the page.
      for (const store of [once, twice]) {
        const ops = store.outbox().map((row) => row.op);
        const last = ops.filter((op) => op.subject === C || op.blocker === C || op.did === C).at(-1);
        expect(last).toEqual({ op: 'forget', did: C });
      }
      once.close();
      twice.close();
    });

    it('ends a block when its record is rewritten to block nobody', async () => {
      const store = await backend.open();
      store.apply([put(A, 'r1', B, T0)]);
      store.apply([{ type: 'void', did: A, rkey: 'r1', at: T0 + DAY }]);

      expect(store.blocks()).toEqual([]);
      expect(store.unblocks()).toEqual([{ subject: B, blocker: A, blockedAt: T0, unblockedAt: T0 + DAY }]);
      // It was not a delete, and is not counted as one.
      expect(store.state().counters).toMatchObject({ deletes: 0, placed: 0, rewritten: 1 });
      expect(store.state().live).toBe(0);

      // One that never held a block is nothing at all.
      store.apply([{ type: 'void', did: A, rkey: 'never', at: T0 + DAY }]);
      expect(store.outbox()).toHaveLength(1);
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
    /**
     * `n` blocks by `n` accounts spread over the key space, all seen at `at`.
     * `salt` changes which accounts they are, so that each day can bring
     * mostly new people, as the network does.
     */
    function manyBlocks(n, at, tag, salt = 0) {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
      const out = [];
      for (let i = 0; i < n; i += 1) {
        let id = '';
        let x = (i + salt * 7919) * 2654435761 + 12345;
        for (let c = 0; c < 24; c += 1) {
          id += alphabet[Math.abs(x) % 32];
          x = Math.floor(x / 7) + (i + salt * 7919) * 31 + c;
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

    /** Tend until there is nothing left to do; how many sweeps that took. */
    function tendUntilIdle(store, now) {
      let sweeps = 0;
      let vacuums = 0;
      for (let step = 0; step < 100_000; step += 1) {
        const did = store.tend(now);
        if (did.did === 'idle') return { sweeps, vacuums };
        if (did.did === 'vacuum') vacuums += 1;
        if (did.did === 'sweep' && did.finished) sweeps += 1;
      }
      throw new Error('tending that never settles');
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
      // The 300 old ones, and the one whose DID is kept as text.
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

    it('stops remembering a deleted account once the index no longer reaches back to it', async () => {
      const store = await openStore({ file: ':memory:', retentionDays: 30 });
      store.apply([put(A, 'r1', C, T0), gone(C, T0 + DAY)]);
      // While it is remembered, a block on it ending is not an unblock.
      store.apply([del(A, 'r1', T0 + 2 * DAY)]);
      expect(store.state().counters.moot).toBe(1);

      // The horizon moves past the day it was deleted.
      store.apply(manyBlocks(50, T0 + 40 * DAY, 'new'));
      sweepToEnd(store, T0 + 45 * DAY);
      expect(store.state().horizon).toBeGreaterThan(T0 + DAY);

      // The same DID turning up again long after is an account like any other.
      store.apply([put(A, 'r2', C, T0 + 46 * DAY), del(A, 'r2', T0 + 47 * DAY)]);
      expect(store.unblocks()).toEqual([
        { subject: C, blocker: A, blockedAt: T0 + 46 * DAY, unblockedAt: T0 + 47 * DAY },
      ]);
      store.close();
    });

    it('works out how many blocks fit when the index reaches its ceiling, and drops the oldest past that', async () => {
      const store = await openStore({ file: ':memory:', maxBytes: 600_000 });
      // Ten days of blocks at an even rate, about three times what fits.
      for (let day = 0; day < 10; day += 1) {
        store.apply(manyBlocks(3000, T0 + day * DAY, `d${day}-`, day));
      }
      const before = store.size().usedBytes;
      expect(before).toBeGreaterThan(600_000 * 2);

      tendUntilIdle(store, T0 + 10 * DAY);
      const state = store.state();
      // About the share of them that the ceiling is of the size.
      const fits = 30_000 * (600_000 / before);
      expect(state.rowCeiling).toBeGreaterThan(fits * 0.8);
      expect(state.rowCeiling).toBeLessThan(fits * 1.2);
      expect(state.live).toBeLessThanOrEqual(state.rowCeiling);
      expect(state.live).toBeGreaterThan(state.rowCeiling * 0.8);
      // What is left is the newest of it.
      expect(state.horizon).toBeGreaterThan(T0);
      expect(store.blocks().every((row) => row.seen >= state.horizon)).toBe(true);
      // And the size came down with it, to somewhere near the ceiling.
      expect(store.size().usedBytes).toBeLessThan(600_000 * 1.25);
      store.close();
    });

    it('holds steady at its ceiling as blocks keep arriving, without chasing the size', async () => {
      // The failure this guards against: dropping old blocks frees almost no
      // pages, so a ceiling steered by bytes drops, sees no change, and drops
      // again, throwing away far more than it needed to.
      const MAX = 1_200_000;
      const PER_DAY = 2000;
      const store = await openStore({ file: ':memory:', maxBytes: MAX });
      const held = [];
      const used = [];
      const sweepsOn = [];
      for (let day = 0; day < 80; day += 1) {
        store.apply(manyBlocks(PER_DAY, T0 + day * DAY, `d${day}-`, day));
        const { sweeps } = tendUntilIdle(store, T0 + (day + 1) * DAY);
        sweepsOn.push(sweeps);
        held.push(store.state().live);
        used.push(store.size().usedBytes);
      }
      const reached = used.findIndex((bytes) => bytes >= MAX);
      expect(reached).toBeGreaterThan(3);
      expect(reached).toBeLessThan(40);

      // From a little after it first reaches the ceiling, to the end:
      const after = reached + 3;
      const heldAfter = held.slice(after);
      const usedAfter = used.slice(after);
      // it keeps about as many as fit, day after day, neither collapsing…
      expect(Math.min(...heldAfter)).toBeGreaterThan(held[reached] * 0.8);
      // …nor growing without limit;
      expect(Math.max(...heldAfter)).toBeLessThan(held[reached] * 1.1);
      // the size stays near the ceiling;
      expect(Math.max(...usedAfter)).toBeLessThan(MAX * 1.2);
      // and it takes a sweep or so a day to do it, not a run of them.
      expect(Math.max(...sweepsOn)).toBeLessThanOrEqual(3);
      store.close();
    });

    it('holds the same density when the ceiling is raised', async () => {
      const os = await import('node:os');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unblock-raise-'));
      const file = path.join(dir, 'index.db');
      try {
        const tight = await openStore({ file, maxBytes: 600_000 });
        for (let day = 0; day < 10; day += 1) tight.apply(manyBlocks(3000, T0 + day * DAY, `d${day}-`, day));
        tendUntilIdle(tight, T0 + 10 * DAY);
        const ceiling = tight.state().rowCeiling;
        tight.close();

        const roomy = await openStore({ file, maxBytes: 1_200_000 });
        expect(roomy.tend(T0 + 10 * DAY)).toEqual({ did: 'idle' });
        expect(roomy.state().rowCeiling).toBe(ceiling * 2);
        roomy.close();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('hands the space back to the disk when the ceiling is lowered', async () => {
      const os = await import('node:os');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unblock-shrink-'));
      const file = path.join(dir, 'index.db');
      try {
        const roomy = await openStore({ file });
        for (let day = 0; day < 10; day += 1) roomy.apply(manyBlocks(3000, T0 + day * DAY, `d${day}-`, day));
        roomy.close();
        const before = fs.statSync(file).size;
        expect(before).toBeGreaterThan(1_500_000);

        // The same file, reopened with a ceiling a third of its size.
        const tight = await openStore({ file, maxBytes: 600_000, vacuumAtBytes: 100_000 });
        const { vacuums } = tendUntilIdle(tight, T0 + 10 * DAY);
        expect(vacuums).toBeGreaterThan(0);
        expect(tight.state().live).toBeLessThan(30_000 * 0.5);
        expect(tight.size().usedBytes).toBeLessThan(600_000 * 1.25);
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
