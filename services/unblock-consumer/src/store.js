// The index, on disk: every block the service has seen made and not seen
// undone, the unblocks that came of them, and what is still waiting to be
// told to Supabase.
//
// SQLite, in a file beside the service, through Node's own `node:sqlite`. So
// this service has no dependencies either, and the one table that is too big
// to send anywhere never leaves the box.
//
// WHY THE BLOCKS STAY HERE. A delete names a repo and a record key and
// nothing else, so the only way to say who was unblocked is to have kept
// every block since. The network makes about 324,000 of them a day (measured
// over the week of 2026-11-03), against about 8,400 deletes. The blocks are
// working memory that only this process reads; the unblocks are the result,
// and small. The first lives here and the second is sent on (publish.js).
//
// THE INDEX IS BOUNDED BY SIZE, NOT BY HOPE. This box has gone down to a full
// disk once already. `maxBytes` is a ceiling on the pages in use: when the
// index reaches it, the oldest blocks are dropped to make room, and the date
// the index reaches back to (the horizon) moves forward. An unblock of a
// block older than the horizon can't be placed, and is counted as one that
// couldn't. So the knob is disk, and what it buys is how old a block can be
// and still have its unblock noticed. README.md has the measured exchange
// rate.
//
// THE CEILING IS KEPT IN BLOCKS, NOT BYTES. Dropping old blocks empties very
// few pages: an old block shares its page with newer ones from other
// accounts, so the page stays in use, lighter. Steering by bytes therefore
// drops blocks, sees the size has not moved, and drops more; measured, it
// threw away 18% of the index to get 2% under. So the first time the size
// reaches the ceiling, the number of blocks that fit is worked out once, and
// from then on that number is what is held to. It is nudged by a few percent
// at the end of a sweep if the size has drifted well past the ceiling or well
// under it. The file can therefore sit around 10% over the number given.

import fs from 'node:fs';
import path from 'node:path';
import { fold, newCounters } from './fold.js';
import { packDid, unpackDid } from './dids.js';

// The accounts are spread evenly over the first byte of a packed DID, so 256
// equal slices of the key space are 256 roughly equal slices of the table.
// One more holds the handful of DIDs stored as text.
const SLICES = 257;

