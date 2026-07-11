#!/usr/bin/env node
/*
 * Creates (or refreshes) the `is.dame.guestbook/self` singleton on your PDS —
 * the "book" that visitors sign. Entries never live here; they live on each
 * signer's own repo and point their `subject` at this record's at-uri, so the
 * record mostly exists to be a stable backlink target (plus a title and a
 * description for would-be signers). See lexicons/GUESTBOOK.md.
 *
 * Run once. Re-running updates the title/description in place (putRecord on
 * the fixed rkey `self`), which is safe: the at-uri — what every signature
 * points at — never changes.
 *
 *   DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
 *     node scripts/create-guestbook.mjs \
 *       --title "the dame.is guestbook" \
 *       --description "Leave a note or a mark that you were here."
 *
 * Options:
 *   --title=…        Book title (default "the dame.is guestbook").
 *   --description=…  What signing means, shown to signers.
 *   --url=…          Where the book renders (default https://dame.is/guestbook).
 *   --handle=…       Account handle (default dame.is).
 *   --pds=…          Use this PDS directly instead of resolving it.
 *   --dry-run        Print the record that would be written, write nothing.
 */

import { AtpAgent } from '@atproto/api';

const COLLECTION = 'is.dame.guestbook';
const RKEY = 'self';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DRY_RUN = has('--dry-run');
const TITLE = val('title', 'the dame.is guestbook');
const DESCRIPTION = val(
  'description',
  'Leave a note or just a mark that you were here. Your signature is a record on your own PDS; this book is assembled from the backlinks.',
);
const URL_ = val('url', 'https://dame.is/guestbook');
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
  const now = new Date().toISOString();
  const record = {
    $type: COLLECTION,
    title: TITLE,
    description: DESCRIPTION,
    url: URL_,
    createdAt: now,
  };

  console.log('[guestbook] record:\n' + JSON.stringify(record, null, 2));
  if (DRY_RUN) {
    console.log('\n[guestbook] dry-run — nothing written.');
    return;
  }
  if (!APP_PASSWORD) throw new Error('Set DAME_APP_PASSWORD (an app password) to create the guestbook.');

  const { did, pds } = await resolveIdentity();
  console.log(`\n[guestbook] ${HANDLE} → ${did}\n[guestbook] PDS: ${pds}`);
  const agent = new AtpAgent({ service: pds });
  await agent.login({ identifier: HANDLE, password: APP_PASSWORD });

  // Keep the original createdAt when refreshing an existing book so the
  // record's age reflects when the book was opened, not last retitled.
  try {
    const existing = await agent.com.atproto.repo.getRecord({ repo: did, collection: COLLECTION, rkey: RKEY });
    if (existing?.data?.value?.createdAt) {
      record.createdAt = existing.data.value.createdAt;
      record.updatedAt = now;
      console.log('[guestbook] book already exists — refreshing it in place.');
    }
  } catch {
    // No existing record: this is the first opening of the book.
  }

  const res = await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: COLLECTION,
    rkey: RKEY,
    record,
  });
  console.log(`\n[guestbook] ✓ ${res.data.uri}`);
  console.log('\nThe site already points at this at-uri (src/config.js → GUESTBOOK_SUBJECT).');
  console.log('Visitors can now sign at /guestbook.');
}

main().catch((err) => {
  console.error('\n[guestbook] failed:', err?.message || err);
  process.exitCode = 1;
});
