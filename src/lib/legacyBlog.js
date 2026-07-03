// Legacy blog migration.
//
// Before dame.is became this Vite + React SPA it was an Eleventy static site,
// and its blog posts lived as hand-written markdown files with YAML-ish front
// matter under `/blog`. Those files now sit in `writing/blogs/*.md` (recovered
// from the pre-rewrite commit). This module reads them at build time, converts
// each into a `site.standard.document` record — the same shape the admin blocks
// editor produces — and offers a one-call `migratePost` that uploads the
// referenced images as PDS blobs and writes the record to the user's repo.
//
// The pure markdown→content conversion lives in legacyBlogMarkdown.js; here we
// add the bundled-file plumbing, image blob uploads, and the PDS write. The
// admin "Legacy blog migration" panel (src/pages/Admin.jsx) drives it.

import { ME_DID, BLOG_PUBLICATION } from '../config.js';
import { uploadImageFile } from '../components/blocks/ImageBlockEditor.jsx';
import {
  parseFrontMatter,
  parsePublishedAt,
  markdownToContent,
} from './legacyBlogMarkdown.js';

const STANDARD_DOC = 'site.standard.document';
const POST_COLLECTION = 'app.bsky.feed.post';

/* ------------------------------------------------------------------ */
/* Bundled source files                                                 */
/* ------------------------------------------------------------------ */

