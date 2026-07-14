// Vercel serverless function: keep the are.na → PDS mirror fresh. Wired into
// vercel.json as a daily cron; the same work can be run locally (and should
// be, for the first big backfill) with `node scripts/mirror-arena.mjs`.
//
// Incremental: unchanged channels are skipped via the sync-state record, so
// the daily run is usually a handful of are.na requests. A time budget under
// the function limit makes big catch-up runs stop cleanly and resume on the
// next firing instead of dying mid-write.
//
// Behavior is configured with env vars so the cron and the CLI can be kept in
// agreement (see arena-mirror/README.md):
//   ARENA_MIRROR_SCOPE            connected (default) | created
//   ARENA_MIRROR_MEDIA            references (default) | blobs
//   ARENA_MIRROR_INCLUDE_PRIVATE  '1'/'true' to mirror private channels (PDS records are public!)
//   ARENA_MIRROR_MAX_BLOB_MB      blob cap in MB (default 5)
//
// Auth: if CRON_SECRET is set, the request must carry
// `Authorization: Bearer <CRON_SECRET>` (Vercel sends this automatically for
// cron invocations). Requires BSKY_APP_PASSWORD (+ optional BSKY_IDENTIFIER),
// and ARENA_ACCESS_TOKEN for the account's rate tier.

import { AtpAgent } from '@atproto/api';

import { ME_HANDLE, ARENA_USER } from '../src/config.js';
import { resolveIdentifier } from '../src/lib/atproto.js';
import { syncArenaMirror } from '../arena-mirror/index.js';

export const config = { maxDuration: 60 };

const flag = (v) => v === '1' || v === 'true' || v === 'yes';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers?.authorization || '';
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const identifier = process.env.BSKY_IDENTIFIER || process.env.ATP_IDENTIFIER || ME_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD || process.env.ATP_APP_PASSWORD;
  if (!password) {
    return res.status(500).json({ error: 'BSKY_APP_PASSWORD is not configured.' });
  }

  try {
    const { did, pds } = await resolveIdentifier(identifier);
    const agent = new AtpAgent({ service: pds });
    await agent.login({ identifier, password });

    const user = process.env.ARENA_MIRROR_USER || ARENA_USER;
    const report = await syncArenaMirror({
      agent,
      did,
      user,
      token:
        process.env.ARENA_ACCESS_TOKEN || process.env.ARENA_TOKEN || process.env.ARENA_API_KEY,
      blockScope: process.env.ARENA_MIRROR_SCOPE || 'connected',
      mediaMode: process.env.ARENA_MIRROR_MEDIA || 'references',
      includePrivate: flag(process.env.ARENA_MIRROR_INCLUDE_PRIVATE || ''),
      maxBlobBytes: process.env.ARENA_MIRROR_MAX_BLOB_MB
        ? Math.round(Number(process.env.ARENA_MIRROR_MAX_BLOB_MB) * 1024 * 1024)
        : undefined,
      // Leave headroom under maxDuration for the deletion pass + state write.
      timeBudgetMs: 45_000,
      log: (...a) => console.log('[mirror-arena]', ...a),
    });

    return res.status(report.writes?.failed ? 207 : 200).json({ ok: true, user, ...report });
  } catch (err) {
    console.error('[mirror-arena] failed:', err);
    return res.status(500).json({ error: err?.message || 'mirror failed' });
  }
}
