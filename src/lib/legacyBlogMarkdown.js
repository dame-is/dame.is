// Pure markdown → pub.leaflet.content conversion for the legacy blog migration.
//
// Split out from legacyBlog.js so it can be unit-tested in plain Node without
// Vite's `import.meta.glob` or the React upload helpers. Nothing here touches
// the network, the DOM, or the PDS — it only turns a markdown string (plus
// its front matter) into the block-document shape the site renders.

import { marked } from 'marked';

marked.use({ gfm: true, breaks: false, async: false });

const CONTENT_TYPE = 'pub.leaflet.content';
const PAGE_TYPE = 'pub.leaflet.pages.linearDocument';
const WRAPPER_TYPE = 'pub.leaflet.pages.linearDocument#block';

const FACET = {
  link: (uri) => ({ $type: 'pub.leaflet.richtext.facet#link', uri }),
  bold: { $type: 'pub.leaflet.richtext.facet#bold' },
  italic: { $type: 'pub.leaflet.richtext.facet#italic' },
  strikethrough: { $type: 'pub.leaflet.richtext.facet#strikethrough' },
  code: { $type: 'pub.leaflet.richtext.facet#code' },
};

// marked HTML-escapes the `.text` of inline tokens (text, codespan, image alt
// & title) — correct when it renders to HTML, but leaflet `plaintext` is shown
// verbatim, so `"` must be a real quote, not `&quot;`. Decode named + numeric
// entities in one left-to-right pass so `&amp;quot;` stays `&quot;`.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  if (!s || s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, body) => {
    if (body[0] === '#') {
      const code =
        body[1].toLowerCase() === 'x'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
  });
}

/* ------------------------------------------------------------------ */
/* Front matter                                                         */
/* ------------------------------------------------------------------ */

export function parseFrontMatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    meta[kv[1]] = v;
  }
  return { meta, body: m[2] };
}

export function parsePublishedAt(meta) {
  const date = (meta.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  let h = 12;
  let min = 0;
  const t = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(meta.time || '');
  if (t) {
    h = parseInt(t[1], 10) % 12;
    if (/pm/i.test(t[3] || '')) h += 12;
    min = parseInt(t[2], 10);
  }
  const hh = String(h).padStart(2, '0');
  const mm = String(min).padStart(2, '0');
  // The old `time` strings say "EST"; use a fixed -05:00 offset. Precise DST
  // handling isn't worth it — this only feeds the displayed date / day-of-life.
  const d = new Date(`${date}T${hh}:${mm}:00-05:00`);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date(`${date}T12:00:00Z`);
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }
  return d.toISOString();
}

/* ------------------------------------------------------------------ */
/* Markdown → pub.leaflet.content                                       */
/* ------------------------------------------------------------------ */

/** Convert a markdown body into a `pub.leaflet.content` value. */
export function markdownToContent(body) {
  const tokens = marked.lexer(body || '');
  let blocks = blocksFromTokens(tokens);
  if (blocks.length === 0) {
    blocks = [{ $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] }];
  }
  return {
    $type: CONTENT_TYPE,
    pages: [
      {
        $type: PAGE_TYPE,
        blocks: blocks.map((block) => ({ $type: WRAPPER_TYPE, block })),
      },
    ],
  };
}

function blocksFromTokens(tokens) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'heading':
        out.push(headerBlock(t));
        break;
      case 'paragraph':
        out.push(...paragraphBlocks(t.tokens || []));
        break;
      case 'blockquote':
        out.push(...blockquoteBlocks(t));
        break;
      case 'list':
        out.push(listBlock(t));
        break;
      case 'code':
        out.push(codeBlock(t));
        break;
      case 'hr':
        out.push({ $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] });
        break;
      case 'html':
        out.push(...htmlBlocks(t));
        break;
      case 'space':
      default:
        break;
    }
  }
  return out;
}

function headerBlock(t) {
  const { plaintext, facets } = inlineToRichText(t.tokens || []);
  return {
    $type: 'pub.leaflet.blocks.header',
    plaintext,
    level: Math.min(Math.max(Number(t.depth) || 2, 1), 6),
    facets,
  };
}

function textBlock(rt) {
  return { $type: 'pub.leaflet.blocks.text', plaintext: rt.plaintext, facets: rt.facets };
}

// A paragraph may hold standalone images (their own image blocks) interleaved
// with text. Split it so each image becomes its own image block.
function paragraphBlocks(tokens) {
  const out = [];
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const rt = inlineToRichText(buffer);
    if (rt.plaintext.trim() || rt.facets.length) out.push(textBlock(rt));
    buffer = [];
  };
  for (const t of tokens) {
    if (t.type === 'image') {
      flush();
      out.push(imageBlock(t));
    } else {
      buffer.push(t);
    }
  }
  flush();
  return out;
}

