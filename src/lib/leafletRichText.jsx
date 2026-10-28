import { Fragment } from 'react';
import { isLikelyBareHttpUrl, truncateUrlDisplay } from './feedUrlFormat.jsx';
import { safeHref } from './safeHref.js';
import { smartenText } from './smartPunctuation.js';

// Facet features whose text must reach the page exactly as written: a curled
// quote in code or a URL changes what the reader copies.
const VERBATIM_FEATURES = new Set([
  'pub.leaflet.richtext.facet#link',
  'pub.leaflet.richtext.facet#code',
  'pub.leaflet.richtext.facet#atMention',
  'pub.leaflet.richtext.facet#didMention',
]);

/**
 * Render leaflet `plaintext` + `facets` to React. Mirrors the bsky
 * facet renderer but supports the additional formatting features
 * leaflet defines (`bold`, `italic`, `underline`, `strikethrough`,
 * `code`, `highlight`) and stacks them when a range carries multiple
 * features at once (e.g. an italic link).
 *
 * Facet indices are byte offsets into the UTF-8 encoding of `text`,
 * not JS string indices, so we walk the encoded buffer.
 *
 * `smart` typesets each plain segment (curly quotes, ellipsis, dashes) after
 * the slicing, so the offsets are never disturbed, and skips link, code and
 * mention segments. The author's own documents ask for it; other people's
 * embedded posts don't, and keep their punctuation as posted.
 */
export function renderLeafletText(text, facets, { smart = false } = {}) {
  const safeText = typeof text === 'string' ? text : '';
  if (!safeText) return null;
  // The character before each segment on the page, so a quote that opens in
  // one run and closes in the next still pairs.
  let prev = '';
  const typeset = (s, verbatim = false) => {
    const out = smart && !verbatim ? smartenText(s, prev) : s;
    if (s) prev = s[s.length - 1];
    return out;
  };

  const sortedFacets = Array.isArray(facets)
    ? facets
        .filter((f) => f?.index?.byteStart != null && f?.index?.byteEnd != null)
        .slice()
        .sort((a, b) => a.index.byteStart - b.index.byteStart)
    : [];

  if (sortedFacets.length === 0) {
    return <Fragment>{withLineBreaks(typeset(safeText))}</Fragment>;
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');
  const bytes = encoder.encode(safeText);

  const slice = (start, end) => decoder.decode(bytes.slice(start, end));

  const out = [];
  let cursor = 0;
  let key = 0;

  for (const facet of sortedFacets) {
    const start = facet.index.byteStart;
    const end = facet.index.byteEnd;
    if (start < cursor || end > bytes.length || end < start) continue;

    if (start > cursor) {
      out.push(
        <Fragment key={`t-${key++}`}>
          {withLineBreaks(typeset(slice(cursor, start)))}
        </Fragment>,
      );
    }

    const raw = slice(start, end);
    const verbatim = (facet.features || []).some((f) => VERBATIM_FEATURES.has(f?.$type));
    const segment = typeset(raw, verbatim);
    out.push(
      <Fragment key={`f-${key++}`}>
        {wrapWithFeatures(facet.features, segment)}
      </Fragment>,
    );
    cursor = end;
  }

  if (cursor < bytes.length) {
    out.push(
      <Fragment key={`t-${key++}`}>
        {withLineBreaks(typeset(slice(cursor, bytes.length)))}
      </Fragment>,
    );
  }

  return <Fragment>{out}</Fragment>;
}

/**
 * Compose all features on a facet into nested React elements. We apply
 * the link feature outermost so the wrapping anchor remains a single
 * clickable target, then layer the inline format wrappers (bold,
 * italic, …) inside it.
 */
function wrapWithFeatures(features, text) {
  if (!Array.isArray(features) || features.length === 0) return text;

  const link = features.find((f) => f?.$type === 'pub.leaflet.richtext.facet#link');
  const formatTypes = features
    .map((f) => f?.$type)
    .filter((t) => INLINE_FORMATS[t]);

  const trimmed = text.trim();
  const useTrunc = Boolean(link?.uri) && isLikelyBareHttpUrl(text);
  const sourceText = useTrunc ? truncateUrlDisplay(trimmed) : text;

  let node = withLineBreaks(sourceText);
  for (const t of formatTypes) {
    const Wrapper = INLINE_FORMATS[t];
    node = <Wrapper>{node}</Wrapper>;
  }

  // The link URI is foreign record data, so gate it through the scheme
  // allowlist. A rejected URI falls through to the plain formatted node,
  // so a hostile URI never becomes a live link.
  const href = link?.uri ? safeHref(link.uri) : undefined;
  if (href) {
    const titleAttr =
      useTrunc && sourceText.length < trimmed.length ? trimmed : undefined;
    // A link whose words don't say where it goes ("(source)", "shortcut
    // link") carries a sidenote naming the host. Only an essay's margin shows
    // it (Blogging.css); everywhere else it stays display: none.
    const host = useTrunc ? null : hostOf(href);
    return (
      <>
        <a
          className="post-rich-link"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title={titleAttr}
        >
          {node}
        </a>
        {host && (
          <span className="leaflet-sidenote" aria-hidden="true">
            {host} &#x2197;
          </span>
        )}
      </>
    );
  }
  return node;
}

function hostOf(href) {
  try {
    const u = new URL(href);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

const INLINE_FORMATS = {
  'pub.leaflet.richtext.facet#bold': ({ children }) => <strong>{children}</strong>,
  'pub.leaflet.richtext.facet#italic': ({ children }) => <em>{children}</em>,
  'pub.leaflet.richtext.facet#underline': ({ children }) => <u>{children}</u>,
  'pub.leaflet.richtext.facet#strikethrough': ({ children }) => <s>{children}</s>,
  'pub.leaflet.richtext.facet#code': ({ children }) => <code>{children}</code>,
  'pub.leaflet.richtext.facet#highlight': ({ children }) => <mark>{children}</mark>,
};

function withLineBreaks(text) {
  if (!text) return null;
  if (!text.includes('\n')) return text;
  const parts = text.split('\n');
  const out = [];
  parts.forEach((part, i) => {
    if (part) out.push(<Fragment key={`s-${i}`}>{part}</Fragment>);
    if (i < parts.length - 1) out.push(<br key={`br-${i}`} />);
  });
  return out;
}
