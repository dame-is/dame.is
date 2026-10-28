import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { ME_DID } from '../config.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import RelativeTimeText from './RelativeTimeText.jsx';
import { renderPostText } from '../lib/postRichText.jsx';
import LinkCard from './LinkCard.jsx';
import { avatarThumb } from '../lib/avatarThumb.js';
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
/**
 * `nest` is the nesting level of the surface this embed is drawn ON — 0 for
 * anything sitting straight on the page, 1 inside a container that is already
 * a tint deep (a document's embedded post block). Everything below adds its
 * own depth to it, so a quote knows its absolute level without having to ask
 * what it is inside of. See the nesting scale in styles/theme.css.
 *
 * `postUri` is the at:// URI of the post the embed belongs to, when the
 * caller knows it. A video the browser can't play inline links out to that
 * post on bsky.app; without it the poster just sits there.
 */
export default function PostEmbed({
  embed,
  did,
  depth = 0,
  nest = 0,
  postUri = null,
}) {
  if (!embed) return null;
  return renderEmbed(embed, did, depth, nest, postUri);
}

/** Resolves an embed object to its rendered element. */
function renderEmbed(embed, did, depth, nest = 0, postUri = null) {
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
          postUri={postUri}
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
          postUri={postUri}
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
      return <QuoteRecord record={embed.record} depth={depth} nest={nest} />;
    case 'app.bsky.embed.record':
      // Raw record embed only has uri/cid — render as a "see post" hint.
      return (
        <a
          className="post-embed-quote post-embed-quote-bare"
          style={{ '--nest': nest + depth + 1 }}
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
            <PostEmbed
              embed={embed.media}
              did={did}
              depth={depth}
              nest={nest}
              postUri={postUri}
            />
          )}
          {embed.record?.record && (
            <QuoteRecord record={embed.record.record} depth={depth} nest={nest} />
          )}
        </>
      );
    case 'app.bsky.embed.recordWithMedia':
      return (
        <>
          {embed.media && (
            <PostEmbed
              embed={embed.media}
              did={did}
              depth={depth}
              nest={nest}
              postUri={postUri}
            />
          )}
          {embed.record?.record && (
            <a
              className="post-embed-quote post-embed-quote-bare"
              style={{ '--nest': nest + depth + 1 }}
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
 * Whether a plain <video> plays HLS here. Bluesky serves video only as an HLS
 * playlist, which Safari and most mobile browsers play natively and others
 * (Firefox, notably) don't: those report '' and would sit on a poster whose
 * play button does nothing. Asked once per session.
 */
let nativeHls = null;
function playsHlsNatively() {
  if (nativeHls === null) {
    nativeHls =
      typeof document !== 'undefined' &&
      document
        .createElement('video')
        .canPlayType('application/vnd.apple.mpegurl') !== '';
  }
  return nativeHls;
}

/**
 * Inline player where the browser can play the stream; otherwise the
 * thumbnail, linking out to the post on bsky.app (when `postUri` says which
 * post that is) so the video is still one tap away.
 */
function VideoBlock({ playlist, thumbnail, alt, aspectRatio, postUri = null }) {
  if (!playlist && !thumbnail) return null;
  const style = aspectRatio
    ? { aspectRatio: `${aspectRatio.width} / ${aspectRatio.height}` }
    : undefined;
  if (playlist && playsHlsNatively()) {
    return (
      <div className="post-embed-video" style={style}>
        <video
          controls
          preload="none"
          poster={thumbnail || undefined}
          aria-label={alt || 'Video'}
          playsInline
        >
          <source src={playlist} type="application/vnd.apple.mpegurl" />
        </video>
      </div>
    );
  }
  const href =
    playlist &&
    /^at:\/\/[^/]+\/app\.bsky\.feed\.post\//.test(String(postUri || ''))
      ? bskyAppUrlFromAtUri(postUri)
      : null;
  const poster = thumbnail ? (
    <img src={thumbnail} alt={alt || ''} loading="lazy" />
  ) : null;
  if (!href) {
    return poster ? (
      <div className="post-embed-video" style={style}>
        {poster}
      </div>
    ) : null;
  }
  return (
    <a
      className="post-embed-video post-embed-video-out"
      style={style}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={
        alt ? `Play video on Bluesky: ${alt}` : 'Play video on Bluesky'
      }
    >
      {poster}
      <span className="post-embed-video-badge gutter" aria-hidden="true">
        <Play size={12} strokeWidth={2} fill="currentColor" /> play on Bluesky
      </span>
    </a>
  );
}

// The external link card is the site's one reference card, at its compact
// size; LinkCard gates the foreign URI through the scheme allowlist.
function ExternalCard({ external }) {
  if (!external?.uri) return null;
  return (
    <LinkCard
      href={external.uri}
      title={external.title}
      description={external.description}
      thumb={external.thumb}
    />
  );
}

/**
 * A quoted (record) embed — `app.bsky.embed.record#viewRecord`. Renders a
 * miniature card with the quoted author + text + nested media if any.
 * Caps recursion at depth 1 so a quote of a quote of a quote… doesn't
 * blow up the page.
 */
function QuoteRecord({ record, depth = 0, nest = 0 }) {
  // Which surface this one is: the level of whatever it sits on, plus how
  // many quotes deep it is inside that. The stylesheet turns it into a tint;
  // everything drawn inside inherits it and can step from there.
  const level = nest + depth + 1;
  const tint = { '--nest': level };
  if (!record) return null;
  if (record.$type === 'app.bsky.embed.record#viewNotFound') {
    return (
      <div className="post-embed-quote post-embed-quote-missing" style={tint}>
        Quoted post not found
      </div>
    );
  }
  if (record.$type === 'app.bsky.embed.record#viewBlocked') {
    return (
      <div className="post-embed-quote post-embed-quote-missing" style={tint}>
        Quoted post is blocked
      </div>
    );
  }
  if (record.$type === 'app.bsky.embed.record#viewDetached') {
    return (
      <div className="post-embed-quote post-embed-quote-missing" style={tint}>
        Quoted post was detached
      </div>
    );
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
    <article className="post-embed-quote" style={tint}>
      <header className="post-embed-quote-head">
        {author.avatar && (
          <img
            className="post-embed-quote-avatar"
            src={avatarThumb(author.avatar)}
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
        <PostEmbed
          embed={nestedEmbed}
          did={author.did}
          depth={depth + 1}
          nest={nest}
          postUri={record.uri}
        />
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
