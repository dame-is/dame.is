// Incremental iNaturalist → PDS mirror, shared by the CLI script
// (`scripts/mirror-inaturalist.mjs`) and the cron function
// (`api/mirror-mothing.js`).
//
// Unlike the old moth-only mirror, this pulls EVERY observation (of any
// taxon) once, then splits each into one of two PDS collections by taxonomy:
//
//   moth  (Lepidoptera minus butterflies) → is.dame.mothing.observation
//   else  (birds, plants, fungi, butterflies, other insects…) → is.dame.observing.observation
//
// So one iNaturalist log shows up in the home feed as `mothing` if it's a
// moth and `observing` otherwise — no double-counting, nothing dropped.
//
// The run is incremental:
//   1. A cheap all-taxa freshness signature (1 tiny request). If it matches
//      the marker on is.dame.observing/self, nothing changed → no-op.
//   2. Otherwise reconstruct the full set from both PDS collections and
//      overlay only the observations iNaturalist reports as changed since the
//      last sync (`updated_since`), re-downloading just what moved.
//   3. Write only the changed/new observation records + the two refreshed
//      summaries, delete records for observations removed upstream, and move
//      any observation whose taxonomy crossed the moth boundary to the other
//      collection.
//
// It never stores location: it only ever handles already-normalized,
// location-free observations (and reconstructs them from location-free
// records). Moth-vs-not is decided from taxon ancestry at fetch time and the
// ancestry itself is discarded.

import {
  fetchSignature,
  fetchObservations,
  fetchObservationIds,
  observationFromRecord,
  computeStats,
  computeObservingStats,
  mothingObservationValue,
  mothingSummaryValue,
  observingObservationValue,
  observingSummaryValue,
  ALL_SCOPE,
} from './inaturalist.js';
import { rkeyFromAtUri } from './atproto.js';
import {
  INATURALIST_USER,
  MOTHING_NSID,
  MOTHING_OBSERVATION_NSID,
  OBSERVING_NSID,
  OBSERVING_OBSERVATION_NSID,
} from '../config.js';

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

async function readSummary(agent, did, collection) {
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo: did, collection, rkey: 'self' });
    return res?.data?.value || null;
  } catch {
    return null; // no summary yet → first run
  }
}

