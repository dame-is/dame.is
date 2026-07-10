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
import { listCollection, getRecord, applyOps, uploadBlob } from './pds.js';

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
  const state = await getRecord(agent, did, cols.sync, 'self');
  const freshnessValid = Boolean(state && state.settings === signature && !o.full);
  const stateEntries = new Map(
    freshnessValid ? (state.channels || []).map((c) => [asId(c.arenaId), c]) : [],
  );
  const isFresh = (ch) => {
    const entry = stateEntries.get(asId(ch.id));
    return Boolean(
      entry && entry.updatedAt === ch.updated_at && entry.contents === (ch.counts?.contents ?? null),
    );
  };

  if (freshnessValid && !state.partial && !o.channels) {
    const sameSet =
      scoped.length === stateEntries.size && scoped.every((ch) => stateEntries.has(asId(ch.id)));
    if (sameSet && scoped.every(isFresh)) {
      log('no channel changed since last sync — skipping.');
      return { noop: true, channelsSeen: scoped.length, privateSkipped: privateSkipped.length, arenaRequests: client.requestCount };
    }
  }

  // --- 3. what the PDS already holds ----------------------------------------
  const existingChannels = indexByRkey(await listCollection(agent, did, cols.channel));
  const existingBlocks = indexByRkey(await listCollection(agent, did, cols.block));
  const existingConns = indexByRkey(await listCollection(agent, did, cols.connection));
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
  // fetch a new one only in blobs mode. Blobs are never proactively stripped
  // by a references-mode run — that mode just stops acquiring new ones.
  const handleMedia = async (candidate, media, existing) => {
    if (!media || !candidate[media.field]) return;
    const target = candidate[media.field];
    const prior = existing?.[media.field];
    if (prior?.blob && prior.updatedAt === target.updatedAt && prior.fileSize === target.fileSize) {
      target.blob = prior.blob;
      blobs.reused++;
      return;
    }
    if (o.mediaMode !== 'blobs') return;
    if (media.fileSize && media.fileSize > o.maxBlobBytes) {
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
      const ref = await uploadBlob(agent, dl.bytes, target.contentType || dl.contentType);
      if (ref) {
        target.blob = ref;
        blobs.uploaded++;
        blobs.uploadedBytes += dl.bytes.byteLength;
      } else {
        blobs.fallback++;
      }
    } catch (err) {
      blobs.fallback++;
      log(`  blob skipped for block ${media.url} (${err.message}) — kept as reference`);
    }
  };

  // Fresh channels aren't walked; their existing connection records are, by
  // definition of freshness, still the upstream truth — reuse them for the
  // deletion accounting.
  const creditExistingChannel = (ch) => {
    const chUri = channelUriFor(ch.id);
    for (const value of existingConns.map.values()) {
      if (value?.channel !== chUri) continue;
      if (value?.origin?.arenaId != null) liveConnIds.add(asId(value.origin.arenaId));
      if (value?.target?.type === 'block' && value.target.uri && value.target.arenaId != null) {
        mirroredBlockIds.add(asId(value.target.arenaId));
      }
    }
  };

  for (const ch of scoped) {
    const chId = asId(ch.id);
    if (o.timeBudgetMs && Date.now() - startedAt > o.timeBudgetMs) {
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

    for await (const item of client.channelContents(ch.id)) {
      if (item?.id == null) continue;
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

    if (!o.dryRun && ops.length) {
      const res = await applyOps(agent, did, ops, { log });
      writes.failed += res.fail;
    }
    channelsWalked++;
    completed.set(chId, {
      arenaId: ch.id,
      updatedAt: ch.updated_at || null,
      contents: ch.counts?.contents ?? null,
    });
    log(`channel "${ch.title}" (${ch.slug}): ${ops.length} write(s).`);
  }

  // --- 5. deletion pass (complete runs only) ---------------------------------
  const subset = Boolean(o.channels);
  const deletesAllowed = !subset && !partial && scoped.length > 0;
  if (!deletesAllowed && scoped.length === 0 && existingChannels.map.size > 0) {
    log('warning: are.na reports zero in-scope channels but the PDS holds mirror records — refusing to delete anything.');
  }
  if (deletesAllowed) {
    const stale = [];
    for (const [rkey, value] of existingChannels.map) {
      if (value?.origin?.arenaId == null) continue;
      if (!scopedIds.has(asId(value.origin.arenaId))) stale.push({ type: 'delete', collection: cols.channel, rkey });
    }
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
      const res = await applyOps(agent, did, stale, { log });
      writes.deleted = res.ok;
      writes.failed += res.fail;
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
    blocksExternal,
    writes,
    blobs,
    localOnly,
    arenaRequests: client.requestCount,
  };
  log(
    `${o.dryRun ? 'dry run — would write' : 'wrote'} ${writes.created} new / ${writes.updated} updated ` +
      `(${writes.unchanged} unchanged), ${o.dryRun ? 'would delete' : 'deleted'} ${writes.deleted}` +
      `${writes.failed ? `, ${writes.failed} FAILED` : ''}${partial ? ' — PARTIAL (time budget hit, next run resumes)' : ''}.`,
  );
  return report;
}
