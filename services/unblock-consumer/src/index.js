// The unblock tracker's consumer, on a droplet.
//
// Bluesky has plenty of tools that tell you who blocks you. This one watches
// for the opposite: a block being taken away. It reads every
// app.bsky.graph.block record the network makes, keeps who each one blocked,
// and when one is deleted it knows who has just been let back in.
//
//   Jetstream ──▶ events.js ──▶ fold.js ──▶ store.js (SQLite, on this box)
//                                                │ outbox
//                                                ▼
//                                          publish.js ──▶ Supabase ──▶ dame.is
//
// The site is /experimenting/unblocking; it reads Supabase through
// api/unblocked.js and never talks to this box.
//
// CRASH RATHER THAN SKIP. A batch that can't be written (a full disk, a
// corrupt page) ends the process. The cursor is saved in the same transaction
// as the batch, so systemd's restart resumes from the last one that was
// written and nothing is passed over. Carrying on instead would leave a hole
// in the index that looks, forever after, like blocks nobody made.

import { rpc } from '../../../api/_lib/unblockDb.js';

import { config, assertConfig } from './config.js';
import { logger } from './logger.js';
import { openStore } from './store.js';
import { readFrame } from './events.js';
import { connectJetstream } from './jetstream.js';
import { createPublisher } from './publish.js';

let store = null;
let stream = null;
let publisher = null;
const timers = [];

// Events read but not yet written, and the newest place in the stream seen.
let buffer = [];
let cursor = null;
let savedCursor = null;

const stats = { frames: 0, events: 0, batches: 0, sweeps: 0 };
let sweepRemoved = 0;
let lastCeilingWarning = 0;

// These hold the process open, on purpose. With every timer unref'd, a moment
// with no socket and no retry pending (a connection attempt that failed) left
// the event loop empty and the process exited 0, as if it had been asked to.
// It stops when it is told to (shutdown) or when it can't go on (die).
function every(ms, fn) {
  timers.push(setInterval(fn, ms));
}

function die(what, err) {
  logger.error(what, { err });
  // Nothing is flushed on the way out: whatever is in the buffer comes back
  // from the saved cursor.
  process.exit(1);
}

function flush() {
  if (!buffer.length && cursor === savedCursor) return;
  const events = buffer;
  buffer = [];
  try {
    store.apply(events, cursor);
  } catch (err) {
    die('Could not write a batch to the index', err);
  }
  savedCursor = cursor;
  stats.events += events.length;
  stats.batches += 1;
}

function onFrame(frame) {
  stats.frames += 1;
  const read = readFrame(frame);
  if (read.cursor != null) cursor = read.cursor;
  if (!read.event) return;
  buffer.push(read.event);
  if (buffer.length >= config.flushAt) flush();
}

function tend() {
  let step;
  try {
    step = store.tend();
  } catch (err) {
    die('Could not tend the index', err);
  }
  if (step.did !== 'sweep') {
    warnIfCeilingTooSmall();
    return;
  }
  sweepRemoved += step.removed;
  if (!step.finished) return;
  stats.sweeps += 1;
  const state = store.state();
  logger.info('Dropped the oldest blocks', {
    removed: sweepRemoved,
    horizon: new Date(state.horizon * 1000).toISOString(),
    held: state.live,
    usedMb: Math.round(store.size().usedBytes / 1e6),
  });
  sweepRemoved = 0;
}

// A ceiling that can't hold what the last hour brought never gets back under
// it, and the index quietly grows past the number someone chose. Say so.
function warnIfCeilingTooSmall() {
  if (!config.maxDbMb) return;
  const now = Date.now();
  if (now - lastCeilingWarning < 60 * 60_000) return;
  const { usedBytes } = store.size();
  if (usedBytes <= config.maxDbMb * 1e6 * 1.1) return;
  lastCeilingWarning = now;
  logger.warn('The index is over its ceiling and has nothing old enough left to drop', {
    usedMb: Math.round(usedBytes / 1e6),
    maxDbMb: config.maxDbMb,
  });
}

function logStats() {
  const state = store.state();
  const { counters } = state;
  const size = store.size();
  logger.info('Stats', {
    frames: stats.frames,
    events: stats.events,
    held: state.live,
    unblocks: store.unblockCount(),
    deletes: counters.deletes,
    placed: counters.placed,
    unplaced: counters.unplaced,
    duplicate: counters.duplicate,
    moot: counters.moot,
    reblocked: counters.reblocked,
    waiting: store.outboxDepth(),
    usedMb: Math.round(size.usedBytes / 1e6),
    fileMb: Math.round(size.bytes / 1e6),
    horizon: state.horizon ? new Date(state.horizon * 1000).toISOString() : null,
    rssMb: Math.round(process.memoryUsage().rss / 1e6),
  });
}

/** Where the stream should start: where it left off, or a first run's head start. */
function resumeCursor() {
  if (savedCursor != null) return savedCursor;
  if (!config.bootstrapHours) return null;
  // Microseconds, which both generations of Jetstream take as a cursor.
  return (Date.now() - config.bootstrapHours * 3_600_000) * 1000;
}

async function main() {
  assertConfig();
  store = await openStore({
    file: config.dbFile,
    maxBytes: config.maxDbMb * 1e6,
    retentionDays: config.retentionDays,
    cacheKb: config.cacheKb,
  });

  const state = store.state();
  savedCursor = state.cursor;
  cursor = state.cursor;
  logger.info('Index opened', {
    file: config.dbFile,
    held: state.live,
    unblocks: store.unblockCount(),
    waiting: store.outboxDepth(),
    cursor: state.cursor ?? `(first run: ${config.bootstrapHours}h back)`,
    maxDbMb: config.maxDbMb || '(none)',
    retentionDays: config.retentionDays || '(none)',
    publish: config.publish,
  });

  stream = connectJetstream({ config, logger, getCursor: resumeCursor, onFrame });

  every(config.flushMs, flush);
  every(config.tendMs, tend);
  if (config.publish) {
    publisher = createPublisher({
      store,
      rpc,
      logger,
      batch: config.publishBatch,
      statusMs: config.statusMs,
    });
    every(config.publishMs, () => {
      publisher.tick().catch((err) => logger.error('Publisher error', { err }));
    });
  }
  every(config.statsIntervalMs, logStats);
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info('Stopping', { signal });
  for (const timer of timers) clearInterval(timer);
  stream?.close();
  try {
    flush();
    // One last send, so a restart doesn't sit on finished work. If it fails
    // the outbox is still there next time.
    if (publisher) await publisher.tick(Date.now(), { force: true });
    logStats();
    store?.close();
  } catch (err) {
    logger.error('Error while stopping', { err });
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => die('Uncaught exception', err));
process.on('unhandledRejection', (err) => die('Unhandled rejection', err));

main().catch((err) => die('Could not start', err));
