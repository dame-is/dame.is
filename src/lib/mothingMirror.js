// Incremental iNaturalist → PDS mirror, shared by the CLI script
// (`scripts/mirror-inaturalist.mjs`) and the cron function
// (`api/mirror-mothing.js`).
//
// The old mirror re-fetched every observation and re-wrote all ~240 records
// on every run. This one:
//   1. Takes a cheap freshness signature (1 tiny request). If it matches the
//      marker stored on the summary record, nothing changed → no-op.
//   2. Otherwise reconstructs the full set from the PDS copy and overlays
//      only the observations iNaturalist reports as changed since the last
//      sync (`updated_since`), so we re-download just what moved.
//   3. Writes only the changed/new observation records + the refreshed
//      summary, and deletes records for observations removed upstream.
//
// It never stores location: it only ever handles already-normalized,
// location-free observations (and reconstructs them from location-free
// records).

import {
  fetchMothSignature,
  fetchMothObservations,
  fetchMothIds,
  observationFromRecord,
  computeStats,
  buildMirrorWrites,
} from './inaturalist.js';
import { rkeyFromAtUri } from './atproto.js';
import { INATURALIST_USER, MOTHING_NSID, MOTHING_OBSERVATION_NSID } from '../config.js';

async function pool(items, size, worker) {
  let i = 0;
  let ok = 0;
  let fail = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try {
          await worker(item);
          ok++;
        } catch (err) {
          fail++;
          if (item?._onError) item._onError(err);
        }
      }
    }),
  );
  return { ok, fail };
}

async function readSummary(agent, did) {
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: MOTHING_NSID,
      rkey: 'self',
    });
    return res?.data?.value || null;
  } catch {
    return null; // no summary yet → first run
  }
}

async function listObservationRecords(agent, did) {
  const out = [];
  let cursor;
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: MOTHING_OBSERVATION_NSID,
      limit: 100,
      cursor,
    });
    const records = res?.data?.records || [];
    for (const r of records) out.push({ rkey: rkeyFromAtUri(r.uri), value: r.value });
    cursor = res?.data?.cursor;
    if (!records.length) break;
  } while (cursor);
  return out;
}

/**
 * Run one mirror sync. `agent` must be a logged-in AtpAgent for `did`.
 * Returns a small report; with `dryRun` it plans without writing.
 */
export async function syncMothingMirror({
  agent,
  did,
  user = INATURALIST_USER,
  now,
  full = false,
  dryRun = false,
  log = () => {},
}) {
  const ts = now || new Date().toISOString();

  const signature = await fetchMothSignature({ user });
  const summary = await readSummary(agent, did);

  const unchanged =
    !full &&
    summary &&
    signature.count === summary.observationCount &&
    signature.latestUpdatedAt &&
    signature.latestUpdatedAt === summary.lastSyncedAt;
  if (unchanged) {
    log(`no changes (count=${signature.count}, latest=${signature.latestUpdatedAt}) — skipping.`);
    return { noop: true, signature, written: 0, deleted: 0, changed: 0 };
  }

  const existing = await listObservationRecords(agent, did);
  const existingRkeys = existing.map((r) => r.rkey).filter(Boolean);

  // Incremental unless forced or first-run: only re-pull what changed.
  const since = full ? null : summary?.lastSyncedAt || null;
  const changed = await fetchMothObservations({ user, since });
  log(since ? `changed since ${since}: ${changed.length}` : `full pull: ${changed.length}`);

  // Rebuild the full set from the PDS copy, then overlay the changed ones.
  const merged = new Map();
  for (const r of existing) {
    const obs = observationFromRecord(r.value);
    if (obs?.id != null) merged.set(String(obs.id), obs);
  }
  for (const o of changed) merged.set(String(o.id), o);

  // Deletions never show up in `updated_since`; when the merged size disagrees
  // with iNaturalist's authoritative count, diff against the live id list.
  if (merged.size !== signature.count) {
    const liveIds = new Set((await fetchMothIds({ user })).map(String));
    for (const id of Array.from(merged.keys())) if (!liveIds.has(id)) merged.delete(id);
  }
  const mergedIds = new Set(merged.keys());
  const deletes = existingRkeys.filter((rk) => !mergedIds.has(rk));

  // Recompute aggregates from the full merged set so the summary stays exact.
  const observations = Array.from(merged.values());
  const stats = computeStats(observations, { user });
  const { summary: summaryWrite, records } = buildMirrorWrites({ observations, stats, now: ts });
  summaryWrite.value.lastSyncedAt = signature.latestUpdatedAt || ts;

  // Write only the observations that actually changed (or, on a full/first
  // run, `changed` is the whole set).
  const changedIds = new Set(changed.map((o) => String(o.id)));
  const recordWrites = records.filter((r) => changedIds.has(String(r.rkey)));
  const writes = [summaryWrite, ...recordWrites];

  if (dryRun) {
    log(
      `dry run — would write ${writes.length} record(s) ` +
        `(${recordWrites.length} observation(s) + summary), delete ${deletes.length}.`,
    );
    return {
      dryRun: true,
      signature,
      observations: observations.length,
      species: stats.speciesCount,
      wouldWrite: writes.length,
      wouldDelete: deletes.length,
      changed: changed.length,
    };
  }

  const putResult = await pool(writes, 6, async (w) => {
    await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: w.collection,
      rkey: w.rkey,
      record: w.value,
      validate: false, // is.dame.* lexicons aren't published to the PDS
    });
  });

  let delResult = { ok: 0, fail: 0 };
  if (deletes.length) {
    delResult = await pool(deletes, 6, async (rkey) => {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: MOTHING_OBSERVATION_NSID,
        rkey,
      });
    });
  }

  log(
    `wrote ${putResult.ok}/${writes.length}, deleted ${delResult.ok}/${deletes.length}` +
      `${putResult.fail || delResult.fail ? ` (${putResult.fail + delResult.fail} failed)` : ''}.`,
  );

  return {
    signature,
    observations: observations.length,
    species: stats.speciesCount,
    written: putResult.ok,
    deleted: delResult.ok,
    failed: putResult.fail + delResult.fail,
    changed: changed.length,
  };
}
