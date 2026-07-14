#!/usr/bin/env node
// One-off migration: point dame's site.standard.publication records at dame.is
// so Bluesky (and other AT clients) verify the Standard Site link embed against
// dame.is instead of dame.leaflet.pub / dame.work (dead).
//
// Only each publication's `url` changes. The documents' `site` + `path` are left
// alone — a doc's canonical URL is `publication.url + document.path`, and the
// existing paths (e.g. /3m36ccn5kis2x, /red-blue-yellow) already resolve to
// https://dame.is/blogging/… and https://dame.is/creating/…, which is exactly how
// dame.is routes them. Pair this with the /.well-known/site.standard.publication
// endpoints (api/well-known.js) and the <link> tags (middleware.js).
//
// Usage:
//   node scripts/set-publication-urls.mjs --dry-run          # preview (no auth needed)
//   DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
//     node scripts/set-publication-urls.mjs                  # apply
//
// Get an app password at https://bsky.app/settings/app-passwords.

import { AtpAgent } from '@atproto/api';
import { ME_HANDLE, BLOG_PUBLICATION, PORTFOLIO_PUBLICATION } from '../src/config.js';

const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-n');
const HANDLE = process.env.DAME_HANDLE || process.env.BSKY_IDENTIFIER || ME_HANDLE;
const PDS_OVERRIDE = process.env.DAME_PDS_SERVICE || null;
const APP_PASSWORD =
  process.env.DAME_APP_PASSWORD || process.env.BSKY_APP_PASSWORD || process.env.APP_PASSWORD || null;

const COLLECTION = 'site.standard.publication';

// publication AT-URI → the dame.is base url it should advertise.
const TARGETS = [
  { uri: BLOG_PUBLICATION, url: 'https://dame.is/blogging' },
  { uri: PORTFOLIO_PUBLICATION, url: 'https://dame.is/creating' },
];

const log = (...a) => console.log('[pub-urls]', ...a);
const rkeyOf = (uri) => String(uri).split('/').pop();

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

// getRecord is public (no auth), so --dry-run can preview the real change.
async function fetchValue(pds, did, rkey) {
  const params = new URLSearchParams({ repo: did, collection: COLLECTION, rkey });
  const r = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${params}`);
  if (!r.ok) throw new Error(`getRecord(${rkey}) → HTTP ${r.status}`);
  return r.json(); // { uri, cid, value }
}

async function main() {
  const { did, pds } = await resolveIdentity();
  log(`${HANDLE} → ${did}`);
  log(`PDS: ${pds}`);

  const plan = [];
  for (const target of TARGETS) {
    const rkey = rkeyOf(target.uri);
    const { value } = await fetchValue(pds, did, rkey);
    const from = value?.url || '(none)';
    if (from === target.url) {
      log(`✓ ${rkey} already ${target.url} — skipping`);
      continue;
    }
    log(`• ${rkey}: url ${from}  →  ${target.url}`);
    plan.push({ rkey, value: { ...value, url: target.url } });
  }

  if (!plan.length) {
    log('nothing to change.');
    return;
  }
  if (DRY_RUN) {
    log(`\ndry-run — ${plan.length} record(s) would be updated. Re-run without --dry-run to apply.`);
    return;
  }
  if (!APP_PASSWORD) {
    throw new Error('Set DAME_APP_PASSWORD (an app password) to apply. Use --dry-run to preview.');
  }

  const agent = new AtpAgent({ service: pds });
  await agent.login({ identifier: HANDLE, password: APP_PASSWORD });
  for (const { rkey, value } of plan) {
    await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: COLLECTION,
      rkey,
      record: value,
    });
    log(`✓ updated ${rkey} → ${value.url}`);
  }
  log('done.');
}

main().catch((err) => {
  console.error('[pub-urls] fatal:', err?.message || err);
  process.exitCode = 1;
});
