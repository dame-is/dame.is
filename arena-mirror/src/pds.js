// PDS plumbing for the mirror: collection listing, batched writes, blob
// upload, and write-rate pacing. Takes any logged-in AtpAgent (or an
// unauthenticated one for read-only dry runs — listRecords/getRecord are
// public XRPC).
//
// Why pacing lives here: writes to an atproto repo are capped per-account on a
// points budget — CREATE=3, UPDATE=2, DELETE=1 points, 5,000/hour and
// 35,000/day. These are Bluesky's limits, and the reference PDS enforces them
// itself (a self-hosted PDS is still subject to them), but it does NOT return
// `ratelimit-*` headers, so we can't read a live budget off the wire. Instead
// the mirror COUNTS points locally against those two windows: it waits when a
// window is full and, when the wait is long (a fresh hourly or daily window),
// stops cleanly and resumes on the next run rather than erroring. A 429 is
// honoured as a backstop for budget spent outside this process — earlier runs,
// the mothing mirror, anything else writing to the same repo.
//
// A full backfill of a large are.na account is tens of thousands of creates —
// well past a single day's 35k-point budget — so it is inherently a multi-day,
// multi-run job, and that's expected.

const rkeyFromUri = (uri) => String(uri || '').split('/').pop() || null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Thrown when the write budget is exhausted and the reset is further off than
 * the pacer is willing to sleep. The engine catches it, marks the run partial,
 * persists progress, and resumes on the next invocation.
 */
export class WritePauseNeeded extends Error {
  constructor(waitMs) {
    super(`PDS write rate limit reached — ~${Math.round(waitMs / 1000)}s until reset, pausing run`);
    this.name = 'WritePauseNeeded';
    this.waitMs = waitMs;
  }
}

/** ms until a rate-limit window resets, or null if the server didn't say. */
function resetWaitMs(headers) {
  const h = headers || {};
  const reset = Number(h['ratelimit-reset']); // unix seconds
  if (Number.isFinite(reset) && reset > 1e9) return Math.max(0, reset * 1000 - Date.now());
  const retryAfter = Number(h['retry-after']); // delta seconds
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1000;
  return null;
}

/** Write-point cost of each op type, per atproto's points system. */
export const OP_POINTS = { create: 3, update: 2, delete: 1 };

/** A fixed-window points counter: up to `limit` points per `ms`-long window. */
class PointWindow {
  constructor(limit, ms) {
    this.limit = limit;
    this.ms = ms;
    this.start = null; // when the current window opened
    this.spent = 0;
  }

  /** ms to wait before `cost` points would fit (0 = now). */
  waitMs(cost, now) {
    if (this.start == null || now - this.start >= this.ms) return 0; // no window / expired
    if (this.spent + cost <= this.limit) return 0; // fits in the current window
    return this.start + this.ms - now; // full — wait for it to reset
  }

  charge(cost, now) {
    if (this.start == null || now - this.start >= this.ms) {
      this.start = now;
      this.spent = 0;
    }
    this.spent += cost;
  }
}

/**
 * Paces record writes to stay under the account's points budget by counting
 * locally against an hourly and a daily window (defaults: Bluesky's 5,000/hour
 * and 35,000/day). `gate(cost)` waits before a write until `cost` points fit in
 * BOTH windows; `charge(cost)` records the spend after the write succeeds.
 *
 * `maxSleepMs` is the stop-vs-wait ceiling: a wait longer than it (a fresh
 * hourly or daily window) throws WritePauseNeeded so the run ends partial and
 * resumes later. Small = the cron ("stop, resume next firing"); large = an
 * attended `--drain` backfill ("sleep through the hourly window and keep
 * going"). `safety` (<1) reserves headroom for skew and other writers.
 *
 * `backoff` handles a real 429 — the backstop for budget spent outside this
 * process (earlier runs, other tools). With no `ratelimit-*` headers to read,
 * it escalates and, after enough consecutive rejections, pauses the run.
 */
export class WritePacer {
  constructor({
    hourlyPoints = 5000,
    dailyPoints = 35000,
    safety = 0.95,
    maxSleepMs = 120_000,
    hourlyMs = 3_600_000,
    dailyMs = 86_400_000,
    log = () => {},
  } = {}) {
    this.hourly = new PointWindow(Math.max(1, Math.floor(hourlyPoints * safety)), hourlyMs);
    this.daily = new PointWindow(Math.max(1, Math.floor(dailyPoints * safety)), dailyMs);
    this.maxSleepMs = maxSleepMs;
    this.log = log;
    this.paused = 0; // total ms spent waiting (for the report)
    this.spentPoints = 0;
    this._consec429 = 0;
  }

  async _sleepOrPause(waitMs, why) {
    if (waitMs > this.maxSleepMs) throw new WritePauseNeeded(waitMs);
    if (waitMs <= 0) return;
    this.log(`${why} — waiting ${Math.round(waitMs / 1000)}s`);
    this.paused += waitMs;
    await sleep(waitMs);
  }

  /** Hold BEFORE a write of `cost` points until it fits both windows. */
  async gate(cost) {
    for (;;) {
      const now = Date.now();
      const wait = Math.max(this.hourly.waitMs(cost, now), this.daily.waitMs(cost, now));
      if (wait <= 0) return;
      await this._sleepOrPause(wait, 'write points budget reached');
    }
  }

