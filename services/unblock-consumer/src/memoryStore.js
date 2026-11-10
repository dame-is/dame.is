// The store's transaction interface over Maps.
//
// This is what fold.js is tested against on a Node without node:sqlite (CI
// runs Node 20), and the reference for what store.js has to do: the two are
// run through the same scenarios in store.test.js wherever SQLite is there to
// run them. Nothing in production imports it.

import { fold, newCounters } from './fold.js';

const key = (a, b) => `${a}\n${b}`;

export function memoryStore() {
  const blocks = new Map(); // key(blocker, rkey) -> { blocker, rkey, subject, seen }
  const unblocks = new Map(); // key(subject, blocker) -> { subject, blocker, blockedAt, unblockedAt }
  const gone = new Map(); // did -> when it was deleted
  let outbox = [];
  let nextId = 1;
  const state = {
    cursor: null,
    startedAt: null,
    lastEventAt: null,
    live: 0,
    counters: newCounters(),
  };

  const tx = {
    getBlock(blocker, rkey) {
      const row = blocks.get(key(blocker, rkey));
      return row ? { subject: row.subject, seen: row.seen } : null;
    },
    insertBlock(blocker, rkey, subject, seen) {
      blocks.set(key(blocker, rkey), { blocker, rkey, subject, seen });
      state.live += 1;
    },
    updateBlock(blocker, rkey, subject, seen) {
      blocks.set(key(blocker, rkey), { blocker, rkey, subject, seen });
    },
    deleteBlock(blocker, rkey) {
      if (blocks.delete(key(blocker, rkey))) state.live -= 1;
    },
    blocksStill(blocker, subject) {
      for (const row of blocks.values()) {
        if (row.blocker === blocker && row.subject === subject) return true;
      }
      return false;
    },
    deleteBlocksBy(blocker) {
      let n = 0;
      for (const [k, row] of blocks) {
        if (row.blocker === blocker) {
          blocks.delete(k);
          n += 1;
        }
      }
      state.live -= n;
      return n;
    },
    hasUnblock(subject, blocker) {
      return unblocks.has(key(subject, blocker));
    },
    putUnblock(subject, blocker, blockedAt, unblockedAt) {
      unblocks.set(key(subject, blocker), { subject, blocker, blockedAt, unblockedAt });
    },
    deleteUnblock(subject, blocker) {
      unblocks.delete(key(subject, blocker));
    },
    forgetUnblocks(did) {
      let n = 0;
      for (const [k, row] of unblocks) {
        if (row.subject === did || row.blocker === did) {
          unblocks.delete(k);
          n += 1;
        }
      }
      return n;
    },
    markGone(did, at) {
      gone.set(did, Math.max(at, gone.get(did) ?? at));
    },
    isGone(did) {
      return gone.has(did);
    },
    emit(op) {
      outbox.push({ id: nextId, op });
      nextId += 1;
    },
  };

  return {
    apply(events, cursor = null) {
      for (const event of events) {
        fold(tx, event, state.counters);
        if (state.startedAt == null || event.at < state.startedAt) state.startedAt = event.at;
        if (state.lastEventAt == null || event.at > state.lastEventAt) state.lastEventAt = event.at;
      }
      if (cursor != null) state.cursor = cursor;
    },
    state: () => structuredClone(state),
    blocks: () => [...blocks.values()],
    unblocks: () =>
      [...unblocks.values()].sort((a, b) => key(a.subject, a.blocker).localeCompare(key(b.subject, b.blocker))),
    outbox: (limit = 500) => outbox.slice(0, limit),
    outboxDepth: () => outbox.length,
    ack(id) {
      outbox = outbox.filter((row) => row.id > id);
    },
    close() {},
  };
}
