// Templated form definitions for the lexicons used by dame.is.
//
// Each entry describes how the admin editor should render a record value.
// Anything not listed here falls back to a raw JSON editor. The templates are
// intentionally lightweight — they cover the everyday fields, and the JSON
// toggle inside the editor lets you reach anything they don't model.

import { COLLECTIONS, GUESTBOOK_NSID, BLOG_PUBLICATION } from '../config.js';

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
    label: 'Logging',
    summary: 'Short "what I am doing right now" status updates shown in the chrome bar and on /logging.',
    rkeyMode: 'tid',
    typeFieldValue: COLLECTIONS.now,
    fields: [
      { key: 'status', label: 'Status', type: 'text', required: true, placeholder: 'mothing, hiking, …' },
      ...COMMON_TIMESTAMPS,
    ],
  },

  [COLLECTIONS.creating]: {
    label: 'Created work (legacy)',
    summary:
      'Legacy portfolio type. New creative works are site.standard.document records in the portfolio publication — use "New creative work" above. Kept here to view/edit or migrate old records.',
    legacy: true,
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
    label: 'Document',
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
        hint: 'URL slug for /creating works. Leave blank to derive from the record key. Blog posts always use the record key — this field is ignored for the blog publication.',
      },
      {
        key: 'tags', label: 'Tags', type: 'tags',
        hint: 'For creative works the first tag is treated as the primary category.',
      },
      {
        key: 'coverImage', label: 'Cover image', type: 'image',
        hint: 'Optional thumbnail / hero shown on cards and at the top of the work.',
      },
      {
        key: 'draft', label: 'Draft — hidden from public feeds (admin still sees it)',
        type: 'boolean',
      },
      { key: 'publishedAt', label: 'Published at', type: 'datetime', default: 'now', required: true },
      { key: 'content',     label: 'Body',         type: 'blocks' },
      {
        key: 'commentsUri', label: 'Bluesky comments post', type: 'bskyThread',
        hint: 'Link a Bluesky post whose replies become this post’s comments. Paste its URL, at:// URI, or rkey.',
      },
      {
        key: 'links', label: 'Links', type: 'json',
        hint: 'Optional external links (standard.site union — raw JSON).',
      },
    ],
    // Stamp the URL slug from the record key.
    //
    // Blog posts are served and linked only at /blogging/{rkey} — the site
    // never routes a blog doc by its `path` (see resolveById in BlogPost.jsx
    // and resolveBlog in og/records.js, both rkey-matched). A custom path there
    // only desyncs the Standard Site canonical URL (publication.url + path) from
    // the URL the site actually serves, which silently breaks the Bluesky
    // "Standard Site" embed. So a blog-homed doc always takes the rkey as its
    // path, regardless of any slug typed in the editor.
    //
    // Portfolio works are different: /creating *does* route by `path` (workSlug),
    // so they keep a user-entered slug and only fall back to the rkey when blank.
    derive: (record, { rkey }) => {
      if (!rkey) return record;
      const path =
        record.site === BLOG_PUBLICATION ? `/${rkey}` : record.path || `/${rkey}`;
      return { ...record, path };
    },
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
    label: 'About',
    summary: 'The extended profile — a single record with rkey "self" that backs /themself.',
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
    label: 'Hero phrases',
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

  [COLLECTIONS.resumeJob]: {
    label: 'Resume · job',
    summary:
      'A canonical position in your work history. Owns the achievement bullets (highlights); resumes backlink here and pick which bullets to show.',
    rkeyMode: 'fixed',
    rkeyPlaceholder: 'ipfs-content-manager',
    typeFieldValue: COLLECTIONS.resumeJob,
    fields: [
      { key: 'organization', label: 'Organization', type: 'text', required: true },
      { key: 'organizationUrl', label: 'Organization URL', type: 'text' },
      { key: 'title', label: 'Title', type: 'text', required: true },
      {
        key: 'employmentType', label: 'Employment type', type: 'select',
        options: ['full-time', 'part-time', 'contract', 'freelance', 'self-employed', 'internship', 'volunteer'],
      },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'locationType', label: 'Location type', type: 'select', options: ['on-site', 'remote', 'hybrid'] },
      { key: 'startDate', label: 'Start date', type: 'text', placeholder: 'YYYY or YYYY-MM', required: true },
      { key: 'endDate', label: 'End date', type: 'text', placeholder: 'YYYY or YYYY-MM (blank if current)' },
      { key: 'current', label: 'Current role', type: 'boolean', default: false },
      { key: 'summary', label: 'Summary', type: 'textarea' },
      {
        key: 'highlights', label: 'Highlights', type: 'highlights',
        hint: 'Achievement bullets. Reorder with the arrows; each is referenced by resumes that tailor which bullets to show. Fork a bullet to keep alternate phrasings of the same point that individual resume versions can pick.',
      },
      { key: 'skills', label: 'Skills', type: 'tags' },
      {
        key: 'links', label: 'Work samples', type: 'links',
        hint: 'Portfolio pieces / links tied to this role — a /creating post (embedded with its cover) or any external URL. Resumes pick which to show under the job.',
      },
      ...COMMON_TIMESTAMPS,
    ],
  },

  [COLLECTIONS.resumeEducation]: {
    label: 'Resume · education',
    summary: 'A canonical education entry. Resumes backlink here, the same way they reference jobs.',
    rkeyMode: 'fixed',
    rkeyPlaceholder: 'private-university-ba',
    typeFieldValue: COLLECTIONS.resumeEducation,
    fields: [
      { key: 'institution', label: 'Institution', type: 'text', required: true },
      { key: 'institutionUrl', label: 'Institution URL', type: 'text' },
      { key: 'area', label: 'Area of study', type: 'text' },
      { key: 'studyType', label: 'Degree / credential', type: 'text' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'startDate', label: 'Start date', type: 'text', placeholder: 'YYYY or YYYY-MM' },
      { key: 'endDate', label: 'End date', type: 'text', placeholder: 'YYYY or YYYY-MM' },
      { key: 'current', label: 'In progress', type: 'boolean', default: false },
      { key: 'summary', label: 'Summary', type: 'textarea' },
      {
        key: 'highlights', label: 'Highlights', type: 'highlights',
        hint: 'Optional honors / coursework bullets. Same shape as a job highlight.',
      },
      ...COMMON_TIMESTAMPS,
    ],
  },

  [COLLECTIONS.resume]: {
    label: 'Resume',
    summary:
      'A resume version. Owns no job facts — it backlinks to jobs/education and selects which highlights to show. Keep several for audience-tailored variants.',
    rkeyMode: 'fixed',
    rkeyPlaceholder: 'primary',
    typeFieldValue: COLLECTIONS.resume,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Primary résumé' },
      { key: 'slug', label: 'Slug', type: 'text', required: true, hint: 'Should match the record key; drives /available/<slug>.' },
      { key: 'headline', label: 'Headline', type: 'text' },
      { key: 'summary', label: 'Summary (Markdown)', type: 'markdown' },
      {
        key: 'visibility', label: 'Visibility', type: 'select', default: 'private',
        hint: 'Site display intent — not privacy. Every PDS record is public.',
        options: [
          { value: 'public', label: 'Public — listed + rendered' },
          { value: 'unlisted', label: 'Unlisted — reachable by URL, not indexed' },
          { value: 'private', label: 'Private — not rendered on the site' },
        ],
      },
      { key: 'featured', label: 'Featured (default at /available)', type: 'boolean', default: false },
      {
        key: 'entries', label: 'Experience (jobs)', type: 'recordRefs',
        refKey: 'job', refCollection: COLLECTIONS.resumeJob, overrides: true,
        hint: 'Pick jobs and order them with the arrows. Per job, choose which highlights show and which phrasing each uses. The tailoring workbench (Resume studio → Tailor) is the richer editor for this.',
      },
      {
        key: 'education', label: 'Education', type: 'recordRefs',
        refKey: 'education', refCollection: COLLECTIONS.resumeEducation,
        hint: 'Pick education records and order them with the arrows.',
      },
      {
        key: 'skills', label: 'Skill groups', type: 'skillGroups',
        hint: 'Grouped skills shown on this resume.',
      },
      {
        key: 'contact', label: 'Contact', type: 'contact',
        hint: 'Leave blank to fall back to the site profile.',
      },
      ...COMMON_TIMESTAMPS,
    ],
  },

  [COLLECTIONS.arenaChannel]: {
    label: 'Curating',
    summary:
      'Publishes an Are.na channel as a gallery at /curating/<rkey>. The rkey is the site slug; arenaSlug points at the channel on are.na.',
    rkeyMode: 'fixed',
    rkeyPlaceholder: 'weird-dogs-only',
    typeFieldValue: COLLECTIONS.arenaChannel,
    fields: [
      {
        key: 'arenaSlug', label: 'Are.na channel slug', type: 'text', required: true,
        placeholder: 'weird-dog-photos-only',
        hint: 'The slug from are.na/<user>/<slug>. The record key is the site slug shown at /curating/<rkey>.',
      },
      { key: 'title', label: 'Title override', type: 'text', hint: 'Blank = channel title from are.na.' },
      { key: 'description', label: 'Description override', type: 'textarea', hint: 'Blank = channel description from are.na.' },
      {
        key: 'coverBlockId', label: 'Cover image', type: 'arenaCover',
        hint: 'Pick which image fronts this gallery on /curating. Blank = the first image in the channel.',
      },
      { key: 'order', label: 'Order', type: 'number', default: 0, hint: 'Lower numbers sort first on /curating.' },
      { key: 'enabled', label: 'Enabled (shown on the site)', type: 'boolean', default: true },
      ...COMMON_TIMESTAMPS,
    ],
  },

  'app.bsky.feed.post': {
    label: 'Posting',
    summary: 'Plain text posts. Embeds are out of scope for the templated editor — use raw JSON.',
    rkeyMode: 'tid',
    typeFieldValue: 'app.bsky.feed.post',
    fields: [
      { key: 'text', label: 'Text', type: 'textarea', required: true, maxLength: 300 },
      { key: 'langs', label: 'Languages', type: 'tags', default: ['en'], hint: 'BCP-47 codes' },
      { key: 'createdAt', label: 'Created at', type: 'datetime', default: 'now', required: true },
    ],
  },

  [GUESTBOOK_NSID]: {
    label: 'Guestbook (the book)',
    summary:
      'The book record visitors sign (rkey "self") — its at-uri is what every signature backlinks to. `hidden` is the moderation list; usually managed from the Guestbook panel or edit mode on /welcoming rather than here.',
    rkeyMode: 'fixed',
    rkeyPlaceholder: 'self',
    rkeyDefault: 'self',
    typeFieldValue: GUESTBOOK_NSID,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'the dame.is guestbook' },
      { key: 'description', label: 'Description', type: 'textarea', hint: 'What signing means, shown to would-be signers.' },
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://dame.is/guestbook' },
      {
        key: 'hidden', label: 'Hidden entry at-uris', type: 'json',
        hint: 'Array of entry at-uris tucked out of public display. Prefer the hide/unhide buttons on /admin?view=guestbook.',
      },
      ...COMMON_TIMESTAMPS,
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
