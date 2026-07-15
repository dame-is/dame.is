// The sync engine: one incremental are.na → PDS mirror pass.
//
// Shape of a run:
//   1. Enumerate the user's owned channels (2-ish requests) and compare each
//      channel's `updated_at` + contents count against the sync-state record
//      (`<nsidBase>.sync/self`). All fresh → no-op.
//   2. Index the three mirror collections already on the PDS.
//   3. Walk only the changed channels, building channel/block/connection
//      records with are.na ids as rkeys (idempotent), uploading media blobs
//      per the media mode, and writing only records that actually differ.
//   4. On complete (non-partial, non-subset) runs, delete records whose
//      are.na counterpart is gone — but never records that lack an
//      `origin.arenaId`, which is the reserved hook for write-back: records
//      born on the PDS aren't the mirror's to remove.
//
// Direction note for future write-back: everything the mirror writes carries
// `origin.arenaId`. A record *without* it was created atmosphere-side; the
// write-back pass will push those to are.na and stamp the returned id into
// `origin`, which is also what stops the next pull from re-importing an echo.

import { ArenaClient } from './arena.js';
import { collectionsFor, normalizeOptions, settingsSignature } from './defaults.js';
import { channelValue, blockValue, connectionValue, valuesEqual } from './records.js';
import { listCollection, getRecord, applyOps, uploadBlob, WritePacer, WritePauseNeeded } from './pds.js';

const asId = (v) => (v == null ? null : String(v));

function indexByRkey(records) {
  const map = new Map();
  let localOnly = 0;
  for (const r of records) {
    if (!r.rkey) continue;
    map.set(r.rkey, r.value);
    if (r.value?.origin?.arenaId == null) localOnly++;
  }
  return { map, localOnly };
}

/**
 * Run one mirror sync. Requires an AtpAgent for `did` (logged in unless
 * `dryRun`) plus `user` (are.na profile slug); see normalizeOptions for the
 * behavior options. Returns a report; with `dryRun` it plans without writing.
 */