function blockquoteBlocks(t) {
  const out = [];
  for (const inner of t.tokens || []) {
    if (inner.type === 'paragraph') {
      // Render quote paragraphs in italics so the quotation still reads as one
      // (leaflet has no dedicated blockquote block).
      out.push(textBlock(inlineToRichText(inner.tokens || [], [FACET.italic])));
    } else {
      out.push(...blocksFromTokens([inner]));
    }
  }
  return out;
}

function imageBlock(t) {
  const block = {
    $type: 'pub.leaflet.blocks.image',
    alt: decodeEntities(t.text || ''),
    _src: t.href, // resolved to a blob ref at migrate time
  };
  if (t.title) block.caption = decodeEntities(t.title);
  return block;
}

function codeBlock(t) {
  const block = { $type: 'pub.leaflet.blocks.code', plaintext: t.text || '' };
  if (t.lang) block.language = t.lang;
  return block;
}

function listBlock(t) {
  const ordered = Boolean(t.ordered);
  return {
    $type: ordered ? 'pub.leaflet.blocks.orderedList' : 'pub.leaflet.blocks.unorderedList',
    children: (t.items || []).map((item) => listItem(item, ordered)),
  };
}

function listItem(item, ordered) {
  let contentTokens = [];
  let children = [];
  for (const tk of item.tokens || []) {
    if (tk.type === 'text' || tk.type === 'paragraph') {
      contentTokens = tk.tokens || [{ type: 'text', text: tk.text || '' }];
    } else if (tk.type === 'list') {
      children = (tk.items || []).map((it) => listItem(it, Boolean(tk.ordered)));
    }
  }
  const rt = inlineToRichText(contentTokens);
  return {
    $type: ordered
      ? 'pub.leaflet.blocks.orderedList#listItem'
      : 'pub.leaflet.blocks.unorderedList#listItem',
    content: { $type: 'pub.leaflet.blocks.text', plaintext: rt.plaintext, facets: rt.facets },
    children,
  };
}

// The Eleventy posts embed Bluesky posts as raw <blockquote data-bluesky-uri>
// HTML (from the official embed snippet). Recover the AT URI and turn it into a
// first-class bskyPost block; drop any other raw HTML.
function htmlBlocks(t) {
  const uri = /data-bluesky-uri="(at:\/\/[^"]+)"/.exec(t.text || t.raw || '');
  if (uri) return [{ $type: 'pub.leaflet.blocks.bskyPost', postRef: { uri: uri[1] } }];
  return [];
}

/* ------------------------------------------------------------------ */
/* Inline markdown → plaintext + facets                                 */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();
const byteLen = (s) => encoder.encode(s).length;

/**
 * Flatten inline markdown tokens into `{ plaintext, facets }`. Facets carry
 * UTF-8 byte offsets (matching the leaflet renderer) and are only emitted on
 * leaf text runs, so nested formatting stacks as multiple features on one
 * range rather than producing overlapping facets (which the renderer drops).
 */
export function inlineToRichText(tokens, baseFeatures = []) {
  let text = '';
  const facets = [];

  const append = (raw, features) => {
    const str = decodeEntities(raw);
    if (!str) return;
    const start = byteLen(text);
    text += str;
    const end = byteLen(text);
    if (features.length && end > start) {
      facets.push({ index: { byteStart: start, byteEnd: end }, features: features.map(clone) });
    }
  };

  const walk = (toks, features) => {
    for (const t of toks || []) {
      switch (t.type) {
        case 'text':
          if (Array.isArray(t.tokens) && t.tokens.length) walk(t.tokens, features);
          else append(t.text, features);
          break;
        case 'escape':
          append(t.text, features);
          break;
        case 'br':
          text += '\n';
          break;
        case 'codespan':
          append(t.text, features.concat(FACET.code));
          break;
        case 'strong':
          walk(t.tokens, features.concat(FACET.bold));
          break;
        case 'em':
          walk(t.tokens, features.concat(FACET.italic));
          break;
        case 'del':
          walk(t.tokens, features.concat(FACET.strikethrough));
          break;
        case 'link':
          walk(t.tokens, features.concat(FACET.link(t.href)));
          break;
        case 'image':
          // An inline image inside otherwise-textual content: keep its alt so
          // the sentence still reads (standalone images are split out earlier).
          append(t.text || '', features);
          break;
        default:
          if (t.text) append(t.text, features);
      }
    }
  };

  walk(tokens, baseFeatures);
  return { plaintext: text, facets };
}

function clone(feature) {
  return { ...feature };
}
