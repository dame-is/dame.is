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
 *   - text:      single-line input
 *   - textarea:  multi-line input
 *   - markdown:  larger textarea, monospace
 *   - datetime:  ISO datetime; supports default: 'now'
 *   - tags:      comma-separated list, stored as string[]
 *   - json:      raw JSON; stored as parsed object/array
 *   - boolean:   checkbox
 *   - number:    numeric input
 *   - select:    dropdown; pass `options` as string[] or { value, label }[]
 *
 * Optional flags per field:
 *   - required        — must be present to submit
 *   - autoOnEdit      — datetime fields like `updatedAt` are auto-bumped on save
 *   - default         — initial value when creating a new record
 *   - placeholder, maxLength, hint
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

  [COLLECTIONS.blogging]: {
    label: 'Blog post',
    summary: 'Long-form entries rendered on /blogging.',
    rkeyMode: 'tid',
    typeFieldValue: COLLECTIONS.blogging,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'slug', label: 'Slug', type: 'text', required: true, placeholder: 'a-short-url-friendly-id' },
      { key: 'summary', label: 'Summary', type: 'textarea', hint: 'Optional. Used on listing pages.' },
      { key: 'body', label: 'Body (Markdown)', type: 'markdown', required: true },
      { key: 'tags', label: 'Tags', type: 'tags' },
      ...COMMON_TIMESTAMPS,
    ],
  },

  [COLLECTIONS.creating]: {
    label: 'Created work',
    summary: 'Portfolio items (art, software, writing) shown on /creating.',
    rkeyMode: 'tid',
    typeFieldValue: COLLECTIONS.creating,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'slug', label: 'Slug', type: 'text', required: true },
      { key: 'kind', label: 'Kind', type: 'text', placeholder: 'art / software / writing / …' },
      { key: 'summary', label: 'Summary', type: 'textarea' },
      { key: 'body', label: 'Body (Markdown)', type: 'markdown' },
      { key: 'media', label: 'Media (raw JSON array)', type: 'json', hint: '[{ "kind": "image", "url": "…", "alt": "…" }]' },
      ...COMMON_TIMESTAMPS,
    ],
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
    }
  }
  return out;
}
