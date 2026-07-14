// PDS plumbing for the mirror: collection listing, batched writes, blob
// upload, and write-rate pacing. Takes any logged-in AtpAgent (or an
// unauthenticated one for read-only dry runs — listRecords/getRecord are
// public XRPC).
//
// Why pacing lives here: a PDS rate-limits record writes per-DID on a points
// budget (the reference/Bluesky PDS: CREATE=3, UPDATE=2, DELETE=1 points;
// 5,000/hour and 35,000/day). A full backfill of a large are.na account is
// tens of thousands of creates — well over a single day's budget — so the
// mirror must (a) slow down as it approaches the limit and (b) stop cleanly
// and resume later when the wait would be long, rather than error out. The
// pacer reads the PDS's own `ratelimit-*` headers, so it adapts to whatever
// limit the PDS actually enforces instead of hard-coding one.

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

/** ms until a rate-limit window resets, from response/error headers. */
function resetWaitMs(headers) {
  const h = headers || {};
  const reset = Number(h['ratelimit-reset']); // unix seconds
  if (Number.isFinite(reset) && reset > 1e9) return Math.max(0, reset * 1000 - Date.now());
  const retryAfter = Number(h['retry-after']); // delta seconds
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1000;
  return 0;
}

/**
 * Adapts write throughput to the PDS's advertised budget. `observe` is called
 * after every successful write with that response's headers; `backoff` is
 * called on a 429. Both sleep for short waits and throw WritePauseNeeded when
 * the wait exceeds `maxSleepMs` — that ceiling is the whole knob: small (the
 * cron) means "stop and resume next run", large (an attended `--drain`
 * backfill) means "sleep through the hourly window and keep grinding".
 */
export class WritePacer {
  constructor({ minRemaining = 50, maxSleepMs = 120_000, log = () => {} } = {}) {
    this.minRemaining = minRemaining;
    this.maxSleepMs = maxSleepMs;
    this.log = log;
    this.paused = 0; // total ms spent sleeping on rate limits (for the report)
  }

  async _waitOrPause(waitMs, why) {
    if (waitMs > this.maxSleepMs) throw new WritePauseNeeded(waitMs);
    if (waitMs <= 0) return;
    this.log(`${why} — waiting ${Math.round(waitMs / 1000)}s`);
    this.paused += waitMs;
    await sleep(waitMs);
  }

  async observe(headers) {
    const remaining = Number(headers?.['ratelimit-remaining']);
    if (!Number.isFinite(remaining) || remaining > this.minRemaining) return;
    await this._waitOrPause(resetWaitMs(headers) || 1000, `approaching write limit (remaining ${remaining})`);
  }

  async backoff(headers) {
    await this._waitOrPause(resetWaitMs(headers) || 15_000, 'write rate limited (429)');
  }
}

const is429 = (err) => err?.status === 429 || /rate ?limit/i.test(err?.message || '');

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
    try {
      const res = await agent.com.atproto.repo.applyWrites({ repo: did, writes: batch.map(toWrite), validate: false });
      ok += batch.length;
      i += batch.length;
      if (pacer) await pacer.observe(res?.headers);
    } catch (err) {
      if (is429(err)) {
        // Not a bad batch — we're over budget. Wait (or pause the run) and
        // retry the SAME batch; nothing was written.
        if (pacer) await pacer.backoff(err.headers);
        else throw err; // no pacer (shouldn't happen for writes) → surface it
        continue;
      }
      log(`applyWrites batch failed (${err.message}) — retrying ${batch.length} op(s) individually`);
      for (const op of batch) {
        for (;;) {
          try {
            if (op.type === 'delete') {
              await agent.com.atproto.repo.deleteRecord({ repo: did, collection: op.collection, rkey: op.rkey });
            } else {
              const res = await agent.com.atproto.repo.putRecord({
                repo: did,
                collection: op.collection,
                rkey: op.rkey,
                record: op.value,
                validate: false,
              });
              if (pacer) await pacer.observe(res?.headers);
            }
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
      if (pacer) await pacer.observe(res?.headers);
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