// Dropping the oldest blocks is a scan, and the table is gigabytes. A sweep
// takes it a slice at a time so no single step holds the event loop for long.
const MIN_KEPT_SECONDS = 3600;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS block (
    blocker NOT NULL,
    rkey    TEXT NOT NULL,
    subject NOT NULL,
    seen    INTEGER NOT NULL,
    PRIMARY KEY (blocker, rkey)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS unblock (
    subject      NOT NULL,
    blocker      NOT NULL,
    blocked_at   INTEGER NOT NULL,
    unblocked_at INTEGER NOT NULL,
    PRIMARY KEY (subject, blocker)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS unblock_blocker ON unblock (blocker);

  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    op TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gone (
    did NOT NULL PRIMARY KEY,
    at  INTEGER NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
`;

async function loadSqlite() {
  try {
    return await import('node:sqlite');
  } catch (err) {
    throw new Error(
      `node:sqlite is not available on Node ${process.versions.node}. It needs Node 22.5 or later, ` +
        `and before 22.13 the --experimental-sqlite flag as well (the unit file passes it). ` +
        `(${err.message})`,
    );
  }
}

/** Whether this Node can open a store at all. For the tests. */
export async function sqliteAvailable() {
  try {
    await import('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

function freshState() {
  return {
    // Where to resume the stream.
    cursor: null,
    // Jetstream's clock on the earliest and latest events applied.
    startedAt: null,
    lastEventAt: null,
    // The oldest block the index still promises to hold. Starts where the
    // index starts and moves forward as the oldest are dropped.
    horizon: null,
    // Rows in `block`, kept by counting: asking SQLite would be a full scan.
    live: 0,
    counters: newCounters(),
    // A sweep in progress: { cutoff, next } or null.
    sweep: null,
    pruned: 0,
    // How many blocks fit under the ceiling, once that has been measured, and
    // the ceiling it was measured for. Null while the index is still under.
    rowCeiling: null,
    ceilingFor: null,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.file          path to the database, or ':memory:'
 * @param {number} [opts.maxBytes]    ceiling on pages in use; 0 for none
 * @param {number} [opts.retentionDays]  drop blocks older than this; 0 for no age limit
 * @param {number} [opts.cacheKb]     SQLite's page cache
 * @param {number} [opts.duplicateScan]  how many of an account's blocks to
 *                                    read when checking for a second block on
 *                                    the same person
 * @param {number} [opts.vacuumAtBytes]  how much free space may pile up in the
 *                                    file before it is handed back to the disk
 */
export async function openStore({
  file,
  maxBytes = 0,
  retentionDays = 0,
  cacheKb = 8000,
  duplicateScan = 5000,
  vacuumAtBytes = 64 * 1024 * 1024,
} = {}) {
  const { DatabaseSync } = await loadSqlite();
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);

  // auto_vacuum only takes on a database with no tables yet, so it goes
  // first. It is what lets a lowered ceiling hand pages back to the disk
  // without a VACUUM, which would need the file's size again in free space.
  db.exec('PRAGMA auto_vacuum = INCREMENTAL');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(`PRAGMA cache_size = -${Math.max(1000, Math.floor(cacheKb))}`);
  db.exec('PRAGMA temp_store = MEMORY');
  db.exec(SCHEMA);

  const q = {
    getBlock: db.prepare('SELECT subject, seen FROM block WHERE blocker = ? AND rkey = ?'),
    insertBlock: db.prepare('INSERT INTO block (blocker, rkey, subject, seen) VALUES (?, ?, ?, ?)'),
    updateBlock: db.prepare('UPDATE block SET subject = ?, seen = ? WHERE blocker = ? AND rkey = ?'),
    deleteBlock: db.prepare('DELETE FROM block WHERE blocker = ? AND rkey = ?'),
    // Bounded on purpose. Without the inner LIMIT, an account undoing a
    // hundred thousand blocks would read all hundred thousand for each one.
    blocksStill: db.prepare(
      'SELECT 1 AS hit FROM (SELECT subject FROM block WHERE blocker = ? LIMIT ?) WHERE subject = ? LIMIT 1',
    ),
    deleteBlocksBy: db.prepare('DELETE FROM block WHERE blocker = ?'),
    hasUnblock: db.prepare('SELECT 1 AS hit FROM unblock WHERE subject = ? AND blocker = ?'),
    putUnblock: db.prepare(
      `INSERT INTO unblock (subject, blocker, blocked_at, unblocked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (subject, blocker) DO UPDATE
       SET blocked_at = excluded.blocked_at, unblocked_at = excluded.unblocked_at`,
    ),
    deleteUnblock: db.prepare('DELETE FROM unblock WHERE subject = ? AND blocker = ?'),
    forgetAsSubject: db.prepare('DELETE FROM unblock WHERE subject = ?'),
    forgetAsBlocker: db.prepare('DELETE FROM unblock WHERE blocker = ?'),
    markGone: db.prepare(
      'INSERT INTO gone (did, at) VALUES (?, ?) ON CONFLICT (did) DO UPDATE SET at = max(at, excluded.at)',
    ),
    isGone: db.prepare('SELECT 1 AS hit FROM gone WHERE did = ?'),
    forgetGone: db.prepare('DELETE FROM gone WHERE at < ?'),
    emit: db.prepare('INSERT INTO outbox (op) VALUES (?)'),
    outbox: db.prepare('SELECT id, op FROM outbox ORDER BY id LIMIT ?'),
    ack: db.prepare('DELETE FROM outbox WHERE id <= ?'),
    outboxDepth: db.prepare('SELECT count(*) AS n FROM outbox'),
    unblockCount: db.prepare('SELECT count(*) AS n FROM unblock'),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ),
    // One slice of the key space. Every TEXT sorts before every BLOB, so
    // "before the empty blob" is every DID kept as text. The empty blob is
    // written into the statement: bound as a parameter, a zero-length buffer
    // can arrive as NULL, and a comparison with NULL matches nothing.
    sweepText: db.prepare("DELETE FROM block WHERE blocker < x'' AND seen < ?"),
    sweepSlice: db.prepare('DELETE FROM block WHERE blocker >= ? AND blocker < ? AND seen < ?'),
    sweepLast: db.prepare('DELETE FROM block WHERE blocker >= ? AND seen < ?'),
    pageCount: db.prepare('PRAGMA page_count'),
    freeCount: db.prepare('PRAGMA freelist_count'),
    pageSize: db.prepare('PRAGMA page_size'),
  };

  const saved = q.getMeta.get('state');
  let state = saved ? { ...freshState(), ...JSON.parse(saved.value) } : freshState();
  state.counters = { ...newCounters(), ...state.counters };
  const saveState = () => q.setMeta.run('state', JSON.stringify(state));

  const pageSize = Object.values(q.pageSize.get())[0];
  const pragmaNumber = (stmt) => Number(Object.values(stmt.get())[0]);

  function size() {
    const pages = pragmaNumber(q.pageCount);
    const free = pragmaNumber(q.freeCount);
    return { bytes: pages * pageSize, usedBytes: (pages - free) * pageSize, freeBytes: free * pageSize };
  }

  // The interface fold.js is written against. DIDs cross it as strings and
  // are packed on the way in.
  const tx = {
    getBlock(blocker, rkey) {
      const row = q.getBlock.get(packDid(blocker), rkey);
      return row ? { subject: unpackDid(row.subject), seen: row.seen } : null;
    },
    insertBlock(blocker, rkey, subject, seen) {
      q.insertBlock.run(packDid(blocker), rkey, packDid(subject), seen);
      state.live += 1;
    },
    updateBlock(blocker, rkey, subject, seen) {
      q.updateBlock.run(packDid(subject), seen, packDid(blocker), rkey);
    },
    deleteBlock(blocker, rkey) {
      state.live -= Number(q.deleteBlock.run(packDid(blocker), rkey).changes);
    },
    blocksStill(blocker, subject) {
      return Boolean(q.blocksStill.get(packDid(blocker), duplicateScan, packDid(subject)));
    },
    deleteBlocksBy(blocker) {
      const n = Number(q.deleteBlocksBy.run(packDid(blocker)).changes);
      state.live -= n;
      return n;
    },
    hasUnblock(subject, blocker) {
      return Boolean(q.hasUnblock.get(packDid(subject), packDid(blocker)));
    },
    putUnblock(subject, blocker, blockedAt, unblockedAt) {
      q.putUnblock.run(packDid(subject), packDid(blocker), blockedAt, unblockedAt);
    },
    deleteUnblock(subject, blocker) {
      q.deleteUnblock.run(packDid(subject), packDid(blocker));
    },
    forgetUnblocks(did) {
      const packed = packDid(did);
      return (
        Number(q.forgetAsSubject.run(packed).changes) + Number(q.forgetAsBlocker.run(packed).changes)
      );
    },
    markGone(did, at) {
      q.markGone.run(packDid(did), at);
    },
    isGone(did) {
      return Boolean(q.isGone.get(packDid(did)));
    },
    emit(op) {
      q.emit.run(JSON.stringify(op));
    },
  };

  /** Run `work` in a transaction that also saves the state it changed. */
  function transact(work) {
    const before = structuredClone(state);
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = work();
      saveState();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* the transaction never opened */
      }
      state = before;
      throw err;
    }
  }

  /**
   * Apply a batch of events and save the stream's place, in one transaction:
   * the index and the cursor can't disagree about what has been seen, so a
   * restart resumes exactly after the last batch that was written.
   */
  function apply(events, cursor = null) {
    if (!events.length && cursor == null) return;
    transact(() => {
      for (const event of events) {
        fold(tx, event, state.counters);
        if (state.startedAt == null || event.at < state.startedAt) state.startedAt = event.at;
        if (state.lastEventAt == null || event.at > state.lastEventAt) state.lastEventAt = event.at;
      }
      if (state.horizon == null && state.startedAt != null) state.horizon = state.startedAt;
      if (cursor != null) state.cursor = cursor;
    });
  }

  /** Drop slice `i`'s blocks older than `cutoff`; how many went. */
  function sweepOne(i, cutoff) {
    // Slice 0 is every DID kept as text. Slices 1 to 256 are the packed ones
    // by their first byte, the last of them open-ended.
    if (i === 0) return Number(q.sweepText.run(cutoff).changes);
    const from = new Uint8Array([i - 1]);
    if (i === 256) return Number(q.sweepLast.run(from, cutoff).changes);
    return Number(q.sweepSlice.run(from, new Uint8Array([i]), cutoff).changes);
  }

  /**
   * How many blocks the index may hold, or null while it has no ceiling or
   * has not reached it yet.
   */
  function rowLimit() {
    if (!(maxBytes > 0)) return null;
    if (state.rowCeiling != null && state.ceilingFor !== maxBytes) {
      // The ceiling was changed since this was worked out. Hold the same
      // density to the new one.
      state.rowCeiling = Math.max(1, Math.floor(state.rowCeiling * (maxBytes / state.ceilingFor)));
      state.ceilingFor = maxBytes;
    }
    if (state.rowCeiling == null) {
      if (state.live <= 0) return null;
      const { usedBytes } = size();
      if (usedBytes < maxBytes) return null;
      // Measured once, here, at the density the index has grown to. Usually
      // that is the moment it first touches the ceiling and the answer is
      // "as many as it holds now"; with a ceiling set below its present size,
      // it is the share of them that would fit.
      state.rowCeiling = Math.max(1, Math.floor(state.live * (maxBytes / usedBytes)));
      state.ceilingFor = maxBytes;
    }
    return state.rowCeiling;
  }

  /** The cutoff a new sweep should run to, or null when none is due. */
  function dueCutoff(now) {
    const horizon = state.horizon;
    if (horizon == null) return null;
    let cutoff = horizon;

    if (retentionDays > 0) cutoff = Math.max(cutoff, now - retentionDays * 86_400);

    const limit = rowLimit();
    if (limit != null && state.live > limit) {
      // How far forward the horizon has to move to get back under, taking
      // blocks to have arrived at an even rate. They don't quite, and the
      // next sweep corrects for whatever this one got wrong. It aims 2%
      // under, so the limit is not grazed again within the hour.
      const excess = (state.live - limit * 0.98) / state.live;
      const span = Math.max(0, now - horizon);
      cutoff = Math.max(cutoff, horizon + Math.max(3600, Math.ceil(span * excess)));
    }

    // Whatever the settings say, the last hour is kept. A ceiling too small
    // to hold an hour is a misconfiguration, and the log says so.
    cutoff = Math.min(cutoff, now - MIN_KEPT_SECONDS);
    // Not worth a pass over the whole table for less than an hour of blocks.
    return cutoff >= horizon + 3600 ? cutoff : null;
  }

  /**
   * One step of housekeeping. Call it on a timer.
   *
   * A sweep is 257 steps, each dropping one slice's blocks older than the
   * cutoff. Between sweeps a step hands free pages back to the disk if a lot
   * have piled up, and otherwise does nothing.
   *
   * @returns {{ did: 'sweep'|'vacuum'|'idle', removed?: number, finished?: boolean }}
   */
  function tend(now = Math.floor(Date.now() / 1000)) {
    if (!state.sweep) {
      const cutoff = dueCutoff(now);
      if (cutoff == null) {
        // Pages freed by a sweep are reused by the blocks that follow, so in
        // the ordinary way there is nothing to hand back. A lowered ceiling
        // is the exception: it frees far more than will be refilled.
        const { freeBytes, bytes } = size();
        if (freeBytes > vacuumAtBytes && freeBytes > bytes * 0.1) {
          db.exec('PRAGMA incremental_vacuum(2048)');
          return { did: 'vacuum' };
        }
        return { did: 'idle' };
      }
      state.sweep = { cutoff, next: 0 };
    }

    const { cutoff, next } = state.sweep;
    return transact(() => {
      const removed = sweepOne(next, cutoff);
      state.live -= removed;
      state.pruned += removed;
      const finished = next + 1 >= SLICES;
      if (finished) {
        state.horizon = cutoff;
        state.sweep = null;
        // An account deleted before the horizon has no blocks left here to
        // be mistaken for unblocks, so it need not be remembered.
        q.forgetGone.run(cutoff);
        // The count of blocks that fit was measured once. If the size has
        // since drifted well away from the ceiling, move the count a little:
        // 3% a sweep, so that a size which is slow to follow is never chased.
        if (state.rowCeiling != null && maxBytes > 0) {
          const { usedBytes } = size();
          if (usedBytes > maxBytes * 1.1) state.rowCeiling = Math.max(1, Math.floor(state.rowCeiling * 0.97));
          else if (usedBytes < maxBytes * 0.9) state.rowCeiling = Math.ceil(state.rowCeiling * 1.03);
        }
      } else {
        state.sweep = { cutoff, next: next + 1 };
      }
      return { did: 'sweep', removed, finished };
    });
  }

  return {
    apply,
    tend,
    size,
    state: () => structuredClone(state),
    /** Standing unblocks. A count over a small table, not the big one. */
    unblockCount: () => Number(q.unblockCount.get().n),
    /** What is waiting to be sent on, oldest first. */
    outbox: (limit = 500) => q.outbox.all(limit).map((row) => ({ id: Number(row.id), op: JSON.parse(row.op) })),
    outboxDepth: () => Number(q.outboxDepth.get().n),
    /** Everything up to and including `id` has been sent. */
    ack: (id) => {
      q.ack.run(id);
    },
    /** For the tests: rows as they would be read back. */
    blocks: () =>
      db
        .prepare('SELECT blocker, rkey, subject, seen FROM block')
        .all()
        .map((r) => ({ blocker: unpackDid(r.blocker), rkey: r.rkey, subject: unpackDid(r.subject), seen: r.seen })),
    unblocks: () =>
      db
        .prepare('SELECT subject, blocker, blocked_at, unblocked_at FROM unblock')
        .all()
        .map((r) => ({
          subject: unpackDid(r.subject),
          blocker: unpackDid(r.blocker),
          blockedAt: r.blocked_at,
          unblockedAt: r.unblocked_at,
        }))
        .sort((a, b) => `${a.subject}\n${a.blocker}`.localeCompare(`${b.subject}\n${b.blocker}`)),
    close() {
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch {
        /* a reader may still hold it; the next open checkpoints */
      }
      db.close();
    },
  };
}
