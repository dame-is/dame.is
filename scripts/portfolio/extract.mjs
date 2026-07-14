#!/usr/bin/env node
/*
 * Extracts the creative-works content from the old Adobe Portfolio site
 * (https://dame.work/art) into a single, human-editable `works.json`.
 *
 * The old site lazy-loads everything with JavaScript, but the real image
 * URLs, captions, and text live in the server-rendered HTML as
 * `data-src` / `data-srcset` attributes and `project-module` blocks — so a
 * plain fetch + parse is enough; no headless browser required.
 *
 *   node scripts/portfolio/extract.mjs
 *
 * Output: scripts/portfolio/works.json — one entry per work, each with a
 * flat, ordered `blocks` array (heading / text / image / embed). Review and
 * edit that file (titles, summaries, alt text, categories), then feed it to
 * `upload.mjs` to publish the records to your PDS.
 *
 * Nothing here writes to the network beyond GETting the public pages.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, 'works.json');

const BASE = 'https://dame.work';

// Largest image width to keep, in px. Adobe serves up to 3840px (~4 MB/JPEG),
// which many PDSes reject as a blob; 2560px is retina-sharp for web and
// typically 1–2 MB. Set MAX_IMG_WIDTH=3840 for full-resolution archival.
const MAX_IMG_WIDTH = Number(process.env.MAX_IMG_WIDTH || 2560);

// Curated metadata, in the same order the gallery grid shows them (newest
// first). Titles come from the grid; categories/tags are normalised to the
// new site's lowercase vocabulary (art, photography, video, craft, writing,
// design, marketing, …) while preserving the author's descriptive labels as
// tags. The page body (images + prose) is scraped below — only this
// top-matter is hand-set. Alongside the art/photography grid, the list also
// carries the old site's case-study and writing-sample pages (design,
// marketing, and writing works).
const WORKS_META = [
  { slug: 'the-encyclopedia-of-nfts', title: 'The Encyclopedia of NFTs', year: 2023, category: 'writing', tags: ['writing', 'nft', 'web3', 'education'],
    summary: 'A comprehensive, two-part guide to Non-Fungible Tokens: the first half explains the terminology and industry landscape, the second helps you decide whether to start collecting or creating.' },
  { slug: 'the-definitive-guide-to-security-for-nft-creators', title: 'The Definitive Guide to Security for NFT Creators', year: 2023, category: 'writing', tags: ['writing', 'nft', 'security', 'web3'],
    summary: 'A practical security handbook for Web3 creators: how crypto wallets actually work, and the wallet and digital-security habits that keep your work and assets safe.' },
  { slug: 'photographs-era-2-part-ii', title: 'Photographs: Era 2 (Part II)', year: 2023, category: 'photography', tags: ['photography'] },
  { slug: 'rainbow', title: 'Rainbow', year: 2022, category: 'marketing', tags: ['marketing', 'community', 'social media', 'web3'],
    summary: "As Content & Community Manager for the Rainbow wallet, I grew its Twitter following from 8,000 to 50,000, hosted a weekly live audio show, and built out its first customer support team." },
  { slug: 'photography',               title: 'Photographs: Era 2 (Part I)',  year: 2022, category: 'photography', tags: ['photography'] },
  { slug: 'proof-of-no-work',          title: 'Proof of (No) Work',           year: 2022, category: 'art',         tags: ['conceptual art', 'design'] },
  { slug: 'gpt-3-dao-essay', title: 'Wannabe DAOs', year: 2021, category: 'writing', tags: ['writing', 'essay', 'dao', 'web3'],
    summary: 'An essay on Decentralized Autonomous Organizations, written in collaboration with GPT-3 — I wrote the opening paragraph and served as editor while GPT-3 did most of the thinking.' },
  { slug: 'assisted-billing', title: 'Assisted Billing', year: 2019, category: 'design', tags: ['design', 'branding', 'marketing', 'direct mail'],
    summary: "Branding, direct mail, and marketing for Fusion Web Clinic's new revenue-cycle service — a campaign built around a reimagined CMS-1500 claim form that turned 320 mailers into 6 new customers." },
  { slug: 'red-blue-yellow',           title: 'Red, Blue, Yellow',            year: 2019, category: 'art',         tags: ['painting', 'water-based paint'] },
  { slug: 'fusion-branding', title: 'Fusion Web Clinic', year: 2018, category: 'design', tags: ['design', 'branding', 'marketing'],
    summary: "As Creative Specialist for Fusion Web Clinic, I refreshed the company's logo and visual identity and built the style guides, templates, and training that made its marketing collateral look professional." },
  { slug: 'leather-notebooks',         title: 'Leather Notebooks',            year: 2014, category: 'craft',       tags: ['leather', 'paper'] },
  { slug: 'photographs-era-1-part-i',  title: 'Photographs: Era 1 (Part II)', year: 2011, category: 'photography', tags: ['photography'] },
  { slug: 'brickfilms',                title: 'Brickfilms',                   year: 2011, category: 'video',       tags: ['stop-motion', 'lego', 'animation'] },
];

// --- HTML helpers -----------------------------------------------------------

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/ /g, ' ');
}

function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Pull the largest variant + aspect ratio + alt out of a single <img> tag.
function imageFromTag(tag) {
  const srcsetMatch = tag.match(/data-srcset="([^"]+)"/) || tag.match(/\bsrcset="([^"]+)"/);
  let url = null;
  if (srcsetMatch) {
    // Pick the largest variant that is still within MAX_IMG_WIDTH; if every
    // variant is wider, fall back to the smallest one available.
    const variants = [];
    for (const part of srcsetMatch[1].split(',')) {
      const m = part.trim().match(/(\S+)\s+(\d+)w/);
      if (m) variants.push({ url: m[1], w: Number(m[2]) });
    }
    variants.sort((a, b) => a.w - b.w);
    const fitting = variants.filter((v) => v.w <= MAX_IMG_WIDTH);
    const pick = fitting.length ? fitting[fitting.length - 1] : variants[0];
    if (pick) url = pick.url;
  }
  if (!url) {
    const direct = tag.match(/data-src="([^"]+)"/) || tag.match(/\bsrc="(https:[^"]+)"/);
    url = direct ? direct[1] : null;
  }
  if (!url || url.startsWith('data:')) return null;

  // Adobe encodes the layout aspect ratio as `width="W"` + `padding-bottom: P%`.
  const w = Number((tag.match(/width="(\d+)"/) || [])[1] || 0);
  const pb = parseFloat((tag.match(/padding-bottom:\s*([\d.]+)%/) || [])[1] || '0');
  const aspectRatio = w > 0 && pb > 0 ? { width: w, height: Math.round((w * pb) / 100) } : null;

  const alt = decodeEntities((tag.match(/\balt="([^"]*)"/) || [])[1] || '').trim();
  return { url, aspectRatio, alt };
}

// Return the inner HTML of a <div> whose opening tag ends at `openEnd`,
// matching nested <div>s so we stop at the *correct* closing tag.
function innerBalancedDiv(html, openEnd) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = openEnd;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[0] === '</div>') {
      if (--depth === 0) return html.slice(openEnd, m.index);
    } else depth++;
  }
  return html.slice(openEnd);
}

// Immediate <div> children of a fragment, with their attribute string.
function topLevelDivs(inner) {
  const re = /<div\b([^>]*)>/g;
  const out = [];
  let m;
  while ((m = re.exec(inner))) {
    const start = re.lastIndex;
    const body = innerBalancedDiv(inner, start);
    out.push({ attrs: m[1], body });
    re.lastIndex = start + body.length + 6; // skip body + its </div>
  }
  return out;
}

// Plain text + inline link list for a rich-text fragment. Link display text
// stays inline in the plaintext; `upload.mjs` turns each into a byte-offset
// facet by locating that text.
function richText(html) {
  const links = [];
  const inlined = html.replace(
    /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_full, href, inner) => {
      const text = stripTags(inner).trim();
      const uri = decodeEntities(href);
      // Skip empty anchors and old on-site relative links (those pages are
      // moving); keep only real external URLs.
      if (text && /^https?:\/\//i.test(uri)) links.push({ text, uri });
      return inner;
    },
  );
  return { text: stripTags(inlined), links };
}

// Caption shown under a single image module (Adobe `module-caption`).
function captionOf(chunk) {
  const m = chunk.match(/<div class="[^"]*module-caption[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  return m ? stripTags(m[1]) : '';
}

// Turn a text module's rich-text body into ordered heading/text blocks.
//
// Adobe nests the body as a tree of <div>s: `title` / `sub-title` divs are
// headings, leaf divs are paragraphs, and wrapper divs (notably `main-text`)
// just hold more of the same. We walk that tree depth-first so every heading
// and paragraph becomes its own block. Flattening a wrapper with stripTags()
// instead would splice its child divs together with no separator, smashing a
// whole section — headings, sub-titles, and paragraphs — into one run-on
// block (e.g. "…called Standards.StandardsA token standard is…").
function walkRichDivs(inner, out, pushPara) {
  const children = topLevelDivs(inner);
  if (children.length === 0) {
    pushPara(inner); // leaf: a bare paragraph
    return;
  }
  for (const ch of children) {
    if (/\btitle\b/.test(ch.attrs)) {
      // Matches both `title` and `sub-title` (the hyphen is a word boundary).
      const { text } = richText(ch.body);
      if (text.trim()) out.push({ type: 'heading', level: 2, text });
    } else if (/<div\b/.test(ch.body)) {
      walkRichDivs(ch.body, out, pushPara); // wrapper: descend into it
    } else {
      pushPara(ch.body);
    }
  }
}

function textBlocks(chunk) {
  const open = chunk.match(/<div class="[^"]*module-text[^"]*"[^>]*>/);
  if (!open) return [];
  const inner = innerBalancedDiv(chunk, open.index + open[0].length);
  const out = [];
  const pushPara = (html) => {
    const { text, links } = richText(html);
    if (text.trim()) out.push(links.length ? { type: 'text', text, links } : { type: 'text', text });
  };
  walkRichDivs(inner, out, pushPara);
  return out;
}

function embedBlock(src) {
  const yt = src.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/) || src.match(/youtu\.be\/([\w-]+)/);
  if (yt) {
    return { type: 'embed', provider: 'youtube', title: 'Watch on YouTube', url: `https://www.youtube.com/watch?v=${yt[1]}`, embedSrc: src };
  }
  if (/adobe\.io|behance/i.test(src)) {
    // Adobe/Behance player embeds aren't a public watch URL — leave the raw
    // embed src in `embedSrc` so it can be replaced with a real link by hand.
    return { type: 'embed', provider: 'adobe', title: 'Watch the reel', url: src, embedSrc: src, note: 'Replace `url` with a public link if you have one (e.g. YouTube/Vimeo).' };
  }
  return { type: 'embed', provider: 'embed', title: 'Watch', url: src, embedSrc: src };
}

// --- Page parsing -----------------------------------------------------------

function blocksFromPage(html) {
  // Drop the "Suggested Content" footer and everything after it.
  const main = html.split(/<section class="other-projects"/)[0];
  const chunks = main.split(/<div class="project-module module /).slice(1);
  const blocks = [];

  for (const chunk of chunks) {
    const type = (chunk.match(/^([\w-]+)/) || [])[1];

    if (type === 'text') {
      blocks.push(...textBlocks(chunk));
    } else if (type === 'image') {
      const tag = (chunk.match(/<img[\s\S]*?>/) || [])[0] || '';
      const img = imageFromTag(tag);
      if (img) {
        const caption = captionOf(chunk);
        blocks.push({ type: 'image', url: img.url, alt: caption || img.alt || '', ...(img.aspectRatio ? { aspectRatio: img.aspectRatio } : {}) });
      }
    } else if (type === 'media_collection') {
      for (const tag of chunk.match(/<img[\s\S]*?>/g) || []) {
        const img = imageFromTag(tag);
        if (img) blocks.push({ type: 'image', url: img.url, alt: img.alt || '', ...(img.aspectRatio ? { aspectRatio: img.aspectRatio } : {}) });
      }
    } else if (type === 'embed' || type === 'video') {
      const src = (chunk.match(/<iframe[^>]+src="([^"]+)"/) || [])[1];
      if (src) blocks.push(embedBlock(decodeEntities(src)));
    }
  }

  // Adobe galleries render each photo twice (slide + lightbox). Keep the
  // first occurrence of each underlying image (matched by its UUID).
  const seen = new Set();
  return blocks.filter((b) => {
    if (b.type !== 'image') return true;
    const uuid = (b.url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [b.url])[0];
    if (seen.has(uuid)) return false;
    seen.add(uuid);
    return true;
  });
}

function summaryFrom(blocks) {
  const first = blocks.find((b) => b.type === 'text');
  if (!first) return '';
  const t = first.text.replace(/\s+/g, ' ').trim();
  return t.length > 300 ? t.slice(0, 297).trimEnd() + '…' : t;
}

// --- Main -------------------------------------------------------------------

async function fetchPage(slug) {
  const url = `${BASE}/${slug}`;
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (portfolio-export)' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

// `--only=slug[,slug]` re-extracts just those works and merges them into any
// existing works.json, leaving every other work untouched (so hand-curated
// summaries / alt text on works you're not re-extracting survive). Without it,
// the whole file is regenerated from the live pages.
function parseOnly() {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--only='));
  if (!hit) return null;
  return hit.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
}

async function readExisting() {
  try {
    const parsed = JSON.parse(await readFile(OUT, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // first run — no file yet
  }
}

async function main() {
  const only = parseOnly();
  const targets = only ? WORKS_META.filter((m) => only.includes(m.slug)) : WORKS_META;
  if (only) {
    const unknown = only.filter((s) => !WORKS_META.some((m) => m.slug === s));
    if (unknown.length) console.log(`[extract] unknown slug(s) ignored: ${unknown.join(', ')}`);
    console.log(`[extract] --only: re-extracting ${targets.length} work(s), preserving the rest`);
  }

  const fresh = new Map();
  for (const meta of targets) {
    process.stdout.write(`[extract] ${meta.slug} … `);
    const html = await fetchPage(meta.slug);
    const blocks = blocksFromPage(html);
    const images = blocks.filter((b) => b.type === 'image').length;
    console.log(`${blocks.length} blocks (${images} images)`);
    fresh.set(meta.slug, {
      slug: meta.slug,
      title: meta.title,
      category: meta.category,
      tags: meta.tags,
      year: meta.year,
      createdAt: `${meta.year}-01-01T00:00:00.000Z`,
      // A curated `summary` in WORKS_META wins (survives re-extraction);
      // otherwise fall back to the work's first paragraph.
      summary: meta.summary || summaryFrom(blocks),
      source: `${BASE}/${meta.slug}`,
      blocks,
    });
  }

  // Rebuild in WORKS_META order: a freshly extracted work where we have one,
  // otherwise the previously committed entry copied through verbatim. On an
  // --only run this leaves every other work byte-for-byte identical.
  const existingBySlug = new Map((await readExisting()).map((w) => [w.slug, w]));
  const works = [];
  for (const meta of WORKS_META) {
    if (fresh.has(meta.slug)) works.push(fresh.get(meta.slug));
    else if (existingBySlug.has(meta.slug)) works.push(existingBySlug.get(meta.slug));
  }
  // Keep any committed works that aren't in WORKS_META (defensive; none today).
  for (const [slug, w] of existingBySlug) {
    if (!WORKS_META.some((m) => m.slug === slug)) works.push(w);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(works, null, 2) + '\n', 'utf-8');
  const totalImages = works.reduce((n, w) => n + w.blocks.filter((b) => b.type === 'image').length, 0);
  console.log(`\n[extract] wrote ${OUT}`);
  console.log(`[extract] ${works.length} works, ${totalImages} images total`);
}

main().catch((err) => {
  console.error('[extract] failed:', err);
  process.exitCode = 1;
});
