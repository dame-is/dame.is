import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ME_DID } from '../config.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import RelativeTimeText from './RelativeTimeText.jsx';
import { renderPostText } from '../lib/postRichText.jsx';
import Lightbox from './Lightbox.jsx';
import './PostEmbed.css';

/**
 * Polymorphic embed renderer for `app.bsky.feed.post#embed`.
 *
 * Tolerates two shapes per embed type:
 *   1. The resolved AppView "view" form (e.g. `app.bsky.embed.images#view`)
 *      which already carries CDN URLs like `fullsize` / `thumb`.
 *   2. The raw record form (e.g. `app.bsky.embed.images`) which only has
 *      blob refs. For raw embeds we need the author's DID to construct
 *      the CDN URL.
 *
 * Pass the post's author `did` so we can build CDN URLs for raw embeds.
 */
export default function PostEmbed({ embed, did, depth = 0 }) {
  if (!embed) return null;
  return renderEmbed(embed, did, depth);
}

/** Resolves an embed object to its rendered element. */
function renderEmbed(embed, did, depth) {
  const type = embed.$type;
  switch (type) {
    case 'app.bsky.embed.images#view':
      return <ImageGrid images={embed.images} />;
    case 'app.bsky.embed.images':
      return (
        <ImageGrid
          images={(embed.images || []).map((im) => normalizeRawImage(im, did))}
        />
      );
    case 'app.bsky.embed.video#view':
      return (
        <VideoBlock
          playlist={embed.playlist}
          thumbnail={embed.thumbnail}
          alt={embed.alt}
          aspectRatio={embed.aspectRatio}
        />
      );
    case 'app.bsky.embed.video':
      return (
        <VideoBlock
          playlist={did && embed.video?.ref?.$link
            ? `https://video.bsky.app/watch/${did}/${embed.video.ref.$link}/playlist.m3u8`
            : null}
          thumbnail={did && embed.video?.ref?.$link
            ? `https://video.bsky.app/watch/${did}/${embed.video.ref.$link}/thumbnail.jpg`
            : null}
          alt={embed.alt}
          aspectRatio={embed.aspectRatio}
        />
      );
    case 'app.bsky.embed.external#view':
      return <ExternalCard external={embed.external} />;
    case 'app.bsky.embed.external':
      return (
        <ExternalCard
          external={{
            uri: embed.external?.uri,
            title: embed.external?.title,
            description: embed.external?.description,
            thumb: did && embed.external?.thumb?.ref?.$link
              ? `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${embed.external.thumb.ref.$link}@jpeg`
              : null,
          }}
        />
      );
    case 'app.bsky.embed.record#view':
      return <QuoteRecord record={embed.record} depth={depth} />;
    case 'app.bsky.embed.record':
      // Raw record embed only has uri/cid — render as a "see post" hint.
      return (
        <a
          className="post-embed-quote post-embed-quote-bare"
          href={bskyAppUrlFromAtUri(embed.record?.uri)}
          target="_blank"
          rel="noreferrer noopener"
        >
          A quoted post
        </a>
      );
    case 'app.bsky.embed.recordWithMedia#view':
      return (
        <>
          {embed.media && (
            <PostEmbed embed={embed.media} did={did} depth={depth} />
          )}
          {embed.record?.record && (
            <QuoteRecord record={embed.record.record} depth={depth} />
          )}
        </>
      );
    case 'app.bsky.embed.recordWithMedia':
      return (
        <>
          {embed.media && (
            <PostEmbed embed={embed.media} did={did} depth={depth} />
          )}
          {embed.record?.record && (
            <a
              className="post-embed-quote post-embed-quote-bare"
              href={bskyAppUrlFromAtUri(embed.record.record.uri)}
              target="_blank"
              rel="noreferrer noopener"
            >
              A quoted post
            </a>
          )}
        </>
      );
    default:
      return null;
  }
}

