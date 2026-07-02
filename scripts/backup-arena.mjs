#!/usr/bin/env node
// Nightly Are.na backup: mirrors every channel on the account (including
// private ones) into Supabase — metadata as rows, media originals into the
// private `arena-backup` storage bucket.
//
// Runs on the droplet via cron (see header of the run instructions below);
// zero npm dependencies, just Node 18+ global fetch.
//
//   ARENA_ACCESS_TOKEN         required — read-only personal token
//                              (are.na/settings/personal-access-tokens)
//   SUPABASE_URL               required — https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  required — service key (bypasses RLS; the
//                              arena_* tables and bucket have no public
//                              policies, so only this key can touch them)
//
// Flags / overrides:
//   --dry-run                  fetch from are.na and report, write nothing
//   ARENA_BACKUP_CHANNELS      comma-separated channel slugs — skip account
//                              enumeration and back up just these (useful
//                              for smoke tests against public channels)
//
// Behavior:
//   - Channels are enumerated via v3 search (scope=my), falling back to the
//     v2 user-channels endpoint. Both include private channels when
//     authenticated.
//   - A channel whose are.na updated_at matches the stored copy is skipped
//     entirely (no contents requests), so nightly runs only pay for what
//     changed since yesterday.
//   - To exclude a channel from backups permanently, set skip_backup = true
//     on its arena_channels row (Supabase table editor). Its contents,
//     blocks, and media stop being fetched; previously backed-up rows stay
//     until you delete them yourself.
//   - Blocks are upserted by id and never deleted; when a block vanishes
//     from every channel it is flagged removed_at (see the
//     arena_reconcile_removed function). Same for channels.
//   - Media (image originals, attachments) is downloaded once per block and
//     stored at media/<block_id>.<ext>; already-archived blocks are skipped.
//   - Every run writes an arena_backup_runs row for health monitoring.
//
// Suggested crontab on the droplet (repo cloned at ~/dame.is):
//   15 6 * * * cd ~/dame.is && /usr/bin/node scripts/backup-arena.mjs >> ~/arena-backup.log 2>&1

import { fetchChannelPage, arenaAccessToken } from '../src/lib/arena.js';

const ARENA_API = 'https://api.are.na/v3';
const ARENA_API_V2 = 'https://api.are.na/v2';
const USER_AGENT = 'dame.is arena-backup (+https://dame.is)';
const BUCKET = 'arena-backup';
const API_DELAY_MS = 250; // premium tier is 300 req/min; stay well inside it
const MEDIA_CONCURRENCY = 4;
const UPSERT_CHUNK = 200;

