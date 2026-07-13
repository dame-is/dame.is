#!/usr/bin/env node
/*
 * Imports a markdown-sourced guide into the portfolio publication as a
 * `site.standard.document` — the same record type `upload.mjs` produces for the
 * old Adobe pages, so it renders on `/creating` alongside them.
 *
 * Why a separate script? The Adobe pages flow through `works.json`'s flat
 * intermediate block format (heading / text / image / embed). A long-form
 * guide like atpota.to/guides/bluesky-for-brands is markdown with nested
 * lists, inline bold/italic, and link facets — which that format can't
 * represent. Rather than reinvent any of it, this reuses the site's own,
 * already-tested markdown→`pub.leaflet.content` converter
 * (`src/lib/legacyBlogMarkdown.js`, the one the legacy-blog admin migration
 * uses) and re-hosts every referenced image as a PDS blob so nothing stays
 * tied to atpota.to.
 *
 * The accidental draft: this guide was previously migrated by mistake as a
 * *blog* post — a `site.standard.document` with rkey
 * `how-to-use-bluesky-to-grow-your-brand` homed on the blog publication, with a
 * truncated title. By default this REPLACES that record in place
 * (putRecord, same rkey): it moves to the portfolio publication and its
 * title / description / tags / content are corrected, so there is exactly one
 * record and no leftover broken blog post. Use --new to instead create a fresh
 * record (server-assigned TID), or --blog to keep it on the blog publication.
 *
 * Usage:
 *   node scripts/portfolio/import-guide.mjs --dry-run            # build + report, write nothing
 *   node scripts/portfolio/import-guide.mjs --dry-run --print    # also print the record JSON
 *   DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
 *     node scripts/portfolio/import-guide.mjs                    # replace the draft, in place
 *
 * Options:
 *   --dry-run             Build everything and report, but write nothing (no auth needed).
 *   --print               With --dry-run, print the built record JSON (content elided).
 *   --new                 Create a new record (server TID) instead of replacing by rkey.
 *   --blog                Home the doc on the blog publication instead of the portfolio.
 *   --publication=at://…  Explicit publication URI (overrides --blog / the default).
 *   --rkey=…              Record key to write (default: how-to-use-bluesky-to-grow-your-brand).
 *   --markdown=URL        Override the source markdown URL.
 *   --no-cover            Don't attach a cover image.
 *   --handle=dame.is      Account handle (default dame.is).
 *   --pds=https://…       Use this PDS directly instead of resolving it.
 *
 * Auth: DAME_APP_PASSWORD (an app password, never your main one). Dry-run
 * needs no auth. Re-runnable — putRecord overwrites rather than duplicating.
 */

import { AtpAgent } from '@atproto/api';
import { markdownToContent } from '../../src/lib/legacyBlogMarkdown.js';
import { PORTFOLIO_PUBLICATION, BLOG_PUBLICATION } from '../../src/config.js';
import { STANDARD_DOC, resolveIdentity, buildStandardDocRecord } from './standardDoc.mjs';

// --- the guide -------------------------------------------------------------
// Top-matter is hand-set (the markdown body carries no front matter); the
// prose + images are pulled live from the atpota.to repo. Published date and
// rkey match the record that was migrated by accident, so the default run
// corrects it in place.
const GUIDE = {
  markdown:
    'https://raw.githubusercontent.com/atpota-to/atpota.to/main/website/guides/how-to-use-bluesky-to-grow-your-brand.md',
  // Base the guide's relative image paths (`screenshots/…`, `/guides/…`)
  // resolve against — its live page URL.
  base: 'https://atpota.to/guides/bluesky-for-brands',
  title: 'How to use Bluesky to grow your brand',
  description:
    'A comprehensive guide for companies, communities, and creators looking to establish and grow their presence on Bluesky.',
  category: 'writing',
  tags: ['bluesky', 'atproto', 'guide'],
  publishedAt: '2025-05-08T18:00:00.000Z',
  slug: 'how-to-use-bluesky-to-grow-your-brand',
  cover: 'https://atpota.to/bsky-guide-og.png',
};

// --- args ------------------------------------------------------------------

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const val = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const DRY_RUN = has('--dry-run');
const PRINT = has('--print');
const NEW = has('--new');
const NO_COVER = has('--no-cover');
const HANDLE = val('handle') || process.env.DAME_HANDLE || 'dame.is';
const PDS_OVERRIDE = val('pds') || process.env.DAME_PDS_SERVICE || null;
const MARKDOWN_URL = val('markdown') || GUIDE.markdown;
const RKEY = val('rkey') || GUIDE.slug;
const APP_PASSWORD = process.env.DAME_APP_PASSWORD || process.env.APP_PASSWORD || null;
const PUBLICATION =
  val('publication') || (has('--blog') ? BLOG_PUBLICATION : PORTFOLIO_PUBLICATION);

// --- helpers ---------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(label, fn, { tries = 5, baseMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.statusCode;
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (i < tries - 1) {
        const wait = baseMs * 2 ** i;
        process.stdout.write(`\n  [retry ${i + 1}/${tries - 1}] ${label}: ${err?.message || err} — waiting ${wait}ms\n`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

function contentTypeFor(url, headerType) {
  if (headerType && headerType.startsWith('image/')) return headerType.split(';')[0];
  const ext = (url.split('?')[0].match(/\.(\w+)$/) || [])[1]?.toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] || 'image/jpeg';
}

/** Pixel dimensions from a PNG or JPEG header; null if unknown. */
function imageSize(bytes) {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) { o++; continue; }
      const m = bytes[o + 1];
      const isSOF = (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf);
      if (isSOF) return { height: (bytes[o + 5] << 8) | bytes[o + 6], width: (bytes[o + 7] << 8) | bytes[o + 8] };
      o += 2 + ((bytes[o + 2] << 8) | bytes[o + 3]);
    }
  }
  return null;
}

