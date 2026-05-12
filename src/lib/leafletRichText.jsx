import { Fragment } from 'react';

/**
 * Render leaflet `plaintext` + `facets` to React. Mirrors the bsky
 * facet renderer but supports the additional formatting features
 * leaflet defines (`bold`, `italic`, `underline`, `strikethrough`,
 * `code`, `highlight`) and stacks them when a range carries multiple
 * features at once (e.g. an italic link).
 *
 * Facet indices are byte offsets into the UTF-8 encoding of `text`,
 * not JS string indices, so we walk the encoded buffer.
 */
export function renderLeafletText(text, facets) {
  const safeText = typeof text === 'string' ? text : '';
  if (!safeText) return null;

  const sortedFacets = Array.isArray(facets)
    ? facets
        .filter((f) => f?.index?.byteStart != null && f?.index?.byteEnd != null)
        .slice()
        .sort((a, b) => a.index.byteStart - b.index.byteStart)
    : [];

  if (sortedFacets.length === 0) {
    return <Fragment>{withLineBreaks(safeText)}</Fragment>;
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
          {withLineBreaks(slice(cursor, start))}
        </Fragment>,
      );
    }

    const segment = slice(start, end);
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
        {withLineBreaks(slice(cursor, bytes.length))}
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

  let node = withLineBreaks(text);
  for (const t of formatTypes) {
    const Wrapper = INLINE_FORMATS[t];
    node = <Wrapper>{node}</Wrapper>;
  }

  if (link?.uri) {
    return (
      <a
        className="post-rich-link"
        href={link.uri}
        target="_blank"
        rel="noreferrer noopener"
      >
        {node}
      </a>
    );
  }
  return node;
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