const DRY_RUN = process.argv.includes('--dry-run');
const CHANNEL_OVERRIDE = (process.env.ARENA_BACKUP_CHANNELS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const log = (...args) => console.log(`[backup-arena ${new Date().toISOString()}]`, ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- are.na ----------------------------------------------------------------

async function arenaGet(url) {
  const token = arenaAccessToken();
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`are.na HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** All channels on the account, v3 search first, v2 fallback. */
async function listMyChannels() {
  const collected = new Map();
  try {
    for (let page = 1; page < 100; page++) {
      const res = await arenaGet(
        `${ARENA_API}/search?query=%2A&scope=my&type=Channel&per=100&page=${page}`,
      );
      for (const ch of res?.data || []) {
        if (ch?.id) collected.set(ch.id, ch);
      }
      if (!res?.meta?.has_more_pages) break;
      await sleep(API_DELAY_MS);
    }
    if (collected.size > 0) return [...collected.values()];
    log('v3 search returned no channels; falling back to v2');
  } catch (err) {
    log(`v3 search failed (${err.message}); falling back to v2`);
  }
  const me = await arenaGet(`${ARENA_API}/me`);
  for (let page = 1; page < 100; page++) {
    const res = await arenaGet(`${ARENA_API_V2}/users/${me.id}/channels?per=100&page=${page}`);
    for (const ch of res?.channels || []) {
      if (ch?.id) collected.set(ch.id, ch);
    }
    const totalPages = res?.total_pages ?? 1;
    if (page >= totalPages || (res?.channels || []).length === 0) break;
    await sleep(API_DELAY_MS);
  }
  return [...collected.values()];
}

/** Every contents entry of a channel, raw, in position order. */
async function fetchAllContents(slug) {
  const items = [];
  for (let page = 1; page < 500; page++) {
    const res = await fetchChannelPage(slug, page, 100);
    items.push(...(res?.data || []));
    if (!res?.meta?.has_more_pages) break;
    await sleep(API_DELAY_MS);
  }
  return items;
}

/** URL of the best archival copy of a block's file, if it has one. */
function mediaSource(block) {
  if (block?.attachment?.url) {
    return { url: block.attachment.url, ext: extFrom(block.attachment.url, block.attachment.content_type) };
  }
  if (block?.image?.src) {
    return { url: block.image.src, ext: extFrom(block.image.src, block.image.content_type) };
  }
  return null;
}

function extFrom(url, contentType) {
  const m = String(url).split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1].toLowerCase();
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'application/pdf': 'pdf', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3',
  };
  return map[contentType] || 'bin';
}

// --- supabase (PostgREST + storage over plain fetch) ------------------------

async function sb(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`supabase ${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

async function sbUpsert(table, rows, conflict) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await sb(`/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      body: rows.slice(i, i + UPSERT_CHUNK),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  }
}

async function uploadMedia(path, bytes, contentType) {
  await sb(`/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    body: bytes,
    raw: true,
    headers: { 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true' },
  });
}

// --- main --------------------------------------------------------------------

async function main() {
  if (!arenaAccessToken() && CHANNEL_OVERRIDE.length === 0) {
    throw new Error('ARENA_ACCESS_TOKEN is required (or set ARENA_BACKUP_CHANNELS for a public-channel smoke test).');
  }
  if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run).');
  }

  const startedAt = new Date().toISOString();
  let runId = null;
  if (!DRY_RUN) {
    const [run] = await sb('/rest/v1/arena_backup_runs', {
      method: 'POST',
      body: { started_at: startedAt },
      headers: { Prefer: 'return=representation' },
    });
    runId = run.id;
  }

  const errors = [];
  const stats = { channels_total: 0, channels_changed: 0, blocks_upserted: 0, media_downloaded: 0, media_bytes: 0 };

  try {
    // 1. Enumerate channels.
    let channels;
    if (CHANNEL_OVERRIDE.length > 0) {
      channels = [];
      for (const slug of CHANNEL_OVERRIDE) {
        channels.push(await arenaGet(`${ARENA_API}/channels/${encodeURIComponent(slug)}`));
        await sleep(API_DELAY_MS);
      }
    } else {
      channels = await listMyChannels();
    }
    stats.channels_total = channels.length;
    log(`${channels.length} channel(s) on the account`);

    // 2. Which ones changed since the last run? (Owner-flagged skips are
    //    excluded here, before any contents/media work happens.)
    const stored = new Map();
    const skipped = new Set();
    if (!DRY_RUN) {
      const rows = await sb('/rest/v1/arena_channels?select=id,updated_at_arena,skip_backup');
      for (const r of rows) {
        stored.set(r.id, r.updated_at_arena);
        if (r.skip_backup) skipped.add(r.id);
      }
    }
    const changed = channels.filter((ch) => {
      if (skipped.has(ch.id)) return false;
      const prev = stored.get(ch.id);
      return !prev || new Date(prev).getTime() !== new Date(ch.updated_at).getTime();
    });
    stats.channels_changed = changed.length;
    log(`${changed.length} changed since last backup${skipped.size ? `, ${skipped.size} flagged skip_backup` : ''}`);

    // 3. Upsert the channel list itself (refreshes titles/meta cheaply).
    //    Skipped channels are left untouched — refreshing their
    //    updated_at_arena would make a later un-skip look like "no change"
    //    and their contents would never be re-fetched.
    const now = new Date().toISOString();
    const upsertable = channels.filter((ch) => !skipped.has(ch.id));
    if (!DRY_RUN && upsertable.length > 0) {
      await sbUpsert(
        'arena_channels',
        upsertable.map((ch) => ({
          id: ch.id,
          slug: ch.slug,
          title: ch.title || null,
          visibility: ch.visibility || null,
          updated_at_arena: ch.updated_at || null,
          raw: ch,
          last_backed_up_at: now,
          removed_at: null,
        })),
        'id',
      );
    }

    // 4. Fetch contents for changed channels; upsert blocks + connections.
    const blocksById = new Map();
    for (const ch of changed) {
      try {
        const contents = await fetchAllContents(ch.slug);
        const connections = [];
        for (const item of contents) {
          const conn = item?.connection || {};
          const baseType = item?.base_type === 'Channel' || item?.type === 'Channel' ? 'Channel' : 'Block';
          connections.push({
            channel_id: ch.id,
            item_id: item.id,
            item_base_type: baseType,
            connection_id: conn.id ?? null,
            position: conn.position ?? null,
            connected_at: conn.connected_at ?? null,
            pinned: conn.pinned ?? null,
            raw: baseType === 'Channel' ? item : conn,
          });
          if (baseType === 'Block') {
            const { connection, ...block } = item;
            blocksById.set(block.id, block);
          }
        }
        log(`  ${ch.slug}: ${contents.length} item(s)`);
        if (!DRY_RUN) {
          // Rebuild this channel's connection set atomically enough for a
          // nightly job: delete then bulk insert.
          await sb(`/rest/v1/arena_connections?channel_id=eq.${ch.id}`, { method: 'DELETE' });
          if (connections.length > 0) {
            await sbUpsert('arena_connections', connections, 'channel_id,item_id,item_base_type');
          }
        }
        await sleep(API_DELAY_MS);
      } catch (err) {
        errors.push({ channel: ch.slug, error: String(err.message || err) });
        log(`  ${ch.slug} FAILED: ${err.message}`);
      }
    }

    if (!DRY_RUN && blocksById.size > 0) {
      await sbUpsert(
        'arena_blocks',
        [...blocksById.values()].map((b) => ({
          id: b.id,
          type: b.type || null,
          title: b.title || null,
          raw: b,
          updated_at_arena: b.updated_at || null,
          removed_at: null,
        })),
        'id',
      );
    }
    stats.blocks_upserted = blocksById.size;

    // 5. Archive media for blocks that don't have a copy yet.
    if (!DRY_RUN && blocksById.size > 0) {
      const ids = [...blocksById.keys()];
      const have = new Set();
      for (let i = 0; i < ids.length; i += 200) {
        const rows = await sb(
          `/rest/v1/arena_blocks?select=id&media_path=not.is.null&id=in.(${ids.slice(i, i + 200).join(',')})`,
        );
        for (const r of rows) have.add(r.id);
      }
      const todo = [...blocksById.values()].filter((b) => !have.has(b.id) && mediaSource(b));
      log(`${todo.length} media file(s) to archive`);
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(MEDIA_CONCURRENCY, todo.length) }, async () => {
          while (cursor < todo.length) {
            const block = todo[cursor++];
            const src = mediaSource(block);
            try {
              const res = await fetch(src.url, { headers: { 'User-Agent': USER_AGENT } });
              if (!res.ok) throw new Error(`media HTTP ${res.status}`);
              const bytes = Buffer.from(await res.arrayBuffer());
              const path = `media/${block.id}.${src.ext}`;
              await uploadMedia(path, bytes, res.headers.get('content-type'));
              await sb(`/rest/v1/arena_blocks?id=eq.${block.id}`, {
                method: 'PATCH',
                body: { media_path: path, media_bytes: bytes.length },
                headers: { Prefer: 'return=minimal' },
              });
              stats.media_downloaded += 1;
              stats.media_bytes += bytes.length;
            } catch (err) {
              errors.push({ block: block.id, error: String(err.message || err) });
            }
          }
        }),
      );
    } else if (DRY_RUN) {
      const todo = [...blocksById.values()].filter((b) => mediaSource(b));
      log(`dry-run: ${todo.length} block(s) carry archivable media`);
    }

    // 6. Reconcile removals (skip when running against an override subset —
    //    a partial view would wrongly flag everything else as removed).
    if (!DRY_RUN && CHANNEL_OVERRIDE.length === 0) {
      const result = await sb('/rest/v1/rpc/arena_reconcile_removed', {
        method: 'POST',
        body: { current_channel_ids: channels.map((c) => c.id) },
      });
      log('reconcile:', JSON.stringify(result));
    }

    log(
      `done: ${stats.channels_changed}/${stats.channels_total} channels refreshed, ` +
        `${stats.blocks_upserted} blocks upserted, ${stats.media_downloaded} media files ` +
        `(${(stats.media_bytes / 1024 / 1024).toFixed(1)} MB), ${errors.length} error(s)`,
    );
  } finally {
    if (!DRY_RUN && runId != null) {
      await sb(`/rest/v1/arena_backup_runs?id=eq.${runId}`, {
        method: 'PATCH',
        body: {
          finished_at: new Date().toISOString(),
          ok: errors.length === 0,
          ...stats,
          errors: errors.length > 0 ? errors : null,
        },
        headers: { Prefer: 'return=minimal' },
      }).catch((err) => log(`failed to finalize run row: ${err.message}`));
    }
  }

  if (errors.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[backup-arena] fatal', err);
  process.exitCode = 1;
});
