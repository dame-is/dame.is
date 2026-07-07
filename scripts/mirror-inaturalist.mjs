#!/usr/bin/env node
// Mirror your iNaturalist observations onto your PDS.
//
// Pulls every observation once and splits each by taxonomy: moths
// (Lepidoptera minus butterflies) become `is.dame.mothing.observation`
// records, everything else becomes `is.dame.observing.observation` records,
// plus an `is.dame.mothing/self` and `is.dame.observing/self` summary. So
// your whole nature log lives as first-class atproto data you own, and each
// entry rides the right home-feed verb (mothing vs observing). Location is
// never mirrored — `src/lib/inaturalist.js` strips coordinates, place names,
// and timezone before anything is built.
//
// Incremental by default: a cheap freshness check skips the run entirely when
// nothing changed; otherwise it re-pulls only observations changed since the
// last sync, writes just those (plus the refreshed summary), and deletes
// records for observations removed upstream. Pass `--full` to force a
// complete resync.
//
// Usage:
//   BSKY_IDENTIFIER=dame.is BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
//     node scripts/mirror-inaturalist.mjs [--dry-run] [--full] [--pds url]
//
//   --dry-run   Plan the sync and print what would change, writing nothing.
//   --full      Ignore the freshness marker and resync every observation.
//   --pds URL   Override the PDS endpoint (default: resolved from your DID).
//
// Get an app password at https://bsky.app/settings/app-passwords. Never commit it.

import { AtpAgent } from '@atproto/api';

import { ME_HANDLE, INATURALIST_USER, OBSERVING_NSID } from '../src/config.js';
import { resolveIdentifier } from '../src/lib/atproto.js';
import { syncInaturalistMirror } from '../src/lib/inaturalistMirror.js';

const log = (...a) => console.log('[mirror-inat]', ...a);
const die = (msg) => {
  console.error('[mirror-inat] ERROR:', msg);
  process.exit(1);
};

function parseArgs(argv) {
  const args = { dryRun: false, full: false, pds: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--full') args.full = true;
    else if (a === '--pds') args.pds = argv[++i];
    else die(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

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
      log(`signed in as ${agent.session?.handle || identifier}`);
    } catch (err) {
      return die(`login failed: ${err.message}`);
    }
  } else {
    // --dry-run without credentials: the summary/record reads are public, so
    // an unauthenticated agent can still plan the sync.
    log('no app password — dry-run planning with public reads only.');
  }

  const report = await syncInaturalistMirror({
    agent,
    did,
    user: INATURALIST_USER,
    full: args.full,
    dryRun: args.dryRun,
    log,
  });

  if (report.noop) {
    log('up to date — nothing to do.');
  } else {
    log(`done — summaries at://${did}/${OBSERVING_NSID}/self (+ is.dame.mothing/self)`);
  }
  if (report.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[mirror-inat] fatal', err);
  process.exitCode = 1;
});
