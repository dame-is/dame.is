// Markdown content negotiation — https://acceptmarkdown.com
//
// The same URL serves HTML to a browser and Markdown to an agent that asks for
// it. An agent fetching https://dame.is/blogging with `Accept: text/markdown`
// gets the page's prose without the shell, the scripts, or the layout wrappers
// it would otherwise have to parse past.
//
// Negotiation follows RFC 9110 §12.5.1: media ranges are ranked by
// specificity (`text/markdown` beats `text/*` beats `*/*`) and then by their
// q-value, `q=0` means "not acceptable", and a request that accepts neither
// HTML nor Markdown gets 406 (§15.5.7) rather than a representation it said it
// did not want. Every negotiated response carries `Vary: Accept` so a shared
// cache can't hand the HTML variant to an agent that asked for Markdown.

import { PAGES, SITE } from './pages.js';
import { NAV_PATHS } from './ssrContent.js';

export const MARKDOWN_TYPE = 'text/markdown; charset=utf-8';
export const HTML_TYPE = 'text/html; charset=utf-8';

/** The media types this site can serve for a page, best first. */
export const SERVABLE_TYPES = ['text/markdown', 'text/html'];

/**
 * Parse an Accept header into media ranges.
 * Returns `[]` for a missing or empty header, which the caller reads as
 * "any media type is acceptable".
 */
export function parseAccept(header) {
  const raw = String(header || '').trim();
  if (!raw) return [];
  const out = [];
  for (const part of raw.split(',')) {
    const [rangeRaw, ...paramsRaw] = part.split(';');
    const range = rangeRaw.trim().toLowerCase();
    if (!range) continue;
    const slash = range.indexOf('/');
    if (slash === -1) continue;
    const type = range.slice(0, slash);
    const subtype = range.slice(slash + 1);
    if (!type || !subtype) continue;

    // Only the `q` parameter affects ranking. Anything before it (e.g. the
    // `variant=` parameters some clients send) is part of the media range and
    // is ignored here; a malformed q falls back to 1, per RFC 9110.
    let q = 1;
    for (const p of paramsRaw) {
      const eq = p.indexOf('=');
      if (eq === -1) continue;
      if (p.slice(0, eq).trim().toLowerCase() !== 'q') continue;
      const parsed = Number.parseFloat(p.slice(eq + 1).trim());
      q = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 1;
      break;
    }
    out.push({ type, subtype, q });
  }
  return out;
}

/**
 * The q-value a parsed Accept header gives one media type.
 *
 * The most specific matching range wins regardless of q. That is what lets a
 * header of "any-type at 0.9, text/markdown at 0.1" still mean markdown at 0.1,
 * and what makes "text/html at 0, any-type at 1" a refusal of HTML rather than
 * an acceptance of it. A header with no ranges accepts everything.
 */
export function qualityFor(mediaType, ranges) {
  if (!ranges.length) return 1;
  const [type, subtype] = String(mediaType).toLowerCase().split('/');
  let bestSpecificity = -1;
  let q = 0;
  for (const r of ranges) {
    let specificity;
    if (r.type === type && r.subtype === subtype) specificity = 2;
    else if (r.type === type && r.subtype === '*') specificity = 1;
    else if (r.type === '*' && r.subtype === '*') specificity = 0;
    else continue;
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      q = r.q;
    }
  }
  return q;
}

/**
 * Which representation to serve for an Accept header.
 * @returns {'markdown'|'html'|'none'} `none` means 406.
 */
export function negotiate(acceptHeader) {
  const ranges = parseAccept(acceptHeader);
  const qMarkdown = qualityFor('text/markdown', ranges);
  const qHtml = qualityFor('text/html', ranges);
  if (qMarkdown === 0 && qHtml === 0) return 'none';
  // Ties go to HTML: a browser sending `text/html,…,*/*;q=0.8` and a client
  // sending a bare `*/*` both rank the two equally, and neither asked for
  // Markdown. Only an explicit preference switches the representation.
  return qMarkdown > qHtml ? 'markdown' : 'html';
}

/** Escape the characters that would otherwise be markdown syntax. */
function mdEscape(s) {
  return String(s ?? '').replace(/([\\`*_[\]#<>])/g, '\\$1');
}

/**
 * Render a page as Markdown: its heading and prose, the record behind it, the
 * site's other surfaces as absolute links, and where to find the machine-
 * readable indexes. Mirrors the JS-less HTML fallback in ssrContent.js, so an
 * agent reading either form learns the same things about the page.
 */
export function pageMarkdown({
  origin = `https://${SITE.domain}`,
  path,
  heading,
  desc,
  body = '',
  atUri = null,
  date = null,
  canonical = null,
}) {
  const lines = [`# ${mdEscape(heading)}`, '', mdEscape(desc), ''];
  if (body && body !== desc) lines.push(mdEscape(body), '');
  if (date) lines.push(`Published: ${mdEscape(date)}`, '');
  if (canonical) lines.push(`Canonical URL: ${canonical}`, '');
  if (atUri) lines.push(`Source record: \`${atUri}\``, '');

  lines.push(
    `${mdEscape(SITE.domain)} is a view layer over AT Protocol records. Each section below reads a`,
    `different lexicon from the author's personal data server, so anything published here is also`,
    `readable directly from the protocol by any atproto client.`,
    '',
    '## Sections',
    '',
  );
  for (const p of NAV_PATHS) {
    const meta = PAGES[p];
    if (!meta) continue;
    const here = p === path ? ' (this page)' : '';
    lines.push(`- [${mdEscape(meta.label || p.slice(1))}](${origin}${p})${here} — ${mdEscape(meta.desc)}`);
  }

  lines.push(
    '',
    '## Machine-readable',
    '',
    `- [${origin}/llms.txt](${origin}/llms.txt) — site guide for agents, with when-to-use notes`,
    `- [${origin}/sitemap.xml](${origin}/sitemap.xml) — every page on the site`,
    `- [${origin}/feed.xml](${origin}/feed.xml) — Atom feed of the blog`,
    '',
    'Every page here serves this Markdown view to `Accept: text/markdown`.',
    '',
  );
  return lines.join('\n');
}

/** The Markdown body for a 404, pointing an agent at what does exist. */
export function notFoundMarkdown({ origin = `https://${SITE.domain}`, path = '' } = {}) {
  return [
    '# 404 — Not found',
    '',
    `No page exists at \`${mdEscape(path)}\` on ${mdEscape(SITE.domain)}.`,
    '',
    'Start from one of these instead:',
    '',
    `- [${origin}/llms.txt](${origin}/llms.txt) — site guide for agents, with when-to-use notes`,
    `- [${origin}/sitemap.xml](${origin}/sitemap.xml) — every page on the site`,
    `- [${origin}/feed.xml](${origin}/feed.xml) — Atom feed of the blog`,
    `- [${origin}/](${origin}/) — the home page`,
    '',
  ].join('\n');
}