export async function syncArenaMirror(options) {
  const { agent, did, token, arenaClient, now, log = () => {} } = options;
  if (!agent || !did) throw new Error('arena-mirror: `agent` and `did` are required');
  const o = normalizeOptions(options);
  const cols = collectionsFor(o.nsidBase);
  const ts = now || new Date().toISOString();
  const startedAt = Date.now();
  const signature = settingsSignature(o);

  const client =
    arenaClient || new ArenaClient({ token, userAgent: 'arena-pds-mirror (+https://dame.is)', log });

  // Paces PDS writes against the account's points budget (counted locally,
  // since the PDS enforces the limit but doesn't advertise it). maxSleepMs is
  // the stop-vs-wait ceiling: the cron keeps it small (stop cleanly, resume
  // next firing); an attended `--drain` backfill raises it to sleep through the
  // hourly window and keep going until the daily budget is spent.
  const pacer = new WritePacer({
    hourlyPoints: o.writeHourlyPoints,
    dailyPoints: o.writeDailyPoints,
    safety: o.writePointsSafety,
    maxSleepMs: o.writeMaxSleepMs,
    log,
  });

  // --- 1. are.na identity + channel enumeration -----------------------------
  const profile = await client.user(o.user);
  const userId = profile?.id;
  if (userId == null) throw new Error(`arena-mirror: could not resolve are.na user "${o.user}"`);

  const owned = (await client.listOwnedChannels(o.user, userId)).filter(
    (ch) => !ch.state || ch.state === 'available',
  );
  const privateSkipped = o.includePrivate ? [] : owned.filter((ch) => ch.visibility === 'private');
  const scoped = o.includePrivate ? owned : owned.filter((ch) => ch.visibility !== 'private');
  if (privateSkipped.length) {
    log(`skipping ${privateSkipped.length} private channel(s) — PDS records are public; use includePrivate to mirror them anyway.`);
  }
  log(`are.na: ${owned.length} owned channel(s), ${scoped.length} in scope.`);

  const inSubset = (ch) =>
    !o.channels || o.channels.includes(ch.slug) || o.channels.includes(String(ch.id));

  // --- 2. sync state + cheap no-op shortcut ---------------------------------
  // One definition of per-channel "unchanged": the persisted entry and the
  // comparison are built from the same mapper.
  const freshnessEntry = (ch) => ({
    arenaId: ch.id,
    updatedAt: ch.updated_at || null,
    contents: ch.counts?.contents ?? null,
  });
  const state = await getRecord(agent, did, cols.sync, 'self');
  const freshnessValid = Boolean(state && state.settings === signature && !o.full);
  const stateEntries = new Map(
    freshnessValid ? (state.channels || []).map((c) => [asId(c.arenaId), c]) : [],
  );
  const isFresh = (ch) => {
    const entry = stateEntries.get(asId(ch.id));
    const want = freshnessEntry(ch);
    return Boolean(entry && entry.updatedAt === want.updatedAt && entry.contents === want.contents);
  };

  if (freshnessValid && !state.partial && !o.channels) {
    const sameSet =
      scoped.length === stateEntries.size && scoped.every((ch) => stateEntries.has(asId(ch.id)));
    if (sameSet && scoped.every(isFresh)) {
      // Freshness says nothing changed upstream — but confirm the mirror
      // records themselves still exist before trusting the state record
      // (they could have been wiped by hand while the sync record survived).
      const probe = await agent.com.atproto.repo.listRecords({ repo: did, collection: cols.channel, limit: 1 });
      if (probe?.data?.records?.length || stateEntries.size === 0) {
        log('no channel changed since last sync — skipping.');
        return { noop: true, channelsSeen: scoped.length, privateSkipped: privateSkipped.length, arenaRequests: client.requestCount };
      }
      log('sync state says fresh but no mirror records exist — re-walking everything.');
      stateEntries.clear();
    }
  }

  // --- 3. what the PDS already holds ----------------------------------------
  const [existingChannels, existingBlocks, existingConns] = (
    await Promise.all([
      listCollection(agent, did, cols.channel),
      listCollection(agent, did, cols.block),
      listCollection(agent, did, cols.connection),
    ])
  ).map(indexByRkey);
  const localOnly = existingChannels.localOnly + existingBlocks.localOnly + existingConns.localOnly;
  log(
    `pds: ${existingChannels.map.size} channel, ${existingBlocks.map.size} block, ` +
      `${existingConns.map.size} connection record(s)${localOnly ? ` (${localOnly} local-only, untouched)` : ''}.`,
  );

  const channelUriFor = (id) => `at://${did}/${cols.channel}/${id}`;
  const blockUriFor = (id) => `at://${did}/${cols.block}/${id}`;
  const scopedIds = new Set(scoped.map((ch) => asId(ch.id)));

  // --- 4. walk changed channels ---------------------------------------------
  const writes = { created: 0, updated: 0, unchanged: 0, deleted: 0, failed: 0 };
  const blobs = { uploaded: 0, uploadedBytes: 0, reused: 0, fallback: 0, planned: 0, plannedBytes: 0 };
  const liveConnIds = new Set(); // every connection alive upstream (in scope)
  const mirroredBlockIds = new Set(); // blocks that should have records under current scope
  const processedBlocks = new Set(); // per-run dedupe: a block in N channels maps to 1 record
  const completed = new Map(stateEntries); // channel id → freshness entry, persisted at the end
  let blocksExternal = 0;
  let channelsWalked = 0;
  let channelsFresh = 0;
  let channelsUnvisited = 0;
  let partial = false;

  const decideOp = (ops, collection, rkey, value, existingMap) => {
    const existing = existingMap.get(rkey);
    if (!existing) {
      ops.push({ type: 'create', collection, rkey, value });
      writes.created++;
    } else if (!valuesEqual(existing, value)) {
      ops.push({ type: 'update', collection, rkey, value });
      writes.updated++;
    } else {
      writes.unchanged++;
    }
  };

  // Carry an existing blob forward when the upstream file hasn't changed;
  // fetch a new one only in blobs mode. A blob is never dropped outright:
  // when a refresh can't happen (too large, download failed, references
  // mode), the previous blob rides along with the metadata it was captured
  // under, and the metadata mismatch retries the refresh on a later run.
  const handleMedia = async (candidate, media, existing) => {
    if (!media || !candidate[media.field]) return;
    const target = candidate[media.field];
    const prior = existing?.[media.field];
    const unchanged =
      prior?.blob &&
      prior[media.urlKey] === target[media.urlKey] &&
      prior.updatedAt === target.updatedAt &&
      prior.fileSize === target.fileSize;
    if (unchanged) {
      target.blob = prior.blob;
      blobs.reused++;
      return;
    }
    const keepPrior = () => {
      if (!prior?.blob) return;
      target.blob = prior.blob;
      if (prior.updatedAt != null) target.updatedAt = prior.updatedAt;
      if (prior.fileSize != null) target.fileSize = prior.fileSize;
      if (prior[media.urlKey] != null) target[media.urlKey] = prior[media.urlKey];
    };
    if (o.mediaMode !== 'blobs') {
      keepPrior();
      if (prior?.blob) blobs.reused++;
      return;
    }
    if (media.fileSize && media.fileSize > o.maxBlobBytes) {
      keepPrior();
      blobs.fallback++;
      return;
    }
    if (o.dryRun) {
      blobs.planned++;
      blobs.plannedBytes += media.fileSize || 0;
      return;
    }
    try {
      const dl = await client.fetchBinary(media.url, { maxBytes: o.maxBlobBytes });
      const ref = await uploadBlob(agent, dl.bytes, target.contentType || dl.contentType, { pacer });
      if (!ref) throw new Error('uploadBlob returned no ref');
      target.blob = ref;
      blobs.uploaded++;
      blobs.uploadedBytes += dl.bytes.byteLength;
    } catch (err) {
      if (err instanceof WritePauseNeeded) throw err; // rate pause is not a per-blob failure
      keepPrior();
      blobs.fallback++;
      log(`  blob refresh skipped for ${media.url} (${err.message}) — ${prior?.blob ? 'kept previous blob' : 'reference only'}`);
    }
  };

  // Fresh channels aren't walked; their existing connection records are, by
  // definition of freshness, still the upstream truth — reuse them for the
  // deletion accounting. Grouped once up front instead of rescanning every
  // connection per channel.
  const connsByChannelUri = new Map();
  for (const value of existingConns.map.values()) {
    if (!value?.channel) continue;
    let bucket = connsByChannelUri.get(value.channel);
    if (!bucket) connsByChannelUri.set(value.channel, (bucket = []));
    bucket.push(value);
  }
  const creditExistingChannel = (ch) => {
    for (const value of connsByChannelUri.get(channelUriFor(ch.id)) || []) {
      if (value?.origin?.arenaId != null) liveConnIds.add(asId(value.origin.arenaId));
      if (value?.target?.type === 'block' && value.target.uri && value.target.arenaId != null) {
        mirroredBlockIds.add(asId(value.target.arenaId));
      }
    }
  };

  const overBudget = () => Boolean(o.timeBudgetMs && Date.now() - startedAt > o.timeBudgetMs);
  let suspectChannels = 0;
  let rateLimited = false;

  try {
   for (const ch of scoped) {
    const chId = asId(ch.id);
    if (overBudget()) {
      partial = true;
      channelsUnvisited++;
      continue; // keep counting the rest as unvisited
    }
    if (!inSubset(ch)) {
      channelsUnvisited++;
      continue;
    }
    if (isFresh(ch) && existingChannels.map.has(chId)) {
      channelsFresh++;
      creditExistingChannel(ch);
      continue;
    }

    const ops = [];
    decideOp(ops, cols.channel, chId, channelValue(ch, { type: cols.channel, now: ts }), existingChannels.map);

    let itemsYielded = 0;
    let abortedMidWalk = false;
    for await (const item of client.channelContents(ch.id)) {
      // Checked per item, not just per channel, so one huge channel (or slow
      // blob fetches) can't blow past a serverless deadline before the sync
      // state is persisted.
      if (overBudget()) {
        partial = true;
        abortedMidWalk = true;
        break;
      }
      if (item?.id == null) continue;
      itemsYielded++;
      if (item.state && item.state !== 'available') continue;
      const conn = item.connection;
      if (conn?.id == null) continue;
      liveConnIds.add(asId(conn.id));

      let targetUri = null;
      if (item.type === 'Channel') {
        // Nested channel: only point at a local record when that channel is
        // itself mirrored (owned + in privacy scope).
        if (scopedIds.has(asId(item.id))) targetUri = channelUriFor(item.id);
      } else {
        const mine = item.user?.id === userId;
        if (o.blockScope === 'connected' || mine) {
          mirroredBlockIds.add(asId(item.id));
          targetUri = blockUriFor(item.id);
          if (!processedBlocks.has(asId(item.id))) {
            processedBlocks.add(asId(item.id));
            const { value, media } = blockValue(item, { type: cols.block, now: ts });
            await handleMedia(value, media, existingBlocks.map.get(asId(item.id)));
            decideOp(ops, cols.block, asId(item.id), value, existingBlocks.map);
          }
        } else {
          blocksExternal++;
        }
      }

      decideOp(
        ops,
        cols.connection,
        asId(conn.id),
        connectionValue(item, { type: cols.connection, channelUri: channelUriFor(ch.id), targetUri, now: ts }),
        existingConns.map,
      );
    }

    // A walk that yielded suspiciously little (transient empty/truncated
    // response) must not become deletion authority or be marked fresh —
    // otherwise one flaky response wipes the channel's records and the wipe
    // sticks. Nested channels aren't served by v3 /contents, so compare
    // against counts.blocks, not counts.contents.
    const expectedBlocks = ch.counts?.blocks ?? null;
    const suspectWalk = !abortedMidWalk && expectedBlocks != null && itemsYielded < expectedBlocks;
    if (suspectWalk) {
      suspectChannels++;
      creditExistingChannel(ch);
      log(
        `channel "${ch.title}" (${ch.slug}): contents yielded ${itemsYielded} of ${expectedBlocks} expected block(s) — ` +
          'applying upserts but keeping existing records and re-walking next run.',
      );
    }

    let chFailed = 0;
    if (!o.dryRun && ops.length) {
      const res = await applyOps(agent, did, ops, { log, pacer });
      chFailed = res.fail;
      writes.failed += res.fail;
    }
    channelsWalked++;
    // Only a complete, fully-written walk earns a freshness entry; anything
    // else must be retried next run.
    if (!abortedMidWalk && !suspectWalk && chFailed === 0) {
      completed.set(chId, freshnessEntry(ch));
    }
    log(`channel "${ch.title}" (${ch.slug}): ${ops.length} write(s)${chFailed ? `, ${chFailed} FAILED` : ''}.`);
    // After a mid-walk abort the loop keeps going only to tally the rest as
    // unvisited — the top-of-loop budget check short-circuits each of them.
   }
  } catch (err) {
    if (!(err instanceof WritePauseNeeded)) throw err;
    // Out of write budget for now: stop starting work, keep everything
    // already written, and resume on the next run. The channel being written
    // when this fired isn't marked fresh, so its remaining records are
    // reconciled next time (idempotent — re-listed records upsert, not
    // duplicate).
    partial = true;
    rateLimited = true;
    log(err.message + ' — run is partial; rerun (or the next cron) resumes.');
  }

  // --- 5. deletion pass (complete runs only) ---------------------------------
  const subset = Boolean(o.channels);
  let deletesAllowed = !subset && !partial && scoped.length > 0;
  if (scoped.length === 0 && existingChannels.map.size > 0) {
    log('warning: are.na reports zero in-scope channels but the PDS holds mirror records — refusing to delete anything.');
  }
  if (o.includePrivate && !client.token && deletesAllowed) {
    // Without a token are.na silently omits private channels, which would
    // read as "deleted upstream" and wipe their records.
    deletesAllowed = false;
    log('warning: includePrivate is on but no are.na token is set — private channels are invisible this run, skipping deletions to protect their records.');
  }
  if (deletesAllowed) {
    const stale = [];
    for (const [rkey, value] of existingChannels.map) {
      if (value?.origin?.arenaId == null) continue;
      if (!scopedIds.has(asId(value.origin.arenaId))) stale.push({ type: 'delete', collection: cols.channel, rkey });
    }
    // A sudden mass channel disappearance is more likely an enumeration
    // hiccup (or auth change) than a real purge; require --full to confirm.
    const staleChannelCount = stale.length;
    if (!o.full && staleChannelCount > 3 && staleChannelCount > existingChannels.map.size * 0.2) {
      log(
        `warning: deletion pass would remove ${staleChannelCount} of ${existingChannels.map.size} channel records — ` +
          'skipping deletions this run; use --full to confirm a real mass removal.',
      );
      deletesAllowed = false;
    } else {
      for (const [rkey, value] of existingBlocks.map) {
        if (value?.origin?.arenaId == null) continue;
        if (!mirroredBlockIds.has(asId(value.origin.arenaId))) stale.push({ type: 'delete', collection: cols.block, rkey });
      }
      for (const [rkey, value] of existingConns.map) {
        if (value?.origin?.arenaId == null) continue;
        if (!liveConnIds.has(asId(value.origin.arenaId))) stale.push({ type: 'delete', collection: cols.connection, rkey });
      }
      if (o.dryRun) {
        writes.deleted = stale.length;
      } else if (stale.length) {
        try {
          const res = await applyOps(agent, did, stale, { log, pacer });
          writes.deleted = res.ok;
          writes.failed += res.fail;
        } catch (err) {
          if (!(err instanceof WritePauseNeeded)) throw err;
          // All record writes are done by now; deletions just didn't finish.
          // Safe to resume next run — a complete run will re-detect the same
          // stale records.
          partial = true;
          rateLimited = true;
          log(err.message + ' — deletions deferred to the next run.');
        }
      }
    }
  }

  // --- 6. persist sync state --------------------------------------------------
  if (!o.dryRun) {
    const entries = Array.from(completed.values()).filter((c) => scopedIds.has(asId(c.arenaId)));
    await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: cols.sync,
      rkey: 'self',
      record: {
        $type: cols.sync,
        user: { arenaId: userId, slug: o.user },
        settings: signature,
        lastRunAt: ts,
        partial: partial || subset,
        channels: entries,
      },
      validate: false,
    });
  }

  const report = {
    dryRun: o.dryRun || undefined,
    partial: partial || undefined,
    subset: subset || undefined,
    channelsSeen: scoped.length,
    privateSkipped: privateSkipped.length,
    channelsWalked,
    channelsFresh,
    channelsUnvisited,
    suspectChannels: suspectChannels || undefined,
    rateLimited: rateLimited || undefined,
    writePoints: pacer.spentPoints || undefined,
    pausedMs: pacer.paused || undefined,
    blocksExternal,
    writes,
    blobs,
    localOnly,
    arenaRequests: client.requestCount,
  };
  const partialWhy = rateLimited ? 'write rate limit' : 'time budget';
  log(
    `${o.dryRun ? 'dry run — would write' : 'wrote'} ${writes.created} new / ${writes.updated} updated ` +
      `(${writes.unchanged} unchanged), ${o.dryRun ? 'would delete' : 'deleted'} ${writes.deleted}` +
      `${writes.failed ? `, ${writes.failed} FAILED` : ''}${partial ? ` — PARTIAL (${partialWhy}; next run resumes)` : ''}.`,
  );
  return report;
}
