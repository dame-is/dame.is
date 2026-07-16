import { cloneElement, createContext, Fragment, useContext, useEffect, useMemo, useState } from 'react';
import { renderLeafletText } from '../lib/leafletRichText.jsx';
import { getPostThread } from '../lib/atproto.js';
import PostEmbed from './PostEmbed.jsx';
import Lightbox from './Lightbox.jsx';
import { Link } from 'react-router-dom';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { ME_DID } from '../config.js';
import { relativeTime } from '../lib/time.js';
import './LeafletDocument.css';

// Lets an ImageBlock deep in the tree open the document's shared lightbox
// at its own image. Null when a block is rendered outside a full document
// (e.g. the admin block-editor preview) — there the image stays static.
const LeafletLightboxContext = createContext(null);

function imageBlockUrl(block) {
  // `_url` is set by annotateLeafletBlobs once the blob ref is resolved
  // against the PDS. `block.url` is the legacy escape hatch for records
  // migrated from is.dame.creating.work's old media[] array, where images
  // were stored as plain external URLs rather than blob refs.
  return block?.image?._url || block?.url || null;
}

function collectImages(pages) {
  const out = [];
  for (const page of pages) {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const entry of blocks) {
      const block = entry?.block;
      if (block?.$type !== 'pub.leaflet.blocks.image') continue;
      const url = imageBlockUrl(block);
      if (!url) continue;
      const ar = block.aspectRatio;
      out.push({
        src: url,
        alt: block.alt || '',
        width: ar?.width || undefined,
        height: ar?.height || undefined,
        searchUrl: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}`,
      });
    }
  }
  return out;
}

/**
 * Renders a `pub.leaflet.document` value — the body of a leaflet.pub
 * long-form post. Walks each page's `linearDocument` blocks and
 * dispatches per block `$type`.
 *
 * Block types handled (set covers the leaflet schema observed in the
 * wild; anything else falls through silently):
 *   - pub.leaflet.blocks.text          (paragraph w/ optional facets)
 *   - pub.leaflet.blocks.header        (heading; level → 1–6)
 *   - pub.leaflet.blocks.image         (image w/ optional alt + AR)
 *   - pub.leaflet.blocks.website       (link card w/ preview)
 *   - pub.leaflet.blocks.bskyPost      (embedded Bluesky post)
 *   - pub.leaflet.blocks.code          (preformatted code)
 *   - pub.leaflet.blocks.unorderedList (recursive list w/ #listItem children)
 *   - pub.leaflet.blocks.orderedList   (same shape as unorderedList)
 *
 * Empty text blocks act as paragraph breaks.
 */
export default function LeafletDocument({ doc }) {
  const pages = Array.isArray(doc?.pages) ? doc.pages : [];
  const images = useMemo(() => collectImages(pages), [pages]);
  const indexBySrc = useMemo(() => {
    const m = new Map();
    images.forEach((im, i) => {
      if (!m.has(im.src)) m.set(im.src, i);
    });
    return m;
  }, [images]);
  const [lightbox, setLightbox] = useState(-1);

  if (pages.length === 0) {
    return <p className="feed-empty">This document has no body yet.</p>;
  }

  const ctx = { openImage: (src) => setLightbox(indexBySrc.get(src) ?? -1) };

  return (
    <LeafletLightboxContext.Provider value={ctx}>
      <div className="leaflet-doc">
        {pages.map((page, pi) => (
          <LeafletPage key={pi} page={page} />
        ))}
      </div>
      {images.length > 0 && (
        <Lightbox
          open={lightbox >= 0}
          index={Math.max(0, lightbox)}
          onClose={() => setLightbox(-1)}
          images={images}
        />
      )}
    </LeafletLightboxContext.Provider>
  );
}

function LeafletPage({ page }) {
  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i]?.block;
    // Collapse a run of consecutive image blocks into a gallery grid so a
    // photo set reads as one unit instead of a tall stack.
    if (block?.$type === 'pub.leaflet.blocks.image') {
      const run = [];
      while (i < blocks.length && blocks[i]?.block?.$type === 'pub.leaflet.blocks.image') {
        run.push(blocks[i].block);
        i += 1;
      }
      if (run.length >= 2) {
        out.push(
          <div className="leaflet-gallery" data-count={run.length} key={`g-${i}`}>
            {run.map((b, j) => (
              <LeafletBlock key={j} block={b} />
            ))}
          </div>,
        );
      } else {
        out.push(<LeafletBlock key={`b-${i}`} block={run[0]} />);
      }
      continue;
    }
    out.push(<LeafletBlock key={`b-${i}`} block={block} />);
    i += 1;
  }
  return <Fragment>{out}</Fragment>;
}

// Optional per-block layout hints (dame.is rendering extensions, set in the
// admin blocks editor): `indent` forces a text paragraph's first-line indent
// on/off (overriding the automatic book-style adjacency indent), and
// `spaceTop`/`spaceBottom` add extra margin above/below any block so an author
// can open up space without inserting empty spacer blocks.
const BLOCK_SPACE_SCALE = {
  sm: 'var(--space-4)',
  md: 'var(--space-6)',
  lg: 'var(--space-8)',
};

function blockLayoutStyle(block) {
  const style = {};
  if (BLOCK_SPACE_SCALE[block.spaceTop]) style.marginTop = BLOCK_SPACE_SCALE[block.spaceTop];
  if (BLOCK_SPACE_SCALE[block.spaceBottom]) style.marginBottom = BLOCK_SPACE_SCALE[block.spaceBottom];
  // Indent is a paragraph concept; only text blocks honor it. `null`/absent =
  // leave the CSS default (adjacent paragraphs auto-indent) untouched.
  if (block.$type === 'pub.leaflet.blocks.text' && block.indent != null) {
    style.textIndent = block.indent ? '1.5em' : '0';
  }
  return Object.keys(style).length ? style : null;
}

export function LeafletBlock({ block }) {
  if (!block) return null;
  // Layout hints ride as an inline style on the block's own root element so
  // they win over the stylesheet's adjacency rules (e.g. the `margin-bottom: 0`
  // on stacked paragraphs) without wrapping the block — wrapping would break
  // those `+` selectors. `null` when the block carries no hints.
  const style = blockLayoutStyle(block);
  switch (block.$type) {
    case 'pub.leaflet.blocks.text':
      return <TextBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.header':
      return <HeaderBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.image':
      return <ImageBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.website':
      return <WebsiteBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.bskyPost':
      return <BskyPostBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.code':
      return <CodeBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.unorderedList':
    case 'pub.leaflet.blocks.orderedList':
      return (
        <ListBlock
          block={block}
          ordered={block.$type === 'pub.leaflet.blocks.orderedList'}
          style={style}
        />
      );
    default:
      return null;
  }
}

function TextBlock({ block, style }) {
  const text = block.plaintext || '';
  // Empty text blocks function as paragraph breaks. Render an empty
  // spacer paragraph rather than nothing so the rhythm is preserved.
  if (!text.trim()) {
    return <p className="leaflet-spacer" aria-hidden="true" style={style || undefined} />;
  }
  return (
    <p className="leaflet-paragraph" style={style || undefined}>
      {renderLeafletText(text, block.facets)}
    </p>
  );
}

function HeaderBlock({ block, style }) {
  const level = clampLevel(block.level);
  const Tag = `h${level}`;
  const text = block.plaintext || '';
  return (
    <Tag className={`leaflet-heading leaflet-heading-${level}`} style={style || undefined}>
      {renderLeafletText(text, block.facets)}
    </Tag>
  );
}

function ImageBlock({ block, style }) {
  const lightbox = useContext(LeafletLightboxContext);
  const url = imageBlockUrl(block);
  if (!url) return null;
  const alt = block.alt || '';
  // `caption` is the visible caption; `alt` stays the screen-reader text.
  // Legacy blocks doubled `alt` as the caption, so fall back to it.
  const caption = block.caption || alt;
  const ar = block.aspectRatio;
  const imgStyle = ar?.width && ar?.height
    ? { aspectRatio: `${ar.width} / ${ar.height}` }
    : undefined;
  const img = (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      style={imgStyle}
    />
  );
  return (
    <figure className="leaflet-image" style={style || undefined}>
      {lightbox?.openImage ? (
        <button
          type="button"
          className="leaflet-image-button"
          onClick={() => lightbox.openImage(url)}
          aria-label={alt ? `View image: ${alt}` : 'View image'}
        >
          {img}
        </button>
      ) : (
        img
      )}
      {caption && <figcaption className="leaflet-image-caption">{caption}</figcaption>}
    </figure>
  );
}

/**
 * If a URL is a known video host, return an embeddable player src so a
 * `website` block whose `src` is a YouTube/Vimeo link plays inline.
 */
export function videoEmbedSrc(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
      const m = u.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/);
      if (m) return `https://www.youtube.com/embed/${m[1]}`;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function WebsiteBlock({ block, style }) {
  const raw = block.src;
  if (!raw) return null;
  // Authors can enter a bare host ("anisota.net"); make the link (and the
  // hostname parse below) work by assuming https when no scheme is present.
  const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  // Known video hosts render as an inline player instead of a link card.
  const embed = videoEmbedSrc(href);
  if (embed) {
    return (
      <figure className="leaflet-embed" style={style || undefined}>
        <div className="leaflet-embed-frame">
          <iframe
            src={embed}
            title={block.title || 'Embedded video'}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        {block.title && <figcaption className="leaflet-image-caption">{block.title}</figcaption>}
      </figure>
    );
  }

  let host = href;
  try {
    host = new URL(href).hostname.replace(/^www\./, '');
  } catch {
    /* keep raw */
  }
  const thumb = block?.previewImage?._url || null;
  return (
    <a
      className="leaflet-website"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={style || undefined}
    >
      {thumb && (
        <div className="leaflet-website-thumb">
          <img src={thumb} alt="" loading="lazy" />
        </div>
      )}
      <div className="leaflet-website-body">
        <div className="leaflet-website-host small-caps">{host}</div>
        {block.title && (
          <div className="leaflet-website-title">{block.title}</div>
        )}
        {block.description && (
          <div className="leaflet-website-desc">{block.description}</div>
        )}
      </div>
    </a>
  );
}

function CodeBlock({ block, style }) {
  const code = block.plaintext || block.code || '';
  const lang = block.language || '';
  // highlight.js is lazy-loaded so it never weighs down pages without code.
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!code.trim()) return undefined;
    import('highlight.js/lib/common')
      .then(({ default: hljs }) => {
        if (cancelled) return;
        try {
          const res =
            lang && hljs.getLanguage(lang)
              ? hljs.highlight(code, { language: lang })
              : hljs.highlightAuto(code);
          setHtml(res.value);
        } catch {
          setHtml(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  return (
    <pre className="leaflet-code hljs" style={style || undefined}>
      {html ? (
        <code dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code>{code}</code>
      )}
    </pre>
  );
}

/**
 * Recursive list. Each `#listItem` carries a `content` text block and
 * an optional `children` array of more list items (nested lists).
 */
function ListBlock({ block, ordered, style }) {
  const Tag = ordered ? 'ol' : 'ul';
  const items = Array.isArray(block?.children) ? block.children : [];
  return (
    <Tag className="leaflet-list" style={style || undefined}>
      {items.map((item, i) => (
        <ListItem key={i} item={item} ordered={ordered} />
      ))}
    </Tag>
  );
}

function ListItem({ item, ordered }) {
  const content = item?.content;
  const text = content?.plaintext || '';
  const facets = content?.facets;
  const children = Array.isArray(item?.children) ? item.children : [];
  return (
    <li>
      {renderLeafletText(text, facets)}
      {children.length > 0 && (
        <ListBlock block={{ children }} ordered={ordered} />
      )}
    </li>
  );
}

/**
 * Embedded Bluesky post. Loads the post lazily via the AppView
 * `getPostThread` endpoint (depth 0). On miss, renders a hint linking
 * to bsky.app so the reader can still chase the reference.
 */
function BskyPostBlock({ block, style }) {
  const uri = block?.postRef?.uri || null;
  const [post, setPost] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    setStatus('loading');
    getPostThread(uri, { depth: 0, parentHeight: 0 })
      .then((thread) => {
        if (cancelled) return;
        const view = thread?.thread?.post || null;
        if (view) {
          setPost(view);
          setStatus('ready');
        } else {
          setStatus('missing');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (!uri) return null;
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="leaflet-bsky-post leaflet-bsky-post-loading" style={style || undefined}>
        Loading post…
      </div>
    );
  }
  if (!post) {
    return (
      <div className="leaflet-bsky-post leaflet-bsky-post-missing" style={style || undefined}>
        <a href={bskyAppUrlFromAtUri(uri)} target="_blank" rel="noreferrer noopener">
          Open the embedded post on bsky.app
        </a>
      </div>
    );
  }

  const author = post.author || {};
  const text = post.record?.text || '';
  const facets = post.record?.facets || null;
  const ts = post.record?.createdAt || post.indexedAt;
  const isMine = author.did === ME_DID;
  const localHref = isMine && post.uri ? recordPathFromAtUri(post.uri) : null;
  const externalHref = !localHref ? bskyAppUrlFromAtUri(post.uri, author.handle) : null;

  return (
    <article className="leaflet-bsky-post" data-at-uri={post.uri} style={style || undefined}>
      <header className="leaflet-bsky-post-head">
        {author.avatar && (
          <img
            className="leaflet-bsky-post-avatar"
            src={author.avatar}
            alt=""
            width={28}
            height={28}
            loading="lazy"
          />
        )}
        <div className="leaflet-bsky-post-byline">
          <span className="leaflet-bsky-post-author">
            {author.displayName && (
              <span className="leaflet-bsky-post-name">{author.displayName}</span>
            )}
            {author.handle && (
              <span className="leaflet-bsky-post-handle">@{author.handle}</span>
            )}
          </span>
          {ts && (
            <span className="leaflet-bsky-post-time gutter">
              {localHref ? (
                <Link to={localHref}>{relativeTime(ts)}</Link>
              ) : externalHref ? (
                <a href={externalHref} target="_blank" rel="noreferrer noopener">
                  {relativeTime(ts)}
                </a>
              ) : (
                relativeTime(ts)
              )}
            </span>
          )}
        </div>
      </header>
      {text && (
        <p className="leaflet-bsky-post-text">{renderLeafletText(text, mapBskyFacetsToLeafletText(facets))}</p>
      )}
      {post.embed && <PostEmbed embed={post.embed} did={author.did} />}
    </article>
  );
}

/**
 * Bluesky link facets are tagged `app.bsky.richtext.facet#link`; the
 * leaflet renderer above only knows about `pub.leaflet.richtext.facet#link`.
 * Translate the type so embedded posts still render their links.
 */
function mapBskyFacetsToLeafletText(facets) {
  if (!Array.isArray(facets)) return facets;
  return facets.map((f) => ({
    ...f,
    features: (f.features || []).map((feature) => {
      if (feature?.$type === 'app.bsky.richtext.facet#link') {
        return { ...feature, $type: 'pub.leaflet.richtext.facet#link' };
      }
      return feature;
    }),
  }));
}

function bskyAppUrlFromAtUri(atUri, handle) {
  if (!atUri) return null;
  const m = String(atUri).match(/^at:\/\/([^/]+)\/[^/]+\/([^/?#]+)/);
  if (!m) return null;
  const who = handle || m[1];
  return `https://bsky.app/profile/${who}/post/${m[2]}`;
}

function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 2;
  return Math.min(6, Math.max(1, Math.round(n)));
}
