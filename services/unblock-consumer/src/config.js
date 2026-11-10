// Configuration, read once at startup and validated loudly.
//
// Values arrive from systemd's EnvironmentFile, as they do for every consumer
// on this box.

import path from 'node:path';

const num = (v, d) => (v == null || v === '' ? d : Number(v));
const flag = (v, d) => (v == null || v === '' ? d : String(v).toLowerCase() === 'true');

export const config = {
  /**
   * Jetstream. The default is the host and the wire format the mod-consumer
   * beside this already runs against.
   *
   * JETSTREAM_API=v2 switches to the newer endpoint
   * (bsky.network/docs/jetstream), which can filter out the identity events
   * this service throws away. It is written from the documentation and was
   * not run against the live service when this was built, so v1 stays the
   * default until someone has watched v2 work. If you switch, switch the host
   * too: v2 is jetstream.us-west.bsky.network.
   */
  jetstreamHost: process.env.JETSTREAM_HOST || 'jetstream2.us-west.bsky.network',
  jetstreamApi: String(process.env.JETSTREAM_API || 'v1').toLowerCase(),
  reconnectBaseMs: num(process.env.RECONNECT_BASE_MS, 1000),
  reconnectMaxMs: num(process.env.RECONNECT_MAX_MS, 30_000),

  /**
   * How long the stream may be silent before the socket is taken for dead.
   *
   * The network makes a block every quarter of a second or so, so unlike the
   * mod-consumer's stream this one is never quiet, and silence is the signal.
   */
  silenceMs: num(process.env.SILENCE_MS, 90_000),

  /**
   * On the very first run, start this far in the past instead of at the live
   * tail. Jetstream keeps about 36 hours (measured: see the mod-consumer's
   * README), so the index opens already knowing a day and a half of blocks
   * instead of none. 0 starts at the live tail.
   */
  bootstrapHours: num(process.env.BOOTSTRAP_HOURS, 35),

  /** The index. One file, plus SQLite's -wal and -shm beside it. */
  dbFile: path.resolve(process.env.DB_FILE || path.join(process.cwd(), 'unblock-index.db')),

  /**
   * The ceiling on the index, in megabytes of pages in use. When it is
   * reached the oldest blocks are dropped, and unblocks of blocks older than
   * what is left can no longer be placed. Measured at about 62 bytes a block
   * and about 324,000 blocks a day, a gigabyte is roughly fifty days. 0 means
   * no ceiling, which on this box means a full disk eventually.
   */
  maxDbMb: num(process.env.MAX_DB_MB, 2048),

  /** Drop blocks older than this many days whatever the size. 0 for no age limit. */
  retentionDays: num(process.env.BLOCK_RETENTION_DAYS, 0),

  /**
   * SQLite's page cache, in kilobytes. Small on purpose: this box has 512 MB
   * and four other services. The index is read a few times a second, so a
   * lookup that misses the cache and goes to disk is not what limits it.
   */
  cacheKb: num(process.env.SQLITE_CACHE_KB, 8000),

  /** Events are written in batches: this often, or when this many are waiting. */
  flushMs: num(process.env.FLUSH_MS, 250),
  flushAt: num(process.env.FLUSH_AT, 500),

  /** How often one step of housekeeping runs (see store.js `tend`). */
  tendMs: num(process.env.TEND_MS, 5000),

  /**
   * Whether to send unblocks on to Supabase. Off, the index is still kept and
   * the outbox simply waits, so the service can be run and watched before the
   * schema exists, and nothing is lost by it.
   */
  publish: flag(process.env.PUBLISH, true),
  publishMs: num(process.env.PUBLISH_MS, 5000),
  publishBatch: num(process.env.PUBLISH_BATCH, 500),
  /** How often the status the page reads (since when, how far back) is refreshed. */
  statusMs: num(process.env.STATUS_MS, 60_000),

  statsIntervalMs: num(process.env.STATS_INTERVAL_MS, 30 * 60_000),
};

export function assertConfig() {
  const problems = [];
  if (!['v1', 'v2'].includes(config.jetstreamApi)) problems.push('JETSTREAM_API must be v1 or v2');
  for (const [name, value] of [
    ['MAX_DB_MB', config.maxDbMb],
    ['BLOCK_RETENTION_DAYS', config.retentionDays],
    ['BOOTSTRAP_HOURS', config.bootstrapHours],
  ]) {
    if (!Number.isFinite(value) || value < 0) problems.push(`${name} must be a number, 0 or more`);
  }
  if (config.publish) {
    if (!process.env.SUPABASE_URL) problems.push('SUPABASE_URL (or set PUBLISH=false)');
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_KEY) {
      // Named as modDb.js names it, not as the three older consumers on this
      // box do: they use SUPABASE_KEY, which nothing here reads.
      problems.push('SUPABASE_SERVICE_ROLE_KEY (or set PUBLISH=false)');
    }
  }
  if (problems.length) throw new Error(`configuration: ${problems.join('; ')}`);
}
