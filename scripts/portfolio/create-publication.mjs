#!/usr/bin/env node
/*
 * Creates a `site.standard.publication` record on your PDS — the "masthead"
 * that groups your creative works. Every `site.standard.document` whose
 * `site` field points at this publication renders on /creating; everything
 * else renders on /blogging.
 *
 * Run once, then paste the printed `at://` URI into `PORTFOLIO_PUBLICATION`
 * in src/config.js.
 *
 *   DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
 *     node scripts/portfolio/create-publication.mjs \
 *       --name "Creative Works" \
 *       --url https://dame.work/creating \
 *       --description "Art, photography, and other things I make."
 *
 * Options:
 *   --name=…         Publication name (default "Creative Works").
 *   --url=…          Base URL for the publication (default https://dame.work/creating).
 *   --description=…  Optional description.
 *   --handle=…       Account handle (default dame.is).
 *   --pds=…          Use this PDS directly instead of resolving it.
 *   --dry-run        Print the record that would be created, write nothing.
 */

import { AtpAgent } from '@atproto/api';

const COLLECTION = 'site.standard.publication';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DRY_RUN = has('--dry-run');
const NAME = val('name', 'Creative Works');
const URL_ = val('url', 'https://dame.work/creating');
const DESCRIPTION = val('description', '');
const HANDLE = val('handle', process.env.DAME_HANDLE || 'dame.is');
const PDS_OVERRIDE = val('pds', process.env.DAME_PDS_SERVICE || null);
const APP_PASSWORD = process.env.DAME_APP_PASSWORD || process.env.APP_PASSWORD || null;

async function resolveIdentity() {
  const r = await fetch(
    `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(HANDLE)}`,
  );
  if (!r.ok) throw new Error(`resolveHandle(${HANDLE}) → HTTP ${r.status}`);
  const { did } = await r.json();
  if (PDS_OVERRIDE) return { did, pds: PDS_OVERRIDE };
  const docUrl = did.startsWith('did:web:')
    ? `https://${did.slice('did:web:'.length)}/.well-known/did.json`
    : `https://plc.directory/${did}`;
  const doc = await (await fetch(docUrl)).json();
  const svc = (doc.service || []).find(
    (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer',
  );
  if (!svc) throw new Error(`No PDS endpoint in DID doc for ${did}`);
  return { did, pds: svc.serviceEndpoint };
}

async function main() {
  const record = {
    $type: COLLECTION,
    name: NAME,
    url: URL_,
    ...(DESCRIPTION ? { description: DESCRIPTION } : {}),
  };

  console.log('[publication] record:\n' + JSON.stringify(record, null, 2));
  if (DRY_RUN) {
    console.log('\n[publication] dry-run — nothing written.');
    return;
  }
  if (!APP_PASSWORD) throw new Error('Set DAME_APP_PASSWORD (an app password) to create the publication.');

  const { did, pds } = await resolveIdentity();
  console.log(`\n[publication] ${HANDLE} → ${did}\n[publication] PDS: ${pds}`);
  const agent = new AtpAgent({ service: pds });
  await agent.login({ identifier: HANDLE, password: APP_PASSWORD });

  const res = await agent.com.atproto.repo.createRecord({ repo: did, collection: COLLECTION, record });
  console.log(`\n[publication] ✓ created ${res.data.uri}`);
  console.log('\nPaste this into src/config.js → PORTFOLIO_PUBLICATION:');
  console.log(`  export const PORTFOLIO_PUBLICATION = '${res.data.uri}';`);
}

main().catch((err) => {
  console.error('\n[publication] failed:', err?.message || err);
  process.exitCode = 1;
});
