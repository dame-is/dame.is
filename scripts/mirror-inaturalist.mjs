#!/usr/bin/env node
// Mirror moth observations from iNaturalist onto your PDS.
//
// Writes one `is.dame.mothing/self` summary record plus one
// `is.dame.mothing.observation/<inatId>` record per observation, so your
// moth log lives as first-class atproto data you own. Location is never
// mirrored — `src/lib/inaturalist.js` strips coordinates, place names, and
// timezone before anything is built.
//
// Idempotent: every record is written with `putRecord` keyed by its iNat id
// (`rkey`), so re-running updates records in place. Pass `--prune` to also
// delete observation records that no longer exist in iNaturalist.
//
// Usage:
//   BSKY_IDENTIFIER=dame.is BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
//     node scripts/mirror-inaturalist.mjs [--dry-run] [--prune] [--max N] [--pds url]
//
//   --dry-run   Build + print every record without writing anything.
//   --prune     Delete PDS observation records absent from the fresh pull.
//   --max N     Cap how many observations to mirror (default: all).
//   --pds URL   Override the PDS endpoint (default: resolved from your DID).
//
// Get an app password at https://bsky.app/settings/app-passwords. Never commit it.

import { AtpAgent } from '@atproto/api';

import {
  ME_HANDLE,
  INATURALIST_USER,
  MOTHING_NSID,
  MOTHING_OBSERVATION_NSID,
} from '../src/config.js';
import { resolveIdentifier, listRecords, rkeyFromAtUri } from '../src/lib/atproto.js';
import { fetchMothData, buildMirrorWrites } from '../src/lib/inaturalist.js';

const log = (...a) => console.log('[mirror-inat]', ...a);
const die = (msg) => {
  console.error('[mirror-inat] ERROR:', msg);
  process.exit(1);
};

function parseArgs(argv) {
  const args = { dryRun: false, prune: false, max: 1000, pds: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--prune') args.prune = true;
    else if (a === '--max') args.max = Number(argv[++i]) || args.max;
    else if (a === '--pds') args.pds = argv[++i];
    else die(`unknown argument: ${a}`);
  }
  return args;
}

// Run `worker` over `items` with bounded concurrency; collect { ok, fail }.
async function pool(items, size, worker) {
  let i = 0;
  let ok = 0;
  let fail = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        await worker(items[idx]);
        ok++;
      } catch (err) {
        fail++;
        console.error(`[mirror-inat] ✗ ${items[idx]?.collection}/${items[idx]?.rkey}: ${err.message}`);
      }
    }
  });
  await Promise.all(runners);
  return { ok, fail };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  log(`fetching moths for iNaturalist user "${INATURALIST_USER}"…`);
  const { stats, observations } = await fetchMothData({ user: INATURALIST_USER, max: args.max });
  log(`fetched ${observations.length} observation(s), ${stats.speciesCount} species.`);

  const now = new Date().toISOString();
  const { summary, records } = buildMirrorWrites({ observations, stats, now });
  const writes = [summary, ...records];

  const identifier = process.env.BSKY_IDENTIFIER || process.env.ATP_IDENTIFIER || ME_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD || process.env.ATP_APP_PASSWORD;

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

  if (args.dryRun) {
    log('--dry-run: the following records would be written:\n');
    console.log(`# at://${did}/${summary.collection}/${summary.rkey}`);
    console.log(JSON.stringify(summary.value, null, 2));
    console.log(`\n… and ${records.length} observation record(s), e.g.:\n`);
    if (records[0]) {
      console.log(`# at://${did}/${records[0].collection}/${records[0].rkey}`);
      console.log(JSON.stringify(records[0].value, null, 2));
    }
    log(`dry run complete — ${writes.length} record(s) not written.`);
    return;
  }

  if (!password) {
    die(
      'missing app password. Set BSKY_APP_PASSWORD (and optionally BSKY_IDENTIFIER). ' +
        'Create one at https://bsky.app/settings/app-passwords. Use --dry-run to preview.',
    );
  }

  const agent = new AtpAgent({ service: pds });
  try {
    await agent.login({ identifier, password });
  } catch (err) {
    return die(`login failed: ${err.message}`);
  }
  log(`signed in as ${agent.session?.handle || identifier}`);

  const { ok, fail } = await pool(writes, 6, async (w) => {
    await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: w.collection,
      rkey: w.rkey,
      record: w.value,
      validate: false, // is.dame.* lexicons aren't published to the PDS
    });
  });
  log(`wrote ${ok}/${writes.length} record(s)${fail ? ` (${fail} failed)` : ''}.`);

  if (args.prune) {
    const keep = new Set(records.map((r) => r.rkey));
    let existing = [];
    try {
      existing = await listRecords(pds, { repo: did, collection: MOTHING_OBSERVATION_NSID, max: 5000 });
    } catch (err) {
      log(`prune skipped — could not list existing records: ${err.message}`);
    }
    const stale = existing
      .map((r) => rkeyFromAtUri(r.uri))
      .filter((rk) => rk && !keep.has(rk));
    if (stale.length) {
      const res = await pool(
        stale.map((rk) => ({ collection: MOTHING_OBSERVATION_NSID, rkey: rk })),
        6,
        async (d) => {
          await agent.com.atproto.repo.deleteRecord({
            repo: did,
            collection: d.collection,
            rkey: d.rkey,
          });
        },
      );
      log(`pruned ${res.ok}/${stale.length} stale observation record(s).`);
    } else {
      log('prune: nothing stale to remove.');
    }
  }

  log(`done — summary at://${did}/${MOTHING_NSID}/self`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[mirror-inat] fatal', err);
  process.exitCode = 1;
});
