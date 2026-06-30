import { Fragment, useEffect, useState } from 'react';
import { renderLeafletText } from '../lib/leafletRichText.jsx';
import { getPostThread } from '../lib/atproto.js';
import PostEmbed from './PostEmbed.jsx';
import { Link } from 'react-router-dom';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { ME_DID } from '../config.js';
import { relativeTime } from '../lib/time.js';
import './LeafletDocument.css';

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
  if (pages.length === 0) {
    return <p className="feed-empty">This document has no body yet.</p>;
  }
  return (
    <div className="leaflet-doc">
      {pages.map((page, pi) => (
        <LeafletPage key={pi} page={page} />
      ))}
    </div>
  );
}

function LeafletPage({ page }) {
  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
  return (
    <Fragment>
      {blocks.map((wrap, i) => (
        <LeafletBlock key={i} block={wrap?.block} />
      ))}
    </Fragment>
  );
}

export function LeafletBlock({ block }) {
  if (!block) return null;
  switch (block.$type) {
    case 'pub.leaflet.blocks.text':
      return <TextBlock block={block} />;
    case 'pub.leaflet.blocks.header':
      return <HeaderBlock block={block} />;
    case 'pub.leaflet.blocks.image':
      return <ImageBlock block={block} />;
    case 'pub.leaflet.blocks.website':
      return <WebsiteBlock block={block} />;
    case 'pub.leaflet.blocks.bskyPost':
      return <BskyPostBlock block={block} />;
    case 'pub.leaflet.blocks.code':
      return <CodeBlock block={block} />;
    case 'pub.leaflet.blocks.unorderedList':
    case 'pub.leaflet.blocks.orderedList':
      return <ListBlock block={block} ordered={block.$type === 'pub.leaflet.blocks.orderedList'} />;
    default:
      return null;
  }
}

function TextBlock({ block }) {
  const text = block.plaintext || '';
  // Empty text blocks function as paragraph breaks. Render an empty
  // spacer paragraph rather than nothing so the rhythm is preserved.
  if (!text.trim()) {
    return <p className="leaflet-spacer" aria-hidden="true" />;
  }
  return (
    <p className="leaflet-paragraph">{renderLeafletText(text, block.facets)}</p>
  );
}

function HeaderBlock({ block }) {
  const level = clampLevel(block.level);
  const Tag = `h${level}`;
  const text = block.plaintext || '';
  return (
    <Tag className={`leaflet-heading leaflet-heading-${level}`}>
      {renderLeafletText(text, block.facets)}
    </Tag>
  );
}

function ImageBlock({ block }) {
  // `_url` is set by annotateLeafletBlobs once the blob ref is resolved
  // against the PDS. `block.url` is the legacy escape hatch for records
  // migrated from is.dame.creating.work's old media[] array, where images
  // were stored as plain external URLs rather than blob refs.
  const url = block?.image?._url || block?.url || null;
  if (!url) return null;
  const alt = block.alt || '';
  const ar = block.aspectRatio;
  const style = ar?.width && ar?.height
    ? { aspectRatio: `${ar.width} / ${ar.height}` }
    : undefined;
  return (
    <figure className="leaflet-image">
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        style={style}
      />
      {alt && <figcaption className="leaflet-image-caption">{alt}</figcaption>}
    </figure>
  );
}

function WebsiteBlock({ block }) {
  const href = block.src;
  if (!href) return null;
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

function CodeBlock({ block }) {
  const code = block.plaintext || block.code || '';
  return (
    <pre className="leaflet-code">
      <code>{code}</code>
    </pre>
  );
}

/**
 * Recursive list. Each `#listItem` carries a `content` text block and
 * an optional `children` array of more list items (nested lists).
 */
function ListBlock({ block, ordered }) {
  const Tag = ordered ? 'ol' : 'ul';
  const items = Array.isArray(block?.children) ? block.children : [];
  return (
    <Tag className="leaflet-list">
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
function BskyPostBlock({ block }) {
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
    return <div className="leaflet-bsky-post leaflet-bsky-post-loading">Loading post…</div>;
  }
  if (!post) {
    return (
      <div className="leaflet-bsky-post leaflet-bsky-post-missing">
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
    <article className="leaflet-bsky-post" data-at-uri={post.uri}>
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