// The raw markdown for every legacy post, keyed by absolute path.
const POST_SOURCES = import.meta.glob('/writing/blogs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Served URLs for every image the posts reference. The old markdown points at
// `/images/blog/...` paths that the SPA no longer serves directly, so we route
// them through Vite's asset pipeline to get real, fetchable URLs at runtime
// (both in dev and in the built site). This also emits the images into the
// build so a migration run always has bytes to upload.
const IMAGE_URLS = import.meta.glob(
  '/images/blog/**/*.{jpg,jpeg,png,gif,webp,JPG,JPEG,PNG,GIF,WEBP}',
  { query: '?url', import: 'default', eager: true },
);

/**
 * Every legacy post, parsed and sorted newest-first. Each entry:
 *   { slug, filePath, meta, title, description, content, images, coverSrc,
 *     publishedAt, commentsUri }
 * where `content` is a ready-to-store `pub.leaflet.content` value whose image
 * blocks still carry a temporary `_src` (resolved to a blob at migrate time).
 */
export const LEGACY_POSTS = Object.entries(POST_SOURCES)
  .map(([filePath, raw]) => buildPost(filePath, raw))
  .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

function buildPost(filePath, raw) {
  const slug = filePath.replace(/^.*\//, '').replace(/\.md$/, '');
  const { meta, body } = parseFrontMatter(raw);
  const content = markdownToContent(body);
  const images = collectImageSrcs(content);
  const publishedAt = parsePublishedAt(meta) || new Date().toISOString();
  const commentsUri = meta.blueskyUri
    ? `at://${ME_DID}/${POST_COLLECTION}/${meta.blueskyUri}`
    : null;
  return {
    slug,
    filePath,
    meta,
    content,
    images,
    coverSrc: meta.ogImage || null,
    publishedAt,
    commentsUri,
    title: meta.title || slug,
    description: meta.excerpt || '',
  };
}

/* ------------------------------------------------------------------ */
/* Image resolution                                                     */
/* ------------------------------------------------------------------ */

function collectImageSrcs(content) {
  const srcs = new Set();
  for (const wrap of content.pages[0].blocks) {
    const b = wrap.block;
    if (b?.$type === 'pub.leaflet.blocks.image' && b._src) srcs.add(b._src);
  }
  return [...srcs];
}

/** Map a legacy `/images/blog/...` path to a runtime-served URL, if bundled. */
export function resolveImageUrl(src) {
  if (!src) return null;
  if (IMAGE_URLS[src]) return IMAGE_URLS[src];
  // Tolerate case / leading-slash drift between the markdown and the filesystem.
  const norm = src.replace(/^\/+/, '').toLowerCase();
  for (const [key, url] of Object.entries(IMAGE_URLS)) {
    if (key.replace(/^\/+/, '').toLowerCase() === norm) return url;
  }
  return null;
}

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

async function fetchAsFile(src) {
  const url = resolveImageUrl(src);
  if (!url) throw new Error(`Image not bundled: ${src}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${src}`);
  const blob = await res.blob();
  const ext = (src.split('.').pop() || '').toLowerCase();
  const type =
    blob.type && blob.type.startsWith('image/') ? blob.type : MIME_BY_EXT[ext] || 'image/jpeg';
  const name = src.split('/').pop() || 'image';
  return new File([blob], name, { type });
}

/* ------------------------------------------------------------------ */
/* Migration                                                            */
/* ------------------------------------------------------------------ */

/**
 * Which legacy posts already have a `site.standard.document`? Matches on the
 * record key (we migrate with rkey = slug) or on `path` (`/<slug>`), so a post
 * migrated under either scheme is detected. Returns the Set of migrated slugs
 * given the caller's already-fetched record list.
 */
export function migratedSlugs(records, slugs) {
  const present = new Set();
  const bySlug = new Set(slugs);
  for (const rec of records || []) {
    const rkey = String(rec.uri || '').split('/').pop();
    if (bySlug.has(rkey)) present.add(rkey);
    const path = String(rec.value?.path || '').replace(/^\/+/, '');
    if (bySlug.has(path)) present.add(path);
  }
  return present;
}

/**
 * Migrate one legacy post to the signed-in user's PDS as a
 * `site.standard.document`. Uploads every referenced image (and the cover) as
 * blobs, then writes the record with `rkey = slug` so the classic
 * `/blog/<slug>` → `/blogging/<slug>` URLs resolve and re-runs are idempotent
 * (a second migration overwrites rather than duplicating).
 *
 * `onProgress(message)` is optional and reports upload steps.
 */
export async function migratePost({ agent, did, post, onProgress = () => {} }) {
  if (!agent) throw new Error('Not signed in.');

  // 1. Upload every distinct image once and build a src → blockFields map.
  const uploads = new Map();
  const total = post.images.length + (post.coverSrc ? 1 : 0);
  let done = 0;
  const step = (label) => onProgress(`${label} (${++done}/${total})`);

  for (const src of post.images) {
    step('Uploading image');
    // eslint-disable-next-line no-await-in-loop
    const file = await fetchAsFile(src);
    // eslint-disable-next-line no-await-in-loop
    const { blob, aspectRatio } = await uploadImageFile(agent, file);
    uploads.set(src, { blob, aspectRatio });
  }

  let coverImage;
  if (post.coverSrc) {
    step('Uploading cover');
    try {
      const file = await fetchAsFile(post.coverSrc);
      const { blob } = await uploadImageFile(agent, file);
      coverImage = blob;
    } catch {
      // A missing cover image shouldn't block the migration.
      coverImage = undefined;
    }
  }

  // 2. Deep-clone the content and swap image `_src` placeholders for blob refs.
  const content = structuredClone(post.content);
  for (const wrap of content.pages[0].blocks) {
    const b = wrap.block;
    if (b?.$type !== 'pub.leaflet.blocks.image') continue;
    const up = b._src ? uploads.get(b._src) : null;
    delete b._src;
    if (up) {
      b.image = up.blob;
      if (up.aspectRatio) b.aspectRatio = up.aspectRatio;
    }
  }

  // 3. Assemble and write the record.
  const record = {
    $type: STANDARD_DOC,
    title: post.title,
    site: BLOG_PUBLICATION,
    path: `/${post.slug}`,
    content,
    publishedAt: post.publishedAt,
  };
  if (post.description) record.description = post.description;
  if (coverImage) record.coverImage = coverImage;
  if (post.commentsUri) record.commentsUri = post.commentsUri;

  onProgress('Writing record…');
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: STANDARD_DOC,
    rkey: post.slug,
    record,
  });

  return {
    rkey: post.slug,
    uri: `at://${did}/${STANDARD_DOC}/${post.slug}`,
    href: `/blogging/${post.slug}`,
  };
}
