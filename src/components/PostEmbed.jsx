import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Images, Film, Link2, Quote, ChevronDown } from 'lucide-react';
import { ME_DID } from '../config.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { useDensity } from '../hooks/useDensity.jsx';
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
 *
 * `collapsible` is set by the feed card renderers. In the feed's `tight`
 * density it swaps the embed for a small labeled chip the reader can
 * expand on demand — keeping rows scannable without losing the signal
 * that an embed exists. At every other density (and everywhere
 * `collapsible` is unset, e.g. record/detail pages) the embed renders
 * inline as usual; compact sizing is handled in CSS.
 */
export default function PostEmbed({ embed, did, depth = 0, collapsible = false }) {
  if (!embed) return null;
  const content = renderEmbed(embed, did, depth);
  if (!content) return null;
  if (collapsible) {
    return <CollapsibleEmbed embed={embed}>{content}</CollapsibleEmbed>;
  }
  return content;
}

/**
 * In `tight` density a feed embed collapses to a one-line chip
 * (icon + label + caret) that toggles the real embed open. Other
 * densities render the embed inline untouched.
 */
function CollapsibleEmbed({ embed, children }) {
  const { density } = useDensity();
  const [open, setOpen] = useState(false);
  if (density !== 'tight') return children;
  const summary = embedSummary(embed);
  // Unknown embed type — nothing useful to label, so just show it.
  if (!summary) return children;
  const { Icon, label } = summary;
  return (
    <div className="post-embed-collapsible">
      <button
        type="button"
        className="post-embed-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <Icon size={13} strokeWidth={1.75} className="post-embed-toggle-icon" aria-hidden="true" />
        <span className="post-embed-toggle-label">{label}</span>
        <ChevronDown
          size={13}
          strokeWidth={1.75}
          className={`post-embed-toggle-caret ${open ? 'is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && <div className="post-embed-collapsible-body">{children}</div>}
    </div>
  );
}

/**
 * One-line descriptor (icon + label) for an embed, used by the tight-mode
 * collapse chip. Returns null for embed types we don't summarize.
 */
function embedSummary(embed) {
  if (!embed) return null;
  switch (embed.$type) {
    case 'app.bsky.embed.images#view':
    case 'app.bsky.embed.images': {
      const n = (embed.images || []).length || 0;
      return { Icon: Images, label: n === 1 ? '1 image' : `${n} images` };
    }
    case 'app.bsky.embed.video#view':
    case 'app.bsky.embed.video':
      return { Icon: Film, label: 'Video' };
    case 'app.bsky.embed.external#view':
    case 'app.bsky.embed.external': {
      let host = 'Link';
      try {
        host = new URL(embed.external?.uri).hostname.replace(/^www\./, '');
      } catch {
        /* ignore */
      }
      return { Icon: Link2, label: host };
    }
    case 'app.bsky.embed.record#view':
    case 'app.bsky.embed.record':
      return { Icon: Quote, label: 'Quoted post' };
    case 'app.bsky.embed.recordWithMedia#view':
    case 'app.bsky.embed.recordWithMedia': {
      const media = embed.media ? embedSummary(embed.media) : null;
      return {
        Icon: media?.Icon || Quote,
        label: media ? `${media.label} + quote` : 'Quoted post',
      };
    }
    default:
      return null;
  }
}

/**
 * Resolves an embed object to its rendered element. Split out from the
 * default export so `PostEmbed` can optionally wrap the result in the
 * tight-mode collapse chip.
 */
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
  const lightboxImages = list.map((im) => ({
    src: im.fullsize || im.thumb,
    alt: im.alt || '',
  }));
  return (
    <>
      <div
        className="post-embed-images"
        data-count={list.length}
      >
        {list.map((im, i) => (
          <button
            key={i}
            type="button"
            className="post-embed-image"
            onClick={() => setLightbox({ open: true, index: i })}
            aria-label={im.alt ? `Open image: ${im.alt}` : 'Open image'}
          >
            <img
              src={im.thumb || im.fullsize}
              alt={im.alt || ''}
              loading="lazy"
              decoding="async"
              style={
                im.aspectRatio
                  ? { aspectRatio: `${im.aspectRatio.width} / ${im.aspectRatio.height}` }
                  : undefined
              }
            />
          </button>
        ))}
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