async function fetchBytes(url) {
  return withRetry(`fetch ${url.split('/').pop()?.slice(0, 28)}`, async () => {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (portfolio-export)' } });
    if (!res.ok) { const e = new Error(`fetch ${res.status}`); e.status = res.status; throw e; }
    return new Uint8Array(await res.arrayBuffer());
  });
}

/** Download an image and (unless dry-run) upload it as a PDS blob. */
async function resolveImage(agent, url) {
  const bytes = await fetchBytes(url);
  const aspectRatio = imageSize(bytes);
  if (DRY_RUN) return { aspectRatio, bytes: bytes.length };
  const out = await withRetry('uploadBlob', () =>
    agent.com.atproto.repo.uploadBlob(bytes, { encoding: contentTypeFor(url, null) }),
  );
  return { blob: out.data.blob, aspectRatio, bytes: bytes.length };
}

// --- main ------------------------------------------------------------------

async function main() {
  if (!PUBLICATION) throw new Error('No publication set. Set PORTFOLIO_PUBLICATION in src/config.js or pass --publication=at://…');

  console.log(`[guide] source: ${MARKDOWN_URL}`);
  console.log(`[guide] → ${STANDARD_DOC} ${DRY_RUN ? '(dry-run)' : ''}`);
  console.log(`[guide] publication: ${PUBLICATION}`);
  console.log(`[guide] write: ${NEW ? 'createRecord (new TID)' : `putRecord rkey=${RKEY} (replace in place)`}`);

  const md = new TextDecoder().decode(await fetchBytes(MARKDOWN_URL));
  const content = markdownToContent(md);
  const blocks = content.pages[0].blocks;
  const imageBlocks = blocks.filter((w) => w.block?.$type === 'pub.leaflet.blocks.image' && w.block._src);
  console.log(`[guide] ${blocks.length} blocks, ${imageBlocks.length} images`);

  const { did, pds } = await resolveIdentity(HANDLE, PDS_OVERRIDE);
  console.log(`[guide] ${HANDLE} → ${did}\n[guide] PDS: ${pds}`);

  const agent = new AtpAgent({ service: pds });
  if (!DRY_RUN) {
    if (!APP_PASSWORD) throw new Error('Set DAME_APP_PASSWORD (an app password) to publish.');
    await agent.login({ identifier: HANDLE, password: APP_PASSWORD });
  }

  // Re-host each distinct image once, then swap `_src` placeholders for blobs.
  const byUrl = new Map();
  let totalBytes = 0;
  process.stdout.write('[guide] images ');
  for (const wrap of imageBlocks) {
    const abs = new URL(wrap.block._src, GUIDE.base).href;
    if (!byUrl.has(abs)) byUrl.set(abs, await resolveImage(agent, abs));
    process.stdout.write('.');
  }
  console.log('');
  for (const wrap of imageBlocks) {
    const abs = new URL(wrap.block._src, GUIDE.base).href;
    const up = byUrl.get(abs);
    totalBytes += up.bytes || 0;
    delete wrap.block._src;
    if (up.blob) wrap.block.image = up.blob;
    else wrap.block.url = abs; // dry-run / keep-url fallback so the block is still valid
    if (up.aspectRatio) wrap.block.aspectRatio = up.aspectRatio;
  }

  // Optional cover image for the /creating card.
  let coverImage;
  if (!NO_COVER && GUIDE.cover) {
    try {
      const c = await resolveImage(agent, GUIDE.cover);
      totalBytes += c.bytes || 0;
      coverImage = c.blob; // undefined in dry-run
    } catch (err) {
      console.log(`[guide] cover skipped: ${err?.message || err}`);
    }
  }

  const record = buildStandardDocRecord({
    publication: PUBLICATION,
    title: GUIDE.title,
    slug: GUIDE.slug,
    summary: GUIDE.description,
    category: GUIDE.category,
    tags: GUIDE.tags,
    createdAt: GUIDE.publishedAt,
    content,
    coverImage,
  });

  if (DRY_RUN) {
    console.log(`\n[guide] would ${NEW ? 'create' : `putRecord (rkey=${RKEY})`}: "${record.title}"`);
    console.log(`  path=${record.path} tags=${JSON.stringify(record.tags)} images=${byUrl.size} (${(totalBytes / 1e6).toFixed(1)} MB)`);
    if (PRINT) console.log(JSON.stringify({ ...record, content: `‹${blocks.length} blocks elided›` }, null, 2));
    console.log('\n[guide] dry-run: nothing written.');
    return;
  }

  const res = NEW
    ? await withRetry('createRecord', () => agent.com.atproto.repo.createRecord({ repo: did, collection: STANDARD_DOC, record }))
    : await withRetry('putRecord', () => agent.com.atproto.repo.putRecord({ repo: did, collection: STANDARD_DOC, rkey: RKEY, record }));
  const uri = res.data?.uri || `at://${did}/${STANDARD_DOC}/${RKEY}`;
  console.log(`\n[guide] ✓ ${uri}`);
  console.log(`[guide]   ${byUrl.size} images, ${(totalBytes / 1e6).toFixed(1)} MB → ${record.path} (renders at /creating${record.path})`);
}

main().catch((err) => {
  console.error('\n[guide] failed:', err?.message || err);
  process.exitCode = 1;
});
