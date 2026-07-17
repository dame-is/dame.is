/**
 * Scheme-allowlist guard for hrefs built from foreign/record data.
 *
 * Returns `uri` unchanged when it is safe to use as a link target:
 *   - a string whose URL scheme is in the allowlist (http, https, mailto,
 *     at), compared case-insensitively, or
 *   - a scheme-relative reference (a relative path or "#fragment" that
 *     carries no scheme of its own, so it inherits the page's origin).
 *
 * Any other scheme (javascript:, data:, vbscript:, file:, …) yields
 * `undefined` so the caller can drop the link rather than emit a live,
 * potentially executable href. React does not strip dangerous schemes
 * from `href`, so this must be done explicitly for any URI that can come
 * from another user's records (facets, embeds, quote cards).
 *
 * Dependency-free by design.
 *
 * @param {unknown} uri - candidate href, typically from record/embed data
 * @returns {string|undefined} the original `uri` if safe, else `undefined`
 */
export function safeHref(uri) {
  if (typeof uri !== 'string') return undefined;

  // Scheme detection is done on a normalized probe: browsers strip ASCII
  // control characters and whitespace (tabs, newlines, spaces) from a URL
  // before resolving it, so `java\tscript:alert(1)` would execute. Remove
  // those bytes before testing the scheme, but return the caller's original
  // string verbatim when it passes.
  const probe = uri.replace(/[\u0000-\u0020]/g, '').toLowerCase();

  // RFC 3986 scheme: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) followed by ":".
  const match = /^([a-z][a-z0-9+.-]*):/.exec(probe);
  if (!match) {
    // No scheme → relative path or fragment; inherits the page origin.
    return uri;
  }

  return ALLOWED_SCHEMES.has(match[1]) ? uri : undefined;
}

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'at']);
