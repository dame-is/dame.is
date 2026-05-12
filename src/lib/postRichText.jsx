import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ME_DID } from '../config.js';

/**
 * Render `app.bsky.feed.post#text` with its `facets` resolved into
 * clickable links, @mentions, and #tags. Returns a React fragment.
 *
 * Facets index into the text by *byte* offsets in the UTF-8 encoding,
 * not by JS string indices, so we walk the encoded buffer and decode
 * slices back to characters for each segment.
 *
 * Unrecognised facet feature types are rendered as plain text — we'd
 * rather drop a feature than crash.
 *
 * Honors line breaks by converting "\n" characters to <br /> in plain
 * text segments. Mentions/links/tags are kept on a single line.
 */
export function renderPostText(text, facets) {
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

  const slice = (start, end) =>
    decoder.decode(bytes.slice(start, end));

  const out = [];
  let cursor = 0;
  let key = 0;

  for (const facet of sortedFacets) {
    const start = facet.index.byteStart;
    const end = facet.index.byteEnd;
    if (start < cursor || end > bytes.length || end < start) continue;

    if (start > cursor) {
      out.push(
        <Fragment key={`t-${key++}`}>{withLineBreaks(slice(cursor, start))}</Fragment>,
      );
    }

    const segment = slice(start, end);
    const feature = pickFeature(facet.features);
    out.push(
      <Fragment key={`f-${key++}`}>{renderFeature(feature, segment)}</Fragment>,
    );
    cursor = end;
  }

  if (cursor < bytes.length) {
    out.push(
      <Fragment key={`t-${key++}`}>{withLineBreaks(slice(cursor, bytes.length))}</Fragment>,
    );
  }

  return <Fragment>{out}</Fragment>;
}

function pickFeature(features) {
  if (!Array.isArray(features) || features.length === 0) return null;
  const order = [
    'app.bsky.richtext.facet#link',
    'app.bsky.richtext.facet#mention',
    'app.bsky.richtext.facet#tag',
    'pub.leaflet.richtext.facet#link',
  ];
  for (const t of order) {
    const hit = features.find((f) => f?.$type === t);
    if (hit) return hit;
  }
  return features[0];
}

function renderFeature(feature, text) {
  if (!feature) return text;
  switch (feature.$type) {
    case 'app.bsky.richtext.facet#link':
    case 'pub.leaflet.richtext.facet#link':
      return (
        <a
          className="post-rich-link"
          href={feature.uri}
          target="_blank"
          rel="noreferrer noopener"
        >
          {text}
        </a>
      );
    case 'app.bsky.richtext.facet#mention': {
      // Strip a leading "@" so we can re-render it consistently as part of
      // the link label; the facet text usually already includes it.
      const label = text.startsWith('@') ? text : `@${text}`;
      const did = feature.did;
      const isMine = did === ME_DID;
      if (isMine) {
        return (
          <Link className="post-rich-mention" to="/">
            {label}
          </Link>
        );
      }
      const href = did ? `https://bsky.app/profile/${did}` : null;
      return href ? (
        <a
          className="post-rich-mention"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
        >
          {label}
        </a>
      ) : (
        <span className="post-rich-mention">{label}</span>
      );
    }
    case 'app.bsky.richtext.facet#tag': {
      const tag = feature.tag || text.replace(/^#/, '');
      const label = text.startsWith('#') ? text : `#${text}`;
      return (
        <a
          className="post-rich-tag"
          href={`https://bsky.app/hashtag/${encodeURIComponent(tag)}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          {label}
        </a>
      );
    }
    default:
      return text;
  }
}

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
