// Classify `site.standard.document` records by the publication they belong
// to. Creative works and blog posts share the same record type; their `site`
// field (an `at://` URI pointing at a `site.standard.publication`) is what
// decides their *home* feed. See `PORTFOLIO_PUBLICATION` in config.js.
//
// A doc can also be cross-posted so it's a first-class member of *both*
// /creating and /blogging. That's opt-in via a reserved, directional tag on
// the record: `blog` (or `blogging`) additionally surfaces a portfolio-homed
// doc on the blog; `creating` (or `portfolio`) additionally surfaces a
// blog-homed doc on /creating. The `site` field stays the doc's canonical
// home either way — the tag is purely additive.

import { PORTFOLIO_PUBLICATION } from '../config.js';

// Reserved cross-post tags, matched case-insensitively and kept out of the
// visible category (see `workCategory`) so they never render as a medium chip.
const BLOG_TAGS = new Set(['blog', 'blogging']);
const CREATING_TAGS = new Set(['creating', 'portfolio']);
const RESERVED_TAGS = new Set([...BLOG_TAGS, ...CREATING_TAGS]);

// The category a blog post takes on when it's cross-posted onto /creating. A
// blog doc has no medium of its own — its tags describe subject, not craft —
// so the whole class shows under this one category rather than appearing on
// the portfolio grid uncategorized.
export const CROSSPOST_CATEGORY = 'case study';

function tagList(value) {
  return Array.isArray(value?.tags) ? value.tags : [];
}

function hasAnyTag(value, set) {
  return tagList(value).some((t) => set.has(String(t).trim().toLowerCase()));
}

/** True when a standard-document value's home publication is the portfolio. */
export function isPortfolioDoc(value) {
  if (!PORTFOLIO_PUBLICATION) return false;
  return value?.site === PORTFOLIO_PUBLICATION;
}

/**
 * True when a record value is marked a draft. Drafts are hidden from every
 * public surface. The snapshot builder already drops them when it writes the
 * world-readable JSON (see feedBuilder), but the live PDS fetch that pages run
 * to confirm/refresh the snapshot returns *all* records — `listRecords` has no
 * notion of drafts — so each public surface must re-apply this filter or a
 * drafted work reappears the moment the live fetch overlays the snapshot.
 */
export function isDraft(value) {
  return value?.draft === true;
}

/**
 * True when a standard-document value's home feed is the blog. Anything not
 * homed in the portfolio is a blog post — including, while
 * `PORTFOLIO_PUBLICATION` is unset, everything (legacy behavior).
 */
export function isBlogDoc(value) {
  return !isPortfolioDoc(value);
}

/**
 * True when a standard-document value should surface on /creating — either
 * the portfolio is its home publication, or a blog-homed doc opts in with a
 * directional `creating`/`portfolio` tag.
 */
export function showOnCreating(value) {
  return isPortfolioDoc(value) || hasAnyTag(value, CREATING_TAGS);
}

/**
 * True when a standard-document value should surface on /blogging — either
 * the blog is its home feed, or a portfolio-homed doc opts in with a
 * directional `blog` tag.
 */
export function showOnBlog(value) {
  return isBlogDoc(value) || hasAnyTag(value, BLOG_TAGS);
}

/**
 * The on-site slug for a creative work. Standard docs use `path`
 * (e.g. "/red-blue-yellow"); legacy `is.dame.creating.work` uses `slug`.
 * Returns the bare slug with any leading slash stripped.
 */
export function workSlug(value) {
  const raw = value?.slug || value?.path || '';
  return String(raw).replace(/^\/+/, '');
}

/**
 * Primary category label for a creative work. Legacy records carry an
 * explicit `category`/`kind`; standard docs fold the category into `tags`,
 * so the first tag stands in as the primary medium (the export + migration
 * put the medium first).
 *
 * A blog post cross-posted onto /creating is the one case with no medium to
 * draw on — it carries only the reserved `creating` marker (its other tags,
 * if any, name topics, not craft) — so it falls back to a `case study`
 * category. That default keeps cross-posted posts from landing on the
 * portfolio grid without a chip and lets them group and filter like every
 * other work. An explicit `category`/`kind` still wins, so a deliberate label
 * overrides it.
 */
export function workCategory(value) {
  if (value?.category) return value.category;
  if (value?.kind) return value.kind;
  // A cross-posted blog doc (blog-homed, opted onto /creating with a
  // `creating`/`portfolio` tag) has no medium of its own — categorize the
  // whole class as a case study rather than promoting a topic tag to a medium.
  if (isBlogDoc(value) && hasAnyTag(value, CREATING_TAGS)) return CROSSPOST_CATEGORY;
  // Skip reserved cross-post tags so a `blog`/`creating` marker never shows
  // up as the work's medium; the first real tag stands in as the category.
  return (
    tagList(value).find((t) => !RESERVED_TAGS.has(String(t).trim().toLowerCase())) || ''
  );
}
