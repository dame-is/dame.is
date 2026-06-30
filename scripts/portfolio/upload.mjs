#!/usr/bin/env node
/*
 * Bulk-publishes the works in `works.json` to your PDS as
 * `site.standard.document` records in your portfolio publication — the
 * default record type the /creating page and the in-app editor now use.
 *
 * For each work it builds a `pub.leaflet.content` body (the shared block
 * format used across the site), and for every image it downloads the file
 * from the old Adobe CDN and re-uploads it to your PDS as a blob, so the
 * finished records are fully self-hosted and survive the old site going away.
 *
 * Prerequisite: create the portfolio publication first
 * (`node scripts/portfolio/create-publication.mjs`) and set
 * PORTFOLIO_PUBLICATION in src/config.js (or pass --publication=at://…).
 *
 * Usage:
 *   DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
 *     node scripts/portfolio/upload.mjs [options]
 *
 * Options:
 *   --dry-run            Build everything and report, but write nothing.
 *   --print              With --dry-run, print the built record JSON.
 *   --only=slug[,slug]   Publish only these works.
 *   --keep-cdn-urls      Reference the Adobe CDN URLs instead of uploading
 *                        blobs (fast, but breaks when the old site is gone).
 *   --force              Publish even if a record with the same slug exists.
 *   --legacy             Publish as is.dame.creating.work instead (the old
 *                        bespoke type — not recommended).
 *   --publication=at://… Portfolio publication URI (else config / env).
 *   --handle=dame.is     Override the account handle (default: dame.is).
 *   --pds=https://…      Skip PDS resolution and use this service directly.
 *
 * Auth: set DAME_APP_PASSWORD to an app password
 * (Settings → Privacy & security → App passwords on bsky.social, or your
 * PDS equivalent). Never your main password. The handle defaults to dame.is.
 *
 * Re-runnable: by default it skips works whose slug is already published,
 * so you can stop and resume. Use --force to override.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtpAgent } from '@atproto/api';
import {
  STANDARD_DOC,
  resolvePublication,
  resolveIdentity,
  existingPaths,
  buildStandardDocRecord,
} from './standardDoc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKS_PATH = resolve(__dirname, 'works.json');

const LEGACY_COLLECTION = 'is.dame.creating.work';
const CONTENT_TYPE = 'pub.leaflet.content';
const PAGE_TYPE = 'pub.leaflet.pages.linearDocument';
const WRAPPER_TYPE = 'pub.leaflet.pages.linearDocument#block';

// --- args -------------------------------------------------------------------

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const val = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const DRY_RUN = has('--dry-run');
const PRINT = has('--print');
const KEEP_CDN = has('--keep-cdn-urls');
const FORCE = has('--force');
const LEGACY = has('--legacy');
const ONLY = (val('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const HANDLE = val('handle') || process.env.DAME_HANDLE || 'dame.is';
const PDS_OVERRIDE = val('pds') || process.env.DAME_PDS_SERVICE || null;
const APP_PASSWORD = process.env.DAME_APP_PASSWORD || process.env.APP_PASSWORD || null;

const COLLECTION = LEGACY ? LEGACY_COLLECTION : STANDARD_DOC;
// Standard docs need a portfolio publication; legacy records don't. In a
// dry-run we tolerate a missing publication (placeholder) so the record
// shape can be previewed before the publication is created.
const PUBLICATION = LEGACY
  ? null
  : (() => {
      try {
        return resolvePublication(val('publication'));
      } catch (err) {
        if (DRY_RUN) return 'at://…set-PORTFOLIO_PUBLICATION…/site.standard.publication/_';
        throw err;
      }
    })();

// --- helpers ----------------------------------------------------------------

const enc = new TextEncoder();

function linkFacets(plaintext, links) {
  const facets = [];
  for (const l of links || []) {
    const idx = plaintext.indexOf(l.text);
    if (idx < 0) continue;
    facets.push({
      index: {
        byteStart: enc.encode(plaintext.slice(0, idx)).length,
        byteEnd: enc.encode(plaintext.slice(0, idx + l.text.length)).length,
      },
      features: [{ $type: 'pub.leaflet.richtext.facet#link', uri: l.uri }],
    });
  }
  return facets;
}

function contentTypeFor(url, headerType) {
  if (headerType && headerType.startsWith('image/')) return headerType.split(';')[0];
  const ext = (url.split('?')[0].match(/\.(\w+)$/) || [])[1]?.toLowerCase();
  return (
    { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] ||
    'image/jpeg'
  );
}

async function uploadImage(agent, url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (portfolio-export)' } });
  if (!res.ok) throw new Error(`fetch image ${res.status}: ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const encoding = contentTypeFor(url, res.headers.get('content-type'));
  const out = await agent.com.atproto.repo.uploadBlob(bytes, { encoding });
  return { blob: out.data.blob, bytes: bytes.length };
}

async function buildContent(agent, work, stats) {
  const blocks = [];
  for (const b of work.blocks) {
    let block = null;
    if (b.type === 'heading') {
      block = { $type: 'pub.leaflet.blocks.header', plaintext: b.text, level: b.level || 2 };
    } else if (b.type === 'text') {
      block = { $type: 'pub.leaflet.blocks.text', plaintext: b.text, facets: linkFacets(b.text, b.links) };
    } else if (b.type === 'image') {
      const img = { $type: 'pub.leaflet.blocks.image', alt: b.alt || '' };
      if (b.aspectRatio) img.aspectRatio = b.aspectRatio;
      if (KEEP_CDN) {
        img.url = b.url;
      } else if (!DRY_RUN) {
        const { blob, bytes } = await uploadImage(agent, b.url);
        img.image = blob;
        stats.bytes += bytes;
        stats.images += 1;
        process.stdout.write('.');
      } else {
        img.url = b.url; // dry-run placeholder
        stats.images += 1;
      }
      block = img;
    } else if (b.type === 'embed') {
      block = { $type: 'pub.leaflet.blocks.website', src: b.url, title: b.title || 'Watch' };
    }
    if (block) blocks.push({ $type: WRAPPER_TYPE, block });
  }
  return { $type: CONTENT_TYPE, pages: [{ $type: PAGE_TYPE, blocks }] };
}

function buildRecord(work, content) {
  if (LEGACY) {
    const record = {
      $type: LEGACY_COLLECTION,
      title: work.title,
      slug: work.slug,
      content,
      createdAt: work.createdAt || new Date().toISOString(),
    };
    if (work.category) record.category = work.category;
    if (work.tags?.length) record.tags = work.tags;
    if (work.summary) record.summary = work.summary;
    return record;
  }
  return buildStandardDocRecord({
    publication: PUBLICATION,
    title: work.title,
    slug: work.slug,
    summary: work.summary,
    category: work.category,
    tags: work.tags,
    createdAt: work.createdAt,
    content,
  });
}

async function existingSlugs(agent, did) {
  if (!LEGACY) return existingPaths(agent, did, PUBLICATION);
  const slugs = new Set();
  let cursor;
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: LEGACY_COLLECTION,
      limit: 100,
      cursor,
    });
    for (const r of res.data.records) if (r.value?.slug) slugs.add(r.value.slug);
    cursor = res.data.cursor;
  } while (cursor);
  return slugs;
}

// --- main -------------------------------------------------------------------

async function main() {
  let works = JSON.parse(await readFile(WORKS_PATH, 'utf-8'));
  if (ONLY.length) works = works.filter((w) => ONLY.includes(w.slug));
  if (!works.length) {
    console.error('No works selected.');
    process.exitCode = 1;
    return;
  }

  console.log(`[upload] ${works.length} work(s) → ${COLLECTION} ${DRY_RUN ? '(dry-run)' : ''}`);
  console.log(`[upload] images: ${KEEP_CDN ? 'keep CDN URLs' : 'download → re-upload as PDS blobs'}`);
  if (PUBLICATION) console.log(`[upload] publication: ${PUBLICATION}`);

  const { did, pds } = await resolveIdentity(HANDLE, PDS_OVERRIDE);
  console.log(`[upload] ${HANDLE} → ${did}\n[upload] PDS: ${pds}`);

  const agent = new AtpAgent({ service: pds });
  let published = new Set();
  if (!DRY_RUN) {
    if (!APP_PASSWORD) throw new Error('Set DAME_APP_PASSWORD (an app password) to publish.');
    await agent.login({ identifier: HANDLE, password: APP_PASSWORD });
    published = await existingSlugs(agent, did);
  }

  for (const work of works) {
    if (!FORCE && published.has(work.slug)) {
      console.log(`\n[skip] ${work.slug} — already published (use --force to re-add)`);
      continue;
    }
    const stats = { images: 0, bytes: 0 };
    process.stdout.write(`\n[work] ${work.slug} `);
    const content = await buildContent(agent, work, stats);
    const record = buildRecord(work, content);

    if (DRY_RUN) {
      console.log(`\n  would create ${COLLECTION} (${content.pages[0].blocks.length} blocks, ${stats.images} images)`);
      if (PRINT) console.log(JSON.stringify(record, null, 2));
      continue;
    }

    const res = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: COLLECTION,
      record,
    });
    console.log(`\n  ✓ ${res.data.uri} (${stats.images} images, ${(stats.bytes / 1e6).toFixed(1)} MB)`);
  }

  console.log('\n[upload] done.');
}

main().catch((err) => {
  console.error('\n[upload] failed:', err?.message || err);
  process.exitCode = 1;
});
