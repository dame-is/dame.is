import { Fragment } from 'react';

const DEFAULT_MAX_LEN = 52;

/**
 * Shorten a long URL for inline display (middle ellipsis). The full string
 * should still be exposed via `href` / `title` where applicable.
 */
export function truncateUrlDisplay(url, maxLen = DEFAULT_MAX_LEN) {
  const u = String(url);
  if (u.length <= maxLen) return u;
  const inner = maxLen - 1;
  const left = Math.max(12, Math.ceil(inner * 0.45));
  const right = inner - left;
  return `${u.slice(0, left)}…${u.slice(-right)}`;
}

/**
 * True when `s` is a single-line http(s) URL (typical facet link label).
 */
export function isLikelyBareHttpUrl(s) {
  if (typeof s !== 'string') return false;
  if (s.includes('\n') || s.includes('\r')) return false;
  const t = s.trim();
  return t.length >= 12 && /^https?:\/\//i.test(t) && !/\s/.test(t);
}

/**
 * Split plain text on http(s) URLs and render each URL as a truncated
 * outbound link (full URL in `href` and `title` when truncated).
 */
export function renderPlainTextWithTruncatedUrls(text) {
  if (typeof text !== 'string' || !text) return text;
  const re = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const nodes = [];
  let last = 0;
  let key = 0;
  let matched = false;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    matched = true;
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const url = m[0];
    const label = truncateUrlDisplay(url);
    nodes.push(
      <a
        key={`feedurl-${key++}`}
        className="post-rich-link feed-plain-url-link"
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        title={label.length < url.length ? url : undefined}
      >
        {label}
      </a>,
    );
    last = m.index + url.length;
  }
  if (!matched) return text;
  if (last < text.length) nodes.push(text.slice(last));
  return <Fragment>{nodes}</Fragment>;
}
