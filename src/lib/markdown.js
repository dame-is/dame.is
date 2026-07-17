import { marked } from 'marked';

marked.use({
  gfm: true,
  breaks: false,
  async: false,
});

/**
 * Render markdown to a plain HTML string.
 *
 * Trust invariant: every input here originates from the site owner's own
 * PDS, so the source is trusted and we deliberately keep this path
 * dependency-free (no DOMPurify). The caller is responsible for not
 * feeding foreign markdown through it — if that ever changes (e.g. a new
 * lexicon renders another user's markdown), swap in a real HTML sanitizer.
 *
 * As defense-in-depth even for owned content, we neutralize dangerous URL
 * schemes in the generated HTML (see `neutralizeDangerousUrls`). marked no
 * longer sanitizes output itself, so a `[x](javascript:…)` link would
 * otherwise emit an executable href.
 */
export function renderMarkdown(input, format = 'markdown') {
  if (!input) return '';
  if (format === 'plaintext') {
    return escapeHtml(input).replace(/\n/g, '<br />');
  }
  return neutralizeDangerousUrls(marked.parse(input));
}

/**
 * Replace any `href`/`src` attribute value that begins with a dangerous
 * URL scheme (`javascript:`, `vbscript:`, or `data:text/html`) with `#`.
 * Scheme matching ignores leading ASCII control characters and whitespace,
 * mirroring how browsers normalize a URL before resolving it. This is a
 * belt-and-braces guard; the primary safety guarantee is the owner-trust
 * invariant above.
 */
function neutralizeDangerousUrls(html) {
  return html.replace(
    /\b(href|src)\s*=\s*("|')([\s\S]*?)\2/gi,
    (full, attr, quote, value) => {
      const probe = value.replace(/[\u0000-\u0020]/g, '').toLowerCase();
      if (
        probe.startsWith('javascript:') ||
        probe.startsWith('vbscript:') ||
        probe.startsWith('data:text/html')
      ) {
        return `${attr}=${quote}#${quote}`;
      }
      return full;
    },
  );
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
