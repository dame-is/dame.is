import { Fragment } from 'react';
import { isLikelyBareHttpUrl, truncateUrlDisplay } from './feedUrlFormat.jsx';
import { safeHref } from './safeHref.js';
import { smartenText } from './smartPunctuation.js';
import { isSubscribeLink, jumpToSignup } from './newsletter.js';

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
export function renderLeafletText(text, facets, { smart = false, prev: before = '' } = {}) {
  const safeText = typeof text === 'string' ? text : '';
  if (!safeText) return null;
  // The character before each segment on the page, so a quote that opens in
  // one run and closes in the next still pairs. `prev` seeds it for text that
  // continues a run rendered separately (an essay's opening phrase).
  let prev = before;
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

const LINK_FEATURE = 'pub.leaflet.richtext.facet#link';

/**
 * Where an essay's opening phrase ends, as a string index into `text`: the
 * words set in small caps after the drop cap, the book convention for where
 * the text begins. It runs to the first clause mark if one comes within five
 * words ("In November of 2007", "Note"), and is otherwise the first three
 * ("Six months ago"). 0 when there are no words.
 */
export function ledeEnd(text) {
  const words = [...String(text || '').matchAll(/\S+/g)].slice(0, 5);
  if (!words.length) return 0;
  for (const w of words) {
    const mark = w[0].search(/[,.;:!?\u2013\u2014]/);
    if (mark > 0) return w.index + mark;
    if (mark === 0) return w.index > 0 ? w.index - 1 : 0;
  }
  const last = words[Math.min(3, words.length) - 1];
  return last.index + last[0].length;
}

/**
 * `facets` with any link that opens the paragraph started after its initial
 * letter (and the punctuation before it, which ::first-letter takes too), so
 * a drop cap never sits inside a link: Chromium draws the link's underline
 * across the top of an `initial-letter` cap. The rest of the word still links.
 */
export function unlinkInitial(text, facets) {
  const initial = String(text || '').match(/^[\p{P}\s]*[\p{L}\p{N}]/u);
  if (!initial || !Array.isArray(facets)) return facets;
  const skip = new TextEncoder().encode(initial[0]).length;
  return facets.map((f) => {
    const isLink = (f?.features || []).some((x) => x?.$type === LINK_FEATURE);
    if (!isLink || f.index?.byteStart !== 0 || f.index.byteEnd <= skip) return f;
    return { ...f, index: { ...f.index, byteStart: skip } };
  });
}

/**
 * `text` and its byte-indexed `facets` cut in two at string index `at`, each
 * half with its facets rebased to its own bytes. Formatting that spans the
 * cut is split across both halves; a link never is, so a cut inside one
 * moves back to where the link starts.
 */
export function splitLeafletText(text, facets, at) {
  const safe = typeof text === 'string' ? text : '';
  const encoder = new TextEncoder();
  let cut = encoder.encode(safe.slice(0, Math.max(0, Math.min(at, safe.length)))).length;
  const list = Array.isArray(facets) ? facets.filter((f) => f?.index) : [];
  for (const f of list) {
    const { byteStart, byteEnd } = f.index;
    const isLink = (f.features || []).some((x) => x?.$type === LINK_FEATURE);
    if (isLink && byteStart < cut && byteEnd > cut) cut = byteStart;
  }
  const bytes = encoder.encode(safe);
  const decoder = new TextDecoder('utf-8');
  const head = [];
  const tail = [];
  for (const f of list) {
    const { byteStart, byteEnd } = f.index;
    if (byteStart < cut) {
      head.push({ ...f, index: { byteStart, byteEnd: Math.min(byteEnd, cut) } });
    }
    if (byteEnd > cut) {
      tail.push({ ...f, index: { byteStart: Math.max(byteStart, cut) - cut, byteEnd: byteEnd - cut } });
    }
  }
  return [
    { text: decoder.decode(bytes.slice(0, cut)), facets: head },
    { text: decoder.decode(bytes.slice(cut)), facets: tail },
  ];
}

/**
 * Compose all features on a facet into nested React elements. We apply
 * the link feature outermost so the wrapping anchor remains a single
 * clickable target, then layer the inline format wrappers (bold,
 * italic, …) inside it.
 */
function wrapWithFeatures(features, text) {
  if (!Array.isArray(features) || features.length === 0) return text;

  const link = features.find((f) => f?.$type === LINK_FEATURE);
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
    // A link whose words don't say where it goes ("(source)", "shortcut
    // link") names its host on hover. It used to be a sidenote in the
    // essay's margin, which the one-column page no longer has.
    const titleAttr =
      useTrunc && sourceText.length < trimmed.length ? trimmed : hostOf(href) || undefined;
    // A link to the newsletter form goes to the form on this page when there
    // is one, rather than opening the index in a new tab.
    const onClick = isSubscribeLink(href) ? jumpToSignup : undefined;
    return (
      <a
        className="post-rich-link"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        title={titleAttr}
        onClick={onClick}
      >
        {node}
      </a>
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
