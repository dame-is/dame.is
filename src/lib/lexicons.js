// Templated form definitions for the lexicons used by dame.is.
//
// Each entry describes how the admin editor should render a record value.
// Anything not listed here falls back to a raw JSON editor. The templates are
// intentionally lightweight — they cover the everyday fields, and the JSON
// toggle inside the editor lets you reach anything they don't model.

import { COLLECTIONS } from '../config.js';

/**
 * Field types understood by the form renderer:
 *
 *   - text:               single-line input
 *   - textarea:           multi-line input
 *   - markdown:           larger textarea, monospace
 *   - datetime:           ISO datetime; supports default: 'now'
 *   - tags:               comma-separated list, stored as string[]
 *   - json:               raw JSON; stored as parsed object/array
 *   - boolean:            checkbox
 *   - number:             numeric input
 *   - select:             dropdown; pass `options` as string[] or { value, label }[]
 *   - category:           text input + clickable suggestion chips (open string)
 *   - blocks:             pub.leaflet.content body editor — text/header/image/
 *                         website/code/list/bskyPost, with image uploads
 *   - publicationPicker:  dropdown of site.standard.publication records under
 *                         the signed-in user's DID; stores an at:// URI
 *
 * Optional flags per field:
 *   - required        — must be present to submit
 *   - autoOnEdit      — datetime fields like `updatedAt` are auto-bumped on save
 *   - default         — initial value when creating a new record
 *   - placeholder, maxLength, hint, suggestions
 *
 * Optional lexicon-level hooks:
 *   - derive(record, { rkey }) — return a record with any rkey-derived fields
 *                                stamped (e.g. site.standard.document.path)
 *   - migrate(value)            — rewrite a legacy fetched value into the new
 *                                shape before it hits the form
 *   - stripLegacyKeys           — array of top-level keys to delete from the
 *                                outgoing record (used to clean up old fields
 *                                after auto-migration)
 */

const COMMON_TIMESTAMPS = [
  { key: 'createdAt', label: 'Created at', type: 'datetime', default: 'now', required: true },
  { key: 'updatedAt', label: 'Updated at', type: 'datetime', default: 'now', autoOnEdit: true },
];

export const LEXICONS = {
  [COLLECTIONS.now]: {
    label: 'Status update',
    summary: 'Short "what I am doing right now" entries shown in the chrome bar and on /logging.',
    rkeyMode: 'tid',
    typeFieldValue: COLLECTIONS.now,
    fields: [
      { key: 'status', label: 'Status', type: 'text', required: true, placeholder: 'mothing, hiking, …' },
      ...COMMON_TIMESTAMPS,
    ],
  },

  [COLLECTIONS.creating]: {
    label: 'Created work',
    summary: 'Portfolio items shown on /creating. Body is a pub.leaflet.content block document.',
    rkeyMode: 'tid',
    typeFieldValue: COLLECTIONS.creating,
    fields: [
      { key: 'title',    label: 'Title',    type: 'text', required: true },
      { key: 'slug',     label: 'Slug',     type: 'text', required: true },
      {
        key: 'category', label: 'Category', type: 'category',
        placeholder: 'art, software, writing, …',
        suggestions: ['art', 'software', 'writing', 'music', 'video', 'photography', 'design'],
      },
      { key: 'tags',     label: 'Tags',     type: 'tags' },
      { key: 'summary',  label: 'Summary',  type: 'textarea' },
      { key: 'content',  label: 'Body',     type: 'blocks' },
      ...COMMON_TIMESTAMPS,
    ],
    stripLegacyKeys: ['kind', 'body', 'bodyFormat', 'media', 'links'],
    migrate: migrateLegacyCreating,
  },

  // COLLECTIONS.blogging resolves to this NSID. One form serves both blog
  // posts and creative works — the publication you pick decides the surface:
  // the portfolio publication renders on /creating, anything else on /blogging.
  'site.standard.document': {
    label: 'Document (blog post / creative work)',
    summary:
      'standard.site documents. Pick the portfolio publication to publish a creative work (rendered on /creating); pick the blog publication for a blog post (/blogging).',
    rkeyMode: 'tid',
    typeFieldValue: 'site.standard.document',
    fields: [
      { key: 'title',       label: 'Title',        type: 'text',     required: true },
      { key: 'description', label: 'Description',  type: 'textarea', hint: 'Shown in feed cards and search results.' },
      {
        key: 'site', label: 'Publication', type: 'publicationPicker', required: true,
        hint: 'Portfolio publication → /creating. Blog publication → /blogging.',
      },
      {
        key: 'path', label: 'Path (slug)', type: 'text', placeholder: '/my-work',
        hint: 'URL slug. Leave blank to derive from the record key.',
      },
      {
        key: 'tags', label: 'Tags', type: 'tags',
        hint: 'For creative works the first tag is treated as the primary category.',
      },
      {
        key: 'coverImage', label: 'Cover image', type: 'image',
        hint: 'Optional thumbnail / hero shown on cards and at the top of the work.',
      },
      { key: 'content',     label: 'Body',         type: 'blocks' },
      {
        key: 'links', label: 'Links', type: 'json',
        hint: 'Optional external links (standard.site union — raw JSON).',
      },
      {
        key: 'draft', label: 'Draft — hidden from public feeds (admin still sees it)',
        type: 'boolean',
      },
      { key: 'publishedAt', label: 'Published at', type: 'datetime', default: 'now', required: true },
    ],
    // Keep a user-entered path; otherwise derive one from the record key.
    derive: (record, { rkey }) => (rkey ? { ...record, path: record.path || `/${rkey}` } : record),
  },

  [COLLECTIONS.page]: {
    label: 'Page content',
    summary: 'Named page bodies (home, about, posting, …). The rkey doubles as the page slug.',
    rkeyMode: 'fixed',
    rkeyPlaceholder: 'home, about, posting, …',
    typeFieldValue: COLLECTIONS.page,
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'intro', label: 'Intro', type: 'textarea' },
      { key: 'body', label: 'Body (Markdown)', type: 'markdown' },
      ...COMMON_TIMESTAMPS,
    ],
  },

  [COLLECTIONS.profile]: {
    label: 'Extended profile',
    summary: 'A single record with rkey "self" that backs /about.',
    rkeyMode: 'fixed',
    rkeyPlaceholder: 'self',
    rkeyDefault: 'self',
    typeFieldValue: COLLECTIONS.profile,
    fields: [
      { key: 'tagline', label: 'Tagline', type: 'text' },
      { key: 'bio', label: 'Bio (Markdown)', type: 'markdown' },
      ...COMMON_TIMESTAMPS,
    ],
  },

  [COLLECTIONS.heroPhrase]: {
    label: 'Hero phrase',
    summary:
      'Rotating phrases for the home hero sentence. "role" fills "dame is [a design engineer]"; "clause" fills "who [makes social software]".',
    rkeyMode: 'tid',
    typeFieldValue: COLLECTIONS.heroPhrase,
    fields: [
      {
        key: 'part',
        label: 'Part',
        type: 'select',
        required: true,
        default: 'role',
        options: [
          { value: 'role', label: 'Role — "a design engineer"' },
          { value: 'clause', label: 'Clause — "who makes…"' },
        ],
      },
      {
        key: 'text',
        label: 'Phrase',
        type: 'text',
        required: true,
        maxLength: 200,
        hint: 'Role: include the article, e.g. "an artist". Clause: start with "who…".',
      },
      { key: 'enabled', label: 'Enabled (shown in rotation)', type: 'boolean', default: true },
      { key: 'createdAt', label: 'Created at', type: 'datetime', default: 'now', required: true },
    ],
  },

  'app.bsky.feed.post': {
    label: 'Bluesky post',
    summary: 'Plain text posts. Embeds are out of scope for the templated editor — use raw JSON.',
    rkeyMode: 'tid',
    typeFieldValue: 'app.bsky.feed.post',
    fields: [
      { key: 'text', label: 'Text', type: 'textarea', required: true, maxLength: 300 },
      { key: 'langs', label: 'Languages', type: 'tags', default: ['en'], hint: 'BCP-47 codes' },
      { key: 'createdAt', label: 'Created at', type: 'datetime', default: 'now', required: true },
    ],
  },
};