async function listCollection(agent, did, collection) {
  const out = [];
  let cursor;
  do {
    const res = await agent.com.atproto.repo.listRecords({ repo: did, collection, limit: 100, cursor });
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
export async function syncInaturalistMirror({
  agent,
  did,
  user = INATURALIST_USER,
  now,
  full = false,
  dryRun = false,
  log = () => {},
}) {
  const ts = now || new Date().toISOString();

  // Freshness is tracked over ALL observations (moths + everything else) on
  // the observing summary, since that's the scope this mirror pulls.
  const signature = await fetchSignature({ user, scope: ALL_SCOPE });
  const master = await readSummary(agent, did, OBSERVING_NSID);

  const unchanged =
    !full &&
    master &&
    signature.count === master.syncTotalCount &&
    signature.latestUpdatedAt &&
    signature.latestUpdatedAt === master.lastSyncedAt;
  if (unchanged) {
    log(`no changes (count=${signature.count}, latest=${signature.latestUpdatedAt}) — skipping.`);
    return { noop: true, signature, written: 0, deleted: 0, changed: 0 };
  }

  const existingMoth = await listCollection(agent, did, MOTHING_OBSERVATION_NSID);
  const existingObserving = await listCollection(agent, did, OBSERVING_OBSERVATION_NSID);
  const existingMothRkeys = existingMoth.map((r) => r.rkey).filter(Boolean);
  const existingObservingRkeys = existingObserving.map((r) => r.rkey).filter(Boolean);

  // Incremental unless forced or first-run: only re-pull what changed.
  const since = full ? null : master?.lastSyncedAt || null;
  const changed = await fetchObservations({ user, since, scope: ALL_SCOPE });
  log(since ? `changed since ${since}: ${changed.length}` : `full pull: ${changed.length}`);

  // Rebuild the full set from the PDS copies (bucket = which collection a
  // record lives in), then overlay the changed ones (bucket = fresh taxonomy).
  // Overlaying by fresh `isMoth` is what lets a re-identified observation move
  // between the two collections.
  const merged = new Map(); // id -> { obs, isMoth }
  for (const r of existingMoth) {
    const obs = observationFromRecord(r.value);
    if (obs?.id != null) merged.set(String(obs.id), { obs, isMoth: true });
  }
  for (const r of existingObserving) {
    const obs = observationFromRecord(r.value);
    if (obs?.id != null) merged.set(String(obs.id), { obs, isMoth: false });
  }
  for (const o of changed) {
    if (o?.id != null) merged.set(String(o.id), { obs: o, isMoth: Boolean(o.isMoth) });
  }

  // Deletions never show up in `updated_since`; when the merged size disagrees
  // with iNaturalist's authoritative count, diff against the live id list.
  if (merged.size !== signature.count) {
    const liveIds = new Set((await fetchObservationIds({ user, scope: ALL_SCOPE })).map(String));
    for (const id of Array.from(merged.keys())) if (!liveIds.has(id)) merged.delete(id);
  }

  // Split into the two buckets.
  const mothObs = [];
  const observingObs = [];
  for (const { obs, isMoth } of merged.values()) (isMoth ? mothObs : observingObs).push(obs);

  const mothStats = computeStats(mothObs, { user });
  const observingStats = computeObservingStats(observingObs, { user });

  // Two summaries: mothing keeps its moth-only stats (the /mothing surface's
  // owned copy), observing carries the non-moth stats + the master freshness
  // marker over all observations.
  const mothSummaryWrite = {
    collection: MOTHING_NSID,
    rkey: 'self',
    value: mothingSummaryValue(mothStats, { now: ts, user }),
  };
  mothSummaryWrite.value.lastSyncedAt = signature.latestUpdatedAt || ts;

  const observingSummaryWrite = {
    collection: OBSERVING_NSID,
    rkey: 'self',
    value: observingSummaryValue(observingStats, { now: ts, user }),
  };
  observingSummaryWrite.value.syncTotalCount = signature.count;
  observingSummaryWrite.value.lastSyncedAt = signature.latestUpdatedAt || ts;

  // Only write observation records that actually changed (on a full/first run
  // `changed` is the whole set). Each goes to its bucket's collection.
  const changedIds = new Set(changed.map((o) => String(o.id)));
  const mothRecordWrites = mothObs
    .filter((o) => o.id != null && changedIds.has(String(o.id)))
    .map((o) => ({ collection: MOTHING_OBSERVATION_NSID, rkey: String(o.id), value: mothingObservationValue(o, { now: ts }) }));
  const observingRecordWrites = observingObs
    .filter((o) => o.id != null && changedIds.has(String(o.id)))
    .map((o) => ({ collection: OBSERVING_OBSERVATION_NSID, rkey: String(o.id), value: observingObservationValue(o, { now: ts }) }));

  const writes = [mothSummaryWrite, observingSummaryWrite, ...mothRecordWrites, ...observingRecordWrites];

  // Delete any existing record whose id no longer belongs to that collection —
  // removed upstream, or moved to the other bucket after a re-identification.
  const mothIds = new Set(mothObs.map((o) => String(o.id)));
  const observingIds = new Set(observingObs.map((o) => String(o.id)));
  const mothDeletes = existingMothRkeys.filter((rk) => !mothIds.has(rk));
  const observingDeletes = existingObservingRkeys.filter((rk) => !observingIds.has(rk));

  if (dryRun) {
    log(
      `dry run — would write ${writes.length} record(s) ` +
        `(${mothRecordWrites.length} moth + ${observingRecordWrites.length} observing + 2 summaries), ` +
        `delete ${mothDeletes.length + observingDeletes.length} ` +
        `(${mothDeletes.length} moth, ${observingDeletes.length} observing).`,
    );
    return {
      dryRun: true,
      signature,
      observations: merged.size,
      moths: mothObs.length,
      observing: observingObs.length,
      species: mothStats.speciesCount,
      wouldWrite: writes.length,
      wouldDelete: mothDeletes.length + observingDeletes.length,
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

  const deletions = [
    ...mothDeletes.map((rkey) => ({ collection: MOTHING_OBSERVATION_NSID, rkey })),
    ...observingDeletes.map((rkey) => ({ collection: OBSERVING_OBSERVATION_NSID, rkey })),
  ];
  let delResult = { ok: 0, fail: 0 };
  if (deletions.length) {
    delResult = await pool(deletions, 6, async (d) => {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection: d.collection, rkey: d.rkey });
    });
  }

  log(
    `wrote ${putResult.ok}/${writes.length}, deleted ${delResult.ok}/${deletions.length}` +
      `${putResult.fail || delResult.fail ? ` (${putResult.fail + delResult.fail} failed)` : ''}.`,
  );

  return {
    signature,
    observations: merged.size,
    moths: mothObs.length,
    observing: observingObs.length,
    species: mothStats.speciesCount,
    written: putResult.ok,
    deleted: delResult.ok,
    failed: putResult.fail + delResult.fail,
    changed: changed.length,
  };
}
