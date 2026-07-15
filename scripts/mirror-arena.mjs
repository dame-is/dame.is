#!/usr/bin/env node
// Mirror your are.na account onto your PDS.
//
// Channels, blocks, and connections become `is.dame.arena.mirror.*` records
// keyed by their are.na ids; media can optionally be captured as PDS blobs.
// The engine lives in `arena-mirror/` (self-contained, host-agnostic); this
// script is the dame.is wiring around it. Incremental by default — unchanged
// channels are skipped via the sync-state record — so re-runs are cheap.
//
// Usage:
//   ARENA_ACCESS_TOKEN=xxxx BSKY_IDENTIFIER=dame.is BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
//     node scripts/mirror-arena.mjs [flags]
//
//   --dry-run             Plan the sync and print what would change, writing nothing.
//                         Works without an app password (public reads only).
//   --full                Ignore freshness markers and re-walk every channel.
//   --scope MODE          connected (default) — every block in your channels;
//                         created — only blocks you authored get block records
//                         (your connections to others' blocks stay references).
//   --media MODE          references (default) — store are.na file URLs + metadata;
//                         blobs — also capture image/attachment originals as PDS blobs.
//   --max-blob-mb N       Blob size cap in MB (default 5, the typical PDS upload limit).
//   --include-private     Mirror private channels too. PDS records are PUBLIC —
//                         leave this off unless you understand that.
//   --channels a,b,c      Only sync these channel slugs/ids (testing; skips deletions).
//   --budget-s N          Stop cleanly after ~N seconds; next run resumes.
//   --drain               Attended backfill: sleep through PDS rate-limit windows
//                         (up to ~65 min) and keep going, instead of stopping at
//                         the first wall. One --drain run spends a full day's write
//                         budget (~11k records) then pauses on the daily cap; rerun
//                         the next day to continue. Without it, the run stops at the
//                         first sustained limit and you rerun to resume.
//   --user SLUG           are.na profile slug (default: ARENA_USER from src/config.js).
//   --pds URL             Override the PDS endpoint (default: resolved from your DID).
//
// First backfill advice: a PDS caps record writes (~5k points/hr, ~35k/day;
// create=3pts), so a big account is a multi-day job. Run it from here with
// --drain and let it grind; rerun daily until it reports no more work. Consider
// --media references first (no blob bandwidth) and --scope created to shrink the
// blob volume. The daily cron then keeps it fresh — keep its ARENA_MIRROR_* env
// vars matching the flags you use here.

import { AtpAgent } from '@atproto/api';

import { ME_HANDLE, ARENA_USER } from '../src/config.js';
import { resolveIdentifier } from '../src/lib/atproto.js';
import { syncArenaMirror } from '../arena-mirror/index.js';

const log = (...a) => console.log('[mirror-arena]', ...a);
const die = (msg) => {
  console.error('[mirror-arena] ERROR:', msg);
  process.exit(1);
};

function parseArgs(argv) {
  const args = {
    dryRun: false,
    full: false,
    includePrivate: false,
    scope: 'connected',
    media: 'references',
    maxBlobMb: null,
    channels: null,
    budgetS: null,
    drain: false,
    user: null,
    pds: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--full') args.full = true;
    else if (a === '--include-private') args.includePrivate = true;
    else if (a === '--scope') args.scope = argv[++i];
    else if (a === '--media') args.media = argv[++i];
    else if (a === '--max-blob-mb') args.maxBlobMb = Number(argv[++i]);
    else if (a === '--channels') args.channels = String(argv[++i] || '').split(',');
    else if (a === '--budget-s') args.budgetS = Number(argv[++i]);
    else if (a === '--drain') args.drain = true;
    else if (a === '--user') args.user = argv[++i];
    else if (a === '--pds') args.pds = argv[++i];
    else die(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const identifier = process.env.BSKY_IDENTIFIER || process.env.ATP_IDENTIFIER || ME_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD || process.env.ATP_APP_PASSWORD;
  const token =
    process.env.ARENA_ACCESS_TOKEN || process.env.ARENA_TOKEN || process.env.ARENA_API_KEY;
  if (!token) log('note: no ARENA_ACCESS_TOKEN set — using the 30 req/min guest tier, private channels invisible.');

  let did;
  let pds = args.pds;
  try {
    const ident = await resolveIdentifier(identifier);
    did = ident.did;
    if (!pds) pds = ident.pds;
  } catch (err) {
    return die(`could not resolve identity for "${identifier}": ${err.message}`);
  }
  log(`identity: ${identifier} → ${did}`);
  log(`pds: ${pds}`);

  if (!password && !args.dryRun) {
    die(
      'missing app password. Set BSKY_APP_PASSWORD (and optionally BSKY_IDENTIFIER). ' +
        'Create one at https://bsky.app/settings/app-passwords. Use --dry-run to preview.',
    );
  }

  const agent = new AtpAgent({ service: pds });
  if (password) {
    try {
      await agent.login({ identifier, password });
    } catch (err) {
      return die(`login failed: ${err.message}`);
    }
  }

  try {
    const report = await syncArenaMirror({
      agent,
      did,
      user: args.user || ARENA_USER,
      token,
      blockScope: args.scope,
      mediaMode: args.media,
      includePrivate: args.includePrivate,
      maxBlobBytes: args.maxBlobMb ? Math.round(args.maxBlobMb * 1024 * 1024) : undefined,
      channels: args.channels,
      timeBudgetMs: args.budgetS ? args.budgetS * 1000 : null,
      // --drain sleeps through the hourly window (~65 min) to keep going; the
      // default rides out short waits but stops at a sustained wall to resume.
      writeMaxSleepMs: args.drain ? 65 * 60 * 1000 : undefined,
      full: args.full,
      dryRun: args.dryRun,
      log,
    });
    log('report:', JSON.stringify(report, null, 2));
    if (report.partial) {
      log(
        report.rateLimited
          ? 'Stopped at the PDS write limit — rerun to continue (or --drain to sleep through the window).'
          : 'Partial run — rerun to continue.',
      );
    } else if (!args.dryRun) {
      log('Backfill complete — nothing left to sync.');
    }
    if (report.writes?.failed) process.exitCode = 2;
  } catch (err) {
    die(err.stack || err.message);
  }
}

main();
