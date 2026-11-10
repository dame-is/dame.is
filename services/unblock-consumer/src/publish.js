// Sending what the index concluded on to Supabase, where the site reads it.
//
// The store writes every conclusion (an unblock, one taken back, an account
// to forget) into its outbox in the same transaction as the event that caused
// it. This drains the outbox, in order, and only lets go of a row once
// Supabase has said it applied it. So Supabase being down, or not set up yet,
// costs nothing but lateness: the outbox waits.
//
// Every op is safe to send twice (docs/sql/unblock.sql), which is what makes
// "the reply was lost, send the batch again" correct.

const iso = (seconds) => (seconds == null ? null : new Date(seconds * 1000).toISOString());

/**
 * What the page says about the tracker itself: since when it has been
 * watching, how far back it can still place an unblock, and how many of the
 * unblocks it saw it could place. Those last two are the honest measure of
 * how much of the picture this is.
 */
export function statusBody(state) {
  return {
    startedAt: iso(state.startedAt),
    horizonAt: iso(state.horizon ?? state.startedAt),
    lastEventAt: iso(state.lastEventAt),
    blocksHeld: state.live,
    deletesSeen: state.counters.deletes,
    // Every delete the index knew the subject of, including the few that
    // undid nothing because a second record still blocked the same person.
    deletesPlaced: state.counters.placed + state.counters.duplicate,
  };
}

/**
 * @param {object} opts
 * @param {object} opts.store
 * @param {(fn: string, args: object) => Promise<any>} opts.rpc
 * @param {object} opts.logger
 * @param {number} opts.batch       ops per call
 * @param {number} opts.statusMs    how often the status goes along
 * @param {number} [opts.maxBackoffMs]
 */
export function createPublisher({ store, rpc, logger, batch = 500, statusMs = 60_000, maxBackoffMs = 5 * 60_000 }) {
  let busy = false;
  let failures = 0;
  let notBefore = 0;
  let statusAt = 0;
  let sent = 0;

  /**
   * One attempt. Resolves to how many ops were sent, or -1 when it did not
   * try (already running, or backing off).
   */
  async function tick(now = Date.now(), { force = false } = {}) {
    if (busy || (!force && now < notBefore)) return -1;
    busy = true;
    try {
      const rows = store.outbox(batch);
      const statusDue = now - statusAt >= statusMs;
      if (!rows.length && !statusDue) return 0;

      await rpc('ingest', {
        ops: rows.map((row) => row.op),
        status: statusDue ? statusBody(store.state()) : null,
      });
      if (rows.length) store.ack(rows[rows.length - 1].id);
      if (statusDue) statusAt = now;
      if (failures > 0) logger.info('Supabase is answering again', { after: failures });
      failures = 0;
      sent += rows.length;
      return rows.length;
    } catch (err) {
      failures += 1;
      const wait = Math.min(maxBackoffMs, 2000 * 2 ** Math.min(failures - 1, 8));
      notBefore = now + wait;
      // The first failure, then every tenth: a schema that is not there yet
      // fails every few minutes for as long as it takes someone to create it.
      if (failures === 1 || failures % 10 === 0) {
        logger.warn('Could not publish to Supabase; the outbox will wait', {
          err,
          failures,
          waiting: store.outboxDepth(),
          retryInMs: wait,
        });
      }
      return -1;
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    /** Ops sent since the process started. */
    sent: () => sent,
    failing: () => failures > 0,
  };
}