export function lexiconFor(collection) {
  return LEXICONS[collection] || null;
}

export function knownCollections() {
  return Object.keys(LEXICONS);
}

/**
 * Build a fresh form-shaped object for a new record using the lexicon's
 * field defaults. `$type` and any required default values are filled in.
 */
export function blankRecordFor(collection) {
  const lex = lexiconFor(collection);
  const out = {};
  if (lex?.typeFieldValue) out.$type = lex.typeFieldValue;
  if (!lex) return out;
  const nowIso = new Date().toISOString();
  for (const f of lex.fields) {
    if (f.default === 'now') {
      out[f.key] = nowIso;
    } else if (f.default !== undefined) {
      out[f.key] = f.default;
    } else if (f.type === 'blocks') {
      out[f.key] = emptyLeafletContent();
    }
  }
  return out;
}

/**
 * Empty pub.leaflet.content shell with a single blank text block so the
 * blocks editor has something to render on mount.
 */
export function emptyLeafletContent() {
  return {
    $type: 'pub.leaflet.content',
    pages: [
      {
        $type: 'pub.leaflet.pages.linearDocument',
        blocks: [
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: { $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] },
          },
        ],
      },
    ],
  };
}

function wrapBlock(block) {
  return { $type: 'pub.leaflet.pages.linearDocument#block', block };
}

/**
 * Migrate a legacy is.dame.creating.work record into the new shape:
 *   - `kind` → `category`
 *   - markdown `body` → single text block
 *   - each image `media[]` → image block with legacy `url` (no blob ref)
 *   - each `links[]` → website block
 * Returns the value untouched if it already has `content`.
 */
export function migrateLegacyCreating(v) {
  if (!v || v.content) return v;
  const blocks = [];
  if (typeof v.body === 'string' && v.body.length > 0) {
    blocks.push(wrapBlock({ $type: 'pub.leaflet.blocks.text', plaintext: v.body, facets: [] }));
  }
  for (const m of v.media || []) {
    if (m?.kind === 'image' && m.url) {
      blocks.push(wrapBlock({ $type: 'pub.leaflet.blocks.image', url: m.url, alt: m.alt || '' }));
    }
  }
  for (const l of v.links || []) {
    if (!l?.url) continue;
    blocks.push(wrapBlock({
      $type: 'pub.leaflet.blocks.website',
      src: l.url,
      title: l.label || l.url,
    }));
  }
  if (blocks.length === 0) {
    blocks.push(wrapBlock({ $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] }));
  }
  const next = {
    ...v,
    category: v.category || v.kind || '',
    content: {
      $type: 'pub.leaflet.content',
      pages: [{ $type: 'pub.leaflet.pages.linearDocument', blocks }],
    },
  };
  // Strip legacy fields so the form doesn't think they're still in scope.
  delete next.kind;
  delete next.body;
  delete next.bodyFormat;
  delete next.media;
  delete next.links;
  return next;
}