function normalizeRawImage(image, did) {
  const cid = image?.image?.ref?.$link;
  if (!did || !cid) {
    return {
      alt: image?.alt || '',
      aspectRatio: image?.aspectRatio || null,
      thumb: null,
      fullsize: null,
    };
  }
  return {
    alt: image?.alt || '',
    aspectRatio: image?.aspectRatio || null,
    thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${cid}@jpeg`,
    fullsize: `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`,
  };
}

function ImageGrid({ images }) {
  const list = (images || []).filter((im) => im?.thumb || im?.fullsize);
  const [lightbox, setLightbox] = useState({ open: false, index: 0 });
  if (list.length === 0) return null;
  // Pass the already-cached grid thumbnail plus intrinsic dimensions so the
  // lightbox paints the exact pixels the reader tapped immediately — the
  // frame is pre-sized and the full-res file swaps in on load, instead of a
  // blank box that pops to size (the "flash" on open).
  const lightboxImages = list.map((im) => ({
    src: im.fullsize || im.thumb,
    alt: im.alt || '',
    thumb: im.thumb || undefined,
    width: im.aspectRatio?.width || undefined,
    height: im.aspectRatio?.height || undefined,
  }));
  const single = list.length === 1;
  return (
    <>
      <div
        className="post-embed-images"
        data-count={list.length}
      >
        {list.map((im, i) => {
          const ar = im.aspectRatio;
          const hasAr = ar?.width > 0 && ar?.height > 0;
          // For a lone image, hand its own aspect ratio to the frame (see
          // PostEmbed.css). The frame then reserves the right box before the
          // file loads and caps a tall image by its *width* — so it scales
          // down whole, true to ratio, rather than letterboxing against a
          // background inside a fixed-height frame.
          const framed = single && hasAr;
          return (
            <button
              key={i}
              type="button"
              className="post-embed-image"
              data-sized={framed ? 'true' : undefined}
              style={framed ? { '--img-ar': ar.width / ar.height } : undefined}
              onClick={() => setLightbox({ open: true, index: i })}
              aria-label={im.alt ? `Open image: ${im.alt}` : 'Open image'}
            >
              <img
                src={im.thumb || im.fullsize}
                alt={im.alt || ''}
                loading="lazy"
                decoding="async"
                style={
                  hasAr
                    ? { aspectRatio: `${ar.width} / ${ar.height}` }
                    : undefined
                }
              />
            </button>
          );
        })}
      </div>
      <Lightbox
        open={lightbox.open}
        onClose={() => setLightbox((s) => ({ ...s, open: false }))}
        images={lightboxImages}
        index={lightbox.index}
      />
    </>
  );
}

/**
 * HLS playback isn't natively supported in Chrome/Firefox. Use the
 * thumbnail with a "play on bsky" link as a graceful fallback when we
 * can't actually play the stream inline.
 */
function VideoBlock({ playlist, thumbnail, alt, aspectRatio }) {
  if (!playlist && !thumbnail) return null;
  const style = aspectRatio
    ? { aspectRatio: `${aspectRatio.width} / ${aspectRatio.height}` }
    : undefined;
  return (
    <div className="post-embed-video" style={style}>
      {playlist ? (
        <video
          controls
          preload="none"
          poster={thumbnail || undefined}
          aria-label={alt || 'Video'}
          playsInline
        >
          <source src={playlist} type="application/vnd.apple.mpegurl" />
        </video>
      ) : (
        <img src={thumbnail} alt={alt || ''} loading="lazy" />
      )}
    </div>
  );
}

function ExternalCard({ external }) {
  if (!external?.uri) return null;
  let host = external.uri;
  try {
    const u = new URL(external.uri);
    host = u.hostname.replace(/^www\./, '');
  } catch {
    /* ignore */
  }
  return (
    <a
      className="post-embed-link-card"
      href={external.uri}
      target="_blank"
      rel="noreferrer noopener"
    >
      {external.thumb && (
        <div className="post-embed-link-card-thumb">
          <img src={external.thumb} alt="" loading="lazy" />
        </div>
      )}
      <div className="post-embed-link-card-body">
        <div className="post-embed-link-card-host">{host}</div>
        {external.title && (
          <div className="post-embed-link-card-title">{external.title}</div>
        )}
        {external.description && (
          <div className="post-embed-link-card-desc">{external.description}</div>
        )}
      </div>
    </a>
  );
}

/**
 * A quoted (record) embed — `app.bsky.embed.record#viewRecord`. Renders a
 * miniature card with the quoted author + text + nested media if any.
 * Caps recursion at depth 1 so a quote of a quote of a quote… doesn't
 * blow up the page.
 */
function QuoteRecord({ record, depth = 0 }) {
  if (!record) return null;
  if (record.$type === 'app.bsky.embed.record#viewNotFound') {
    return <div className="post-embed-quote post-embed-quote-missing">Quoted post not found</div>;
  }
  if (record.$type === 'app.bsky.embed.record#viewBlocked') {
    return <div className="post-embed-quote post-embed-quote-missing">Quoted post is blocked</div>;
  }
  if (record.$type === 'app.bsky.embed.record#viewDetached') {
    return <div className="post-embed-quote post-embed-quote-missing">Quoted post was detached</div>;
  }
  if (record.$type !== 'app.bsky.embed.record#viewRecord' && !record.value) return null;

  const author = record.author || {};
  const value = record.value || {};
  const text = value.text || '';
  const facets = value.facets || [];
  const ts = value.createdAt || record.indexedAt;
  const isMine = author.did === ME_DID;
  const localHref = isMine && record.uri ? recordPathFromAtUri(record.uri) : null;
  const externalHref = !localHref ? bskyAppUrlFromAtUri(record.uri, author.handle) : null;

  // viewRecord embeds nested media in `record.embeds` (note plural).
  const nestedEmbed = Array.isArray(record.embeds) && record.embeds.length > 0
    ? record.embeds[0]
    : null;

  return (
    <article className="post-embed-quote">
      <header className="post-embed-quote-head">
        {author.avatar && (
          <img
            className="post-embed-quote-avatar"
            src={author.avatar}
            alt=""
            width={20}
            height={20}
            loading="lazy"
          />
        )}
        <span className="post-embed-quote-author">
          {author.displayName && (
            <span className="post-embed-quote-name">{author.displayName}</span>
          )}
          {author.handle && (
            <span className="post-embed-quote-handle">@{author.handle}</span>
          )}
        </span>
        {ts && (
          <span className="post-embed-quote-time gutter">
            {localHref ? (
              <Link to={localHref}><RelativeTimeText value={ts} /></Link>
            ) : externalHref ? (
              <a href={externalHref} target="_blank" rel="noreferrer noopener">
                <RelativeTimeText value={ts} />
              </a>
            ) : (
              <RelativeTimeText value={ts} />
            )}
          </span>
        )}
      </header>
      {text && (
        <p className="post-embed-quote-text">{renderPostText(text, facets)}</p>
      )}
      {nestedEmbed && depth < 1 && (
        <PostEmbed embed={nestedEmbed} did={author.did} depth={depth + 1} />
      )}
    </article>
  );
}

function bskyAppUrlFromAtUri(atUri, handle) {
  if (!atUri) return null;
  const m = String(atUri).match(/^at:\/\/([^/]+)\/[^/]+\/([^/?#]+)/);
  if (!m) return null;
  const who = handle || m[1];
  return `https://bsky.app/profile/${who}/post/${m[2]}`;
}