  /** Record a successful write's spend. */
  charge(cost) {
    const now = Date.now();
    this.hourly.charge(cost, now);
    this.daily.charge(cost, now);
    this.spentPoints += cost;
    this._consec429 = 0;
  }

  async backoff(headers) {
    this._consec429 += 1;
    // Prefer a server-provided reset; otherwise escalate 60s → 2m → 4m … (cap
    // 15m), and pause the run after several straight rejections.
    const fromHeader = resetWaitMs(headers);
    const wait = fromHeader != null ? fromHeader : Math.min(60_000 * 2 ** (this._consec429 - 1), 15 * 60_000);
    if (this._consec429 > 5) throw new WritePauseNeeded(wait);
    await this._sleepOrPause(wait, `write rejected (429×${this._consec429})`);
  }
}

const is429 = (err) => err?.status === 429 || /rate ?limit/i.test(err?.message || '');
const batchPoints = (batch) => batch.reduce((sum, op) => sum + (OP_POINTS[op.type] || 1), 0);

/** Every record in a collection as `{ rkey, value }`. */
export async function listCollection(agent, did, collection) {
  const out = [];
  let cursor;
  do {
    const res = await agent.com.atproto.repo.listRecords({ repo: did, collection, limit: 100, cursor });
    const records = res?.data?.records || [];
    for (const r of records) out.push({ rkey: rkeyFromUri(r.uri), value: r.value });
    cursor = res?.data?.cursor;
    if (!records.length) break;
  } while (cursor);
  return out;
}

export async function getRecord(agent, did, collection, rkey) {
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo: did, collection, rkey });
    return res?.data?.value || null;
  } catch {
    return null;
  }
}

/**
 * Apply create/update/delete ops in applyWrites batches, paced by `pacer`.
 * On a non-rate-limit batch failure, falls back to per-op calls so one bad
 * record can't sink its batchmates. A 429 (batch or per-op) defers to the
 * pacer, which may sleep or throw WritePauseNeeded to end the run. Records use
 * side-loaded lexicons, so validation is off.
 * Ops: `{ type: 'create'|'update'|'delete', collection, rkey, value? }`.
 */
export async function applyOps(agent, did, ops, { batchSize = 50, log = () => {}, pacer } = {}) {
  let ok = 0;
  let fail = 0;
  const toWrite = (op) =>
    op.type === 'delete'
      ? { $type: 'com.atproto.repo.applyWrites#delete', collection: op.collection, rkey: op.rkey }
      : {
          $type: `com.atproto.repo.applyWrites#${op.type}`,
          collection: op.collection,
          rkey: op.rkey,
          value: op.value,
        };

  for (let i = 0; i < ops.length; ) {
    const batch = ops.slice(i, i + batchSize);
    const cost = batchPoints(batch);
    if (pacer) await pacer.gate(cost); // hold until the batch fits the budget
    try {
      await agent.com.atproto.repo.applyWrites({ repo: did, writes: batch.map(toWrite), validate: false });
      ok += batch.length;
      i += batch.length;
      if (pacer) pacer.charge(cost);
    } catch (err) {
      if (is429(err)) {
        // Server says we're over budget (spend from another run/tool our local
        // counter didn't see). Back off and retry the SAME batch — not charged,
        // so gate won't double-count.
        if (pacer) await pacer.backoff(err.headers);
        else throw err;
        continue;
      }
      log(`applyWrites batch failed (${err.message}) — retrying ${batch.length} op(s) individually`);
      for (const op of batch) {
        const opCost = OP_POINTS[op.type] || 1;
        for (;;) {
          if (pacer) await pacer.gate(opCost);
          try {
            if (op.type === 'delete') {
              await agent.com.atproto.repo.deleteRecord({ repo: did, collection: op.collection, rkey: op.rkey });
            } else {
              await agent.com.atproto.repo.putRecord({
                repo: did,
                collection: op.collection,
                rkey: op.rkey,
                record: op.value,
                validate: false,
              });
            }
            if (pacer) pacer.charge(opCost);
            ok++;
            break;
          } catch (opErr) {
            if (is429(opErr) && pacer) {
              await pacer.backoff(opErr.headers); // may throw WritePauseNeeded
              continue; // retry this op
            }
            fail++;
            log(`  ${op.type} ${op.collection}/${op.rkey} failed: ${opErr.message}`);
            break;
          }
        }
      }
      i += batch.length;
    }
  }
  return { ok, fail };
}

/**
 * Upload bytes as a blob; returns the blob ref to embed in a record. A 429
 * defers to the pacer (sleep or WritePauseNeeded). Other errors propagate to
 * the caller, which decides whether to fall back to a reference.
 */
export async function uploadBlob(agent, bytes, contentType, { pacer } = {}) {
  for (;;) {
    try {
      const res = await agent.uploadBlob(bytes, { encoding: contentType });
      // Not charged to the points budget: a blob upload isn't a record write —
      // the record CREATE that references it is what costs points. A 429 here
      // (blobs have their own limits) is still honoured below.
      return res?.data?.blob || null;
    } catch (err) {
      if (is429(err) && pacer) {
        await pacer.backoff(err.headers); // may throw WritePauseNeeded
        continue;
      }
      throw err;
    }
  }
}
