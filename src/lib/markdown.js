import { marked } from 'marked';

marked.use({
  gfm: true,
  breaks: false,
  async: false,
});

/**
 * Render markdown to a plain HTML string. Caller is responsible for
 * trusting the source — every input here originates from your own PDS.
 */
export function renderMarkdown(input, format = 'markdown') {
  if (!input) return '';
  if (format === 'plaintext') {
    return escapeHtml(input).replace(/\n/g, '<br />');
  }
  return marked.parse(input);
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
