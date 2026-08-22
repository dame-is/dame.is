// Server-rendered content for readers that don't run JavaScript.
//
// dame.is renders entirely on the client, so the HTML on the wire carried
// exactly seven characters of text: `<div id="root"></div>` and nothing else.
// Social crawlers were served page-specific <head> meta by middleware.js, but
// an AI crawler or an agent fetching the page saw an empty document — no
// heading, no prose, no links to follow. There was nothing on the page to read.
//
// This module builds a compact, truthful summary of the requested page — its
// heading, its own description, the record behind it where there is one, and
// the site's other surfaces as real <a> links — which middleware.js injects
// into the `#root` container before the shell goes out.
//
// It is a fallback, not a second renderer. Everyone gets the same bytes; only
// JavaScript decides whether they are displayed:
//
//   • JS off (AI crawlers, curl, an agent's fetch tool, a text browser) — the
//     block renders. It is ordinary markup in an ordinary <div>, so every
//     HTML-to-text extractor counts it.
//   • JS on (every browser) — the inline script below hides the block during
//     parse, before the render-blocking stylesheet has let anything paint, so
//     no one sees a flash of it. React then clears `#root` on mount and the
//     node is gone (src/main.jsx removes it explicitly first, so the two nets
//     don't depend on createRoot's clearing behaviour).
//
// Googlebot renders JS and so sees the app exactly as a person does; nothing
// here is shown to a crawler that isn't also served to a browser.

import { PAGES, SITE } from './pages.js';

/** Escape text for an HTML text node or a double-quoted attribute. */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The site's surfaces, in reading order, as the fallback nav lists them.
 * Drawn from PAGES so the copy an agent reads is the same copy the Open Graph
 * cards and the <head> description use — one source, three consumers.
 */
export const NAV_PATHS = [
  '/logging',
  '/posting',
  '/blogging',
  '/creating',
  '/curating',
  '/listening',
  '/mothing',
  '/welcoming',
  '/sharing',
  '/themself',
  '/available',
];

/** `<li>` entries linking every surface, each with its own one-line summary. */
function navList(currentPath) {
  return NAV_PATHS.map((p) => {
    const meta = PAGES[p];
    if (!meta) return '';
    const label = escapeHtml(meta.label || p.replace('/', ''));
    const desc = escapeHtml(meta.desc);
    const current = p === currentPath ? ' aria-current="page"' : '';
    return `<li><a href="${p}"${current}>${label}</a> — ${desc}</li>`;
  })
    .filter(Boolean)
    .join('');
}

/**
 * Build the fallback block for one page.
 *
 * @param {object}  opts
 * @param {string}  opts.path      Request path, for marking the current nav item.
 * @param {string}  opts.heading   The page's <h1>.
 * @param {string}  opts.desc      One-paragraph summary of this page.
 * @param {string} [opts.body]     Extra prose (a record's own text), optional.
 * @param {string} [opts.atUri]    The at:// record behind the page, optional.
 * @param {string} [opts.date]     ISO date the record was published, optional.
 * @returns {string} HTML for the inside of `#root`.
 */
export function ssrFallbackHtml({ path, heading, desc, body = '', atUri = null, date = null }) {
  const parts = [
    `<h1>${escapeHtml(heading)}</h1>`,
    `<p>${escapeHtml(desc)}</p>`,
  ];
  if (body && body !== desc) parts.push(`<p>${escapeHtml(body)}</p>`);
  if (date) parts.push(`<p><time datetime="${escapeHtml(date)}">${escapeHtml(date)}</time></p>`);

  // Every page on this site is a view over an AT Protocol record. Saying which
  // record, in the page itself, is the one fact an agent can't infer — it turns
  // "a web page about X" into "a rendering of this addressable record".
  parts.push(
    atUri
      ? `<p>This page renders the AT Protocol record <code>${escapeHtml(atUri)}</code>. ` +
          `${escapeHtml(SITE.domain)} is a view layer over records held on their author's own ` +
          `personal data server; every page here has one behind it, readable by any atproto client.</p>`
      : `<p>${escapeHtml(SITE.domain)} is a view layer over AT Protocol records. Each surface below ` +
          `reads a different lexicon from the author's personal data server, so anything published ` +
          `here is also readable directly from the protocol by any atproto client.</p>`,
  );

  parts.push(
    `<nav aria-label="Sections of dame.is"><h2>Sections</h2><ul>${navList(path)}</ul></nav>`,
  );

  // Where an agent should go next for structured versions of all of this.
  parts.push(
    `<p>Machine-readable index: <a href="/llms.txt">/llms.txt</a> (site guide for agents), ` +
      `<a href="/sitemap.xml">/sitemap.xml</a> (every page), and ` +
      `<a href="/feed.xml">/feed.xml</a> (Atom feed of the blog). ` +
      `Any page here also serves Markdown to <code>Accept: text/markdown</code>.</p>`,
  );

  return `<div id="ssr-fallback" data-ssr="content">${parts.join('')}</div>`;
}

/**
 * Inject the fallback into the shell's empty `#root`, plus the inline script
 * that hides it wherever JavaScript runs.
 *
 * The script is inline and classic (not a module) so it executes during parse —
 * before the stylesheet has released the first paint — which is what keeps the
 * block from ever flashing into view. It is `hidden` rather than removed so
 * that a JS runtime which parses but doesn't execute still finds the markup.
 */
export function injectSsrFallback(html, block) {
  const hider =
    `<script>(function(){var n=document.getElementById('ssr-fallback');if(n)n.hidden=true;})();</script>`;

  // A replacer FUNCTION, not a string, in both branches: the block contains
  // record-derived text, and `$&`/`$1` in a replacement string would expand
  // instead of being written literally (the same hazard escapeAttr guards in
  // middleware.js).
  //
  // Inside #root is the right home — React owns that container, so the node is
  // gone the moment the app mounts even if nothing removed it by hand. The
  // pattern is loose about whitespace because the built shell is Vite's output,
  // not the file in the repo.
  const root = /<div id="root"\s*>\s*<\/div>/;
  if (root.test(html)) {
    return html.replace(root, () => `<div id="root">${block}</div>\n    ${hider}`);
  }

  // The shell changed shape and #root is no longer an empty div. Ship the
  // content anyway rather than silently going back to serving a page with no
  // text on it — which is the exact failure this module exists to prevent, and
  // the one least likely to be noticed. src/main.jsx removes the node by id, so
  // it is still cleaned up from here.
  return html.replace(/<\/body>/i, () => `  ${block}\n    ${hider}\n  </body>`);
}
