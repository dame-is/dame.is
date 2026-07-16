#!/usr/bin/env node
// Repair: force every blog-homed site.standard.document's `path` to match its
// record key, so the Standard Site canonical URL (publication.url + path) equals
// the URL dame.is actually serves and links (/blogging/{rkey}). When they drift
// apart, Bluesky can't verify a shared /blogging/{rkey} link as a Standard Site
// document and the rich publication embed silently fails to render.
//
// Why only blog docs: dame.is routes /blogging by rkey alone (resolveById in
// src/pages/BlogPost.jsx, resolveBlog in og/records.js), so a custom `path` on a
// blog post is never a real URL — it only desyncs the embed. Portfolio works are
// left untouched: /creating *does* route by `path` (workSlug), so their custom
// slugs are correct. This is the one-time cleanup companion to the editor guard
// in src/lib/lexicons.js `derive`, which keeps new/edited blog docs aligned.
//
// Usage:
//   node scripts/fix-blog-doc-paths.mjs --dry-run          # preview (no auth needed)
//   DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
//     node scripts/fix-blog-doc-paths.mjs                  # apply
//
// Get an app password at https://bsky.app/settings/app-passwords.

import { AtpAgent } from '@atproto/api';
import { ME_HANDLE, BLOG_PUBLICATION } from '../src/config.js';

const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-n');
const HANDLE = process.env.DAME_HANDLE || process.env.BSKY_IDENTIFIER || ME_HANDLE;
const PDS_OVERRIDE = process.env.DAME_PDS_SERVICE || null;
const APP_PASSWORD =
  process.env.DAME_APP_PASSWORD || process.env.BSKY_APP_PASSWORD || process.env.APP_PASSWORD || null;

const COLLECTION = 'site.standard.document';

const log = (...a) => console.log('[blog-paths]', ...a);
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

// listRecords is public (no auth), so --dry-run can preview the real change.
async function listAll(pds, did) {
  const out = [];
  let cursor;
  do {
    const params = new URLSearchParams({ repo: did, collection: COLLECTION, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const r = await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`);
    if (!r.ok) throw new Error(`listRecords → HTTP ${r.status}`);
    const data = await r.json();
    out.push(...(data.records || []));
    cursor = data.cursor;
  } while (cursor);
  return out;
}

async function main() {
  const { did, pds } = await resolveIdentity();
  log(`${HANDLE} → ${did}`);
  log(`PDS: ${pds}`);

  const records = await listAll(pds, did);
  log(`${records.length} ${COLLECTION} record(s) total`);

  const plan = [];
  for (const rec of records) {
    const value = rec?.value || {};
    // Blog-homed docs only. Portfolio works (a different `site`) route by path
    // on /creating and keep their custom slug — never touch them.
    if (value.site !== BLOG_PUBLICATION) continue;
    const rkey = rkeyOf(rec.uri);
    const want = `/${rkey}`;
    const from = value.path || '(none)';
    if (value.path === want) continue;
    log(`• ${rkey}: path ${from}  →  ${want}   "${String(value.title || '').slice(0, 48)}"`);
    plan.push({ rkey, value: { ...value, path: want } });
  }

  if (!plan.length) {
    log('nothing to change — every blog doc already has path == /{rkey}.');
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
    log(`✓ updated ${rkey} → ${value.path}`);
  }
  log('done. Re-paste the affected links in the Bluesky composer to pick up the embed.');
}

main().catch((err) => {
  console.error('[blog-paths] fatal:', err?.message || err);
  process.exitCode = 1;
});
