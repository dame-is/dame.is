// Classify `site.standard.document` records by the publication they belong
// to. Creative works and blog posts share the same record type; their `site`
// field (an `at://` URI pointing at a `site.standard.publication`) is what
// decides where they surface. See `PORTFOLIO_PUBLICATION` in config.js.

import { PORTFOLIO_PUBLICATION } from '../config.js';

/** True when a standard-document value belongs to the portfolio publication. */
export function isPortfolioDoc(value) {
  if (!PORTFOLIO_PUBLICATION) return false;
  return value?.site === PORTFOLIO_PUBLICATION;
}

/**
 * True when a standard-document value should render on the blog. Anything
 * that isn't a portfolio doc is a blog post — including, while
 * `PORTFOLIO_PUBLICATION` is unset, everything (legacy behavior).
 */
export function isBlogDoc(value) {
  return !isPortfolioDoc(value);
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
 */
export function workCategory(value) {
  if (value?.category) return value.category;
  if (value?.kind) return value.kind;
  const tags = Array.isArray(value?.tags) ? value.tags : [];
  return tags[0] || '';
}
