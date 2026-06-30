#!/usr/bin/env node
/*
 * One-time migration: convert existing `is.dame.creating.work` records on
 * your PDS into `site.standard.document` records in the portfolio
 * publication. The block body (and its already-uploaded image blobs) is
 * reused as-is, so no images are re-uploaded.
 *
 *   DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
 *     node scripts/portfolio/migrate-creating.mjs [options]
 *
 * Options:
 *   --dry-run            Report what would change, write nothing.
 *   --print              With --dry-run, print each built record.
 *   --only=slug[,slug]   Migrate a subset (by legacy slug).
 *   --delete             Delete each legacy record after its standard doc is
 *                        created (default: keep both; /creating reads either).
 *   --publication=at://… Portfolio publication URI (else config / env).
 *   --handle=dame.is     Account handle.
 *   --pds=https://…      Use this PDS directly instead of resolving it.
 *
 * Re-runnable: skips works whose `path` is already published.
 */

import { AtpAgent } from '@atproto/api';
import {
  STANDARD_DOC,
  resolvePublication,
  resolveIdentity,
  existingPaths,
  buildStandardDocRecord,
} from './standardDoc.mjs';

const LEGACY = 'is.dame.creating.work';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const DRY_RUN = has('--dry-run');
const PRINT = has('--print');
const DELETE_LEGACY = has('--delete');
const ONLY = (val('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const HANDLE = val('handle') || process.env.DAME_HANDLE || 'dame.is';
const PDS_OVERRIDE = val('pds') || process.env.DAME_PDS_SERVICE || null;
const APP_PASSWORD = process.env.DAME_APP_PASSWORD || process.env.APP_PASSWORD || null;
const PUBLICATION = resolvePublication(val('publication'));

async function main() {
  console.log(`[migrate] ${LEGACY} → ${STANDARD_DOC} ${DRY_RUN ? '(dry-run)' : ''}`);
  console.log(`[migrate] publication: ${PUBLICATION}`);
  if (!DRY_RUN && !APP_PASSWORD) throw new Error('Set DAME_APP_PASSWORD (an app password) to migrate.');

  const { did, pds } = await resolveIdentity(HANDLE, PDS_OVERRIDE);
  console.log(`[migrate] ${HANDLE} → ${did}\n[migrate] PDS: ${pds}`);

  const agent = new AtpAgent({ service: pds });
  if (!DRY_RUN) await agent.login({ identifier: HANDLE, password: APP_PASSWORD });

  // List legacy records (use the PDS directly for dry-runs too).
  const target = DRY_RUN ? new AtpAgent({ service: pds }) : agent;
  let legacy = [];
  let cursor;
  do {
    const res = await target.com.atproto.repo.listRecords({ repo: did, collection: LEGACY, limit: 100, cursor });
    legacy.push(...res.data.records);
    cursor = res.data.cursor;
  } while (cursor);

  if (ONLY.length) legacy = legacy.filter((r) => ONLY.includes(r.value?.slug));
  console.log(`[migrate] ${legacy.length} legacy record(s) to consider`);

  const published = DRY_RUN ? new Set() : await existingPaths(agent, did, PUBLICATION);

  let created = 0;
  let skipped = 0;
  for (const r of legacy) {
    const v = r.value || {};
    const slug = v.slug || '';
    if (published.has(String(slug).replace(/^\/+/, ''))) {
      console.log(`[skip] ${slug} — already migrated`);
      skipped += 1;
      continue;
    }
    const tags = Array.isArray(v.tags) ? v.tags : [];
    const record = buildStandardDocRecord({
      publication: PUBLICATION,
      title: v.title,
      slug,
      summary: v.summary,
      category: v.category || v.kind,
      tags,
      createdAt: v.createdAt,
      content: v.content,
      coverImage: v.coverImage,
    });

    if (DRY_RUN) {
      console.log(`[dry] would create ${STANDARD_DOC} for "${v.title}" (path /${slug})`);
      if (PRINT) console.log(JSON.stringify(record, null, 2));
      continue;
    }

    const res = await agent.com.atproto.repo.createRecord({ repo: did, collection: STANDARD_DOC, record });
    created += 1;
    console.log(`  ✓ ${res.data.uri}`);

    if (DELETE_LEGACY) {
      const rkey = String(r.uri).split('/').pop();
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection: LEGACY, rkey });
      console.log(`  ✗ deleted legacy ${LEGACY}/${rkey}`);
    }
  }

  console.log(`\n[migrate] done — created ${created}, skipped ${skipped}${DELETE_LEGACY ? ', legacy deleted' : ''}.`);
}

main().catch((err) => {
  console.error('\n[migrate] failed:', err?.message || err);
  process.exitCode = 1;
});
