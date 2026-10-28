import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Lightbox from './Lightbox.jsx';
import PostEmbed from './PostEmbed.jsx';
import { renderPostText } from '../lib/postRichText.jsx';
import { safeHref } from '../lib/safeHref.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { hostOf, refTitle, shortDay } from '../lib/ledger.js';
import { ME_DID } from '../config.js';

/**
 * Other people's words in the ledger, typeset rather than boxed.
 *
 * The cards layout and record pages draw a quoted or reposted post as a
 * Bluesky card: a tinted box with an avatar, a name stack and "1d ago". In the
 * ledger that box outweighed Dame's own posts (a third of the feed's height),
 * nested box in box, and carried a second clock beside the row's own. Here a
 * post someone else wrote is a citation: a hairline rule down its left, the
 * author's line first, two lines of their text with "+ more" to open the rest
 * in place, any picture as one small thumbnail, and a quote inside it indented
 * again in italic. Its date is a muted absolute day ("· Oct 26"); the row's
 * time column stays the only clock. The ledger only: PostEmbed keeps the card
 * everywhere else.
 */

/* A post the way a citation needs it, from each of the three shapes the feed
   holds one in: a repost's flattened payload, an AppView post view (a like's
   or an Anisota repost's subject), and a quote embed's viewRecord. */
export function citeFromRepost(payload) {
  if (!payload) return null;
  return {
    uri: payload.subjectUri || null,
    author: payload.author || {},
    text: payload.text || '',
    facets: payload.facets || null,
    at: payload.indexedAt || null,
    embed: payload.embed || payload.embedRecord || null,
  };
}

export function citeFromPostView(view) {
  if (!view?.uri) return null;
  return {
    uri: view.uri,
    author: view.author || {},
    text: view.record?.text || '',
    facets: view.record?.facets || null,
    at: view.record?.createdAt || view.indexedAt || null,
    embed: view.embed || view.record?.embed || null,
  };
}

function citeFromViewRecord(record) {
  return {
    uri: record.uri || null,
    author: record.author || {},
    text: record.value?.text || '',
    facets: record.value?.facets || null,
    at: record.value?.createdAt || record.indexedAt || null,
    embed: (Array.isArray(record.embeds) && record.embeds[0]) || record.value?.embed || null,
  };
}

const MISSING_QUOTE = {
  'app.bsky.embed.record#viewNotFound': 'Quoted post not found',
  'app.bsky.embed.record#viewBlocked': 'Quoted post is blocked',
  'app.bsky.embed.record#viewDetached': 'Quoted post was detached',
};

/**
 * The embed under one of Dame's own posts, in the ledger. Her pictures and
 * video keep PostEmbed's full (height-capped) treatment: they're her post. A
 * link becomes a reference line, and a quoted post a citation.
 */
export function LedgerEmbed({ embed, did, postUri }) {
  const type = embed?.$type || '';
  if (type.startsWith('app.bsky.embed.images') || type.startsWith('app.bsky.embed.video')) {
    return <PostEmbed embed={embed} did={did} postUri={postUri} />;
  }
  if (type.startsWith('app.bsky.embed.external')) {
    return <LedgerRef external={embed.external} />;
  }
  if (type === 'app.bsky.embed.record#view') {
    return <QuoteCite record={embed.record} />;
  }
  if (type === 'app.bsky.embed.record') {
    return <BareQuote uri={embed.record?.uri} />;
  }
  if (type.startsWith('app.bsky.embed.recordWithMedia')) {
    const quoted =
      type === 'app.bsky.embed.recordWithMedia#view' ? (
        <QuoteCite record={embed.record?.record} />
      ) : (
        <BareQuote uri={embed.record?.record?.uri} />
      );
    return (
      <>
        {embed.media && <LedgerEmbed embed={embed.media} did={did} postUri={postUri} />}
        {quoted}
      </>
    );
  }
  return null;
}

/** A quote embed's record as a citation, or the line saying it's gone. */
function QuoteCite({ record, nested = false }) {
  if (!record) return null;
  if (MISSING_QUOTE[record.$type]) {
    return (
      <p className={`ledger-cite ledger-cite-missing${nested ? ' ledger-cite-nested' : ''}`}>
        {MISSING_QUOTE[record.$type]}
      </p>
    );
  }
  // Feed generators, lists and starter packs can be "quoted" too; like
  // PostEmbed, the ledger only sets posts.
  if (record.$type !== 'app.bsky.embed.record#viewRecord' && !record.value) return null;
  return <LedgerCite post={citeFromViewRecord(record)} nested={nested} />;
}

/** A quote we hold only as written (a URI), linking out to read it. */
function BareQuote({ uri }) {
  const href = bskyPostUrl(uri);
  if (!href) return null;
  return (
    <p className="ledger-cite ledger-cite-missing">
      <a href={href} target="_blank" rel="noreferrer noopener">
        A quoted post
      </a>
    </p>
  );
}

/**
 * One citation. `post` is a normalized post (see citeFrom* above). A nested
 * citation (a quote inside the one cited) indents and turns italic, keeps its
 * picture as a thumbnail (some quoted posts are nothing else), and stops
 * there: no link line, no third level, which the record page still has.
 */
export function LedgerCite({ post, nested = false }) {
  if (!post) return null;
  const author = post.author || {};
  const name = author.displayName?.trim() || (author.handle ? `@${author.handle}` : 'someone');
  const showHandle = Boolean(author.displayName?.trim() && author.handle);
  const day = post.at ? shortDay(post.at) : '';
  // The author's name carries the way out to the original, which the old
  // card hung on its relative time. Dame's own posts open here instead.
  const local = author.did === ME_DID && post.uri ? recordPathFromAtUri(post.uri) : null;
  const external = !local ? bskyPostUrl(post.uri, author.handle) || profileUrl(author.handle) : null;
  const media = mediaOf(post.embed, author.did);
  const link = nested ? null : externalOf(post.embed);
  const quoted = nested ? null : quoteOf(post.embed);
  const label = `Show all of ${name}${name.endsWith('s') ? '’' : '’s'} post`;
  return (
    <figure className={`ledger-cite${nested ? ' ledger-cite-nested' : ''}`}>
      <figcaption className="ledger-cite-who">
        {local ? (
          <Link className="ledger-cite-name" to={local}>
            {name}
          </Link>
        ) : external ? (
          <a className="ledger-cite-name" href={external} target="_blank" rel="noreferrer noopener">
            {name}
          </a>
        ) : (
          <span className="ledger-cite-name">{name}</span>
        )}
        {showHandle && <span className="ledger-cite-handle">@{author.handle}</span>}
        {day && (
          <span className="ledger-cite-date">
            <span aria-hidden="true">· </span>
            <time dateTime={post.at}>{day}</time>
          </span>
        )}
      </figcaption>
      {(post.text || media) && (
        <div className={`ledger-cite-body${media ? ' has-thumb' : ''}`}>
          {media && <CiteThumb media={media} postUrl={external} />}
          {post.text && (
            <ClampedQuote cite={external} label={label}>
              {renderPostText(post.text, post.facets)}
            </ClampedQuote>
          )}
        </div>
      )}
      {link && <LedgerRef external={link} />}
      {quoted &&
        (quoted.bare ? (
          <BareQuote uri={quoted.bare} />
        ) : (
          <QuoteCite record={quoted.record} nested />
        ))}
    </figure>
  );
}

/**
 * Two lines, then "+ more" to open the rest where it stands, the way a
 * listening session opens its songs. The control only appears when there is
 * more: it's measured, and re-measured when the column changes width.
 *
 * Closed, the control is floated into the end of the second line (see the
 * float in Feed.css), so it reads "…certificate authority… + more" rather
 * than sitting off at the column's edge; that puts it ahead of the words in
 * the markup. Open, the words run in full and "less" follows them. Focus
 * moves to whichever control replaces the one pressed.
 */
function ClampedQuote({ children, cite, label }) {
  const ref = useRef(null);
  const toggleRef = useRef(null);
  const pressed = useRef(false);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return undefined;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  useLayoutEffect(() => {
    if (!pressed.current) return;
    pressed.current = false;
    toggleRef.current?.focus({ preventScroll: true });
  }, [open]);
  const toggle = () => {
    pressed.current = true;
    setOpen((v) => !v);
  };
  return (
    <div className={`ledger-cite-says${open ? ' is-open' : ''}`}>
      <blockquote ref={ref} className="ledger-cite-text" cite={cite || undefined}>
        {!open && overflows && (
          <button
            ref={toggleRef}
            type="button"
            className="ledger-cite-more"
            aria-expanded="false"
            aria-label={label}
            onClick={toggle}
          >
            <span aria-hidden="true">&hellip; </span>+ more
          </button>
        )}
        {children}
      </blockquote>
      {open && (
        <button
          ref={toggleRef}
          type="button"
          className="ledger-cite-more"
          aria-expanded="true"
          onClick={toggle}
        >
          less
        </button>
      )}
    </div>
  );
}

/**
 * A citation's picture: the first image (or a video's poster) as one small
 * square. An image opens the lightbox at full size, with the rest of the
 * post's images behind it; a video's poster links out to where it plays.
 */
function CiteThumb({ media, postUrl }) {
  const [open, setOpen] = useState(false);
  if (media.kind === 'video') {
    const img = <img src={media.thumb} alt={media.alt || ''} loading="lazy" decoding="async" />;
    return postUrl ? (
      <a
        className="ledger-cite-thumb ledger-cite-thumb-video"
        href={postUrl}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={media.alt ? `Play video on Bluesky: ${media.alt}` : 'Play video on Bluesky'}
      >
        {img}
      </a>
    ) : (
      <span className="ledger-cite-thumb ledger-cite-thumb-video">{img}</span>
    );
  }
  const first = media.images[0];
  const more = media.images.length - 1;
  return (
    <>
      <button
        type="button"
        className="ledger-cite-thumb"
        onClick={() => setOpen(true)}
        aria-label={
          (first.alt ? `Open image: ${first.alt}` : 'Open image') +
          (more > 0 ? `, and ${more} more` : '')
        }
      >
        <img src={first.thumb || first.fullsize} alt="" loading="lazy" decoding="async" />
        {more > 0 && (
          <span className="ledger-cite-thumb-count" aria-hidden="true">
            +{more}
          </span>
        )}
      </button>
      <Lightbox
        open={open}
        onClose={() => setOpen(false)}
        images={media.images.map((im) => ({
          src: im.fullsize || im.thumb,
          thumb: im.thumb || undefined,
          alt: im.alt || '',
          width: im.aspectRatio?.width || undefined,
          height: im.aspectRatio?.height || undefined,
        }))}
        index={0}
      />
    </>
  );
}

/**
 * A link as one reference line: the host in small caps, then the page's
 * title (without a "— host" of its own). The ledger's cousin of the link
 * card, standing in until the shared compact LinkCard takes its place.
 */
export function LedgerRef({ external }) {
  const uri = external?.uri;
  if (!uri) return null;
  const host = hostOf(uri);
  const title = refTitle(external.title, host) || uri.replace(/^https?:\/\/(www\.)?/, '');
  const href = safeHref(uri);
  const inner = (
    <>
      {host && <span className="ledger-ref-host">{host}</span>}
      <span className="ledger-ref-title">{title}</span>
    </>
  );
  // A link whose scheme isn't on the allowlist is drawn but never followed.
  return href ? (
    <a className="ledger-ref" href={href} target="_blank" rel="noreferrer noopener">
      {inner}
    </a>
  ) : (
    <span className="ledger-ref">{inner}</span>
  );
}

/** The pictures a cited post carries, in either embed shape, or null. */
function mediaOf(embed, did) {
  if (!embed) return null;
  switch (embed.$type) {
    case 'app.bsky.embed.images#view': {
      const images = (embed.images || []).filter((im) => im?.thumb || im?.fullsize);
      return images.length ? { kind: 'images', images } : null;
    }
    case 'app.bsky.embed.images': {
      const images = (embed.images || [])
        .map((im) => {
          const cid = im?.image?.ref?.$link;
          if (!did || !cid) return null;
          return {
            alt: im.alt || '',
            aspectRatio: im.aspectRatio || null,
            thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${cid}@jpeg`,
            fullsize: `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`,
          };
        })
        .filter(Boolean);
      return images.length ? { kind: 'images', images } : null;
    }
    case 'app.bsky.embed.video#view':
      return embed.thumbnail ? { kind: 'video', thumb: embed.thumbnail, alt: embed.alt } : null;
    case 'app.bsky.embed.recordWithMedia#view':
    case 'app.bsky.embed.recordWithMedia':
      return mediaOf(embed.media, did);
    default:
      return null;
  }
}

/** The link a cited post carries, or null. */
function externalOf(embed) {
  if (!embed) return null;
  if (embed.$type?.startsWith('app.bsky.embed.external')) return embed.external || null;
  if (embed.$type?.startsWith('app.bsky.embed.recordWithMedia')) return externalOf(embed.media);
  return null;
}

/** The post a cited post quotes: `{ record }` for a view, `{ bare }` for a URI. */
function quoteOf(embed) {
  if (!embed) return null;
  switch (embed.$type) {
    case 'app.bsky.embed.record#view':
      return embed.record ? { record: embed.record } : null;
    case 'app.bsky.embed.recordWithMedia#view':
      return embed.record?.record ? { record: embed.record.record } : null;
    case 'app.bsky.embed.record':
      return embed.record?.uri ? { bare: embed.record.uri } : null;
    case 'app.bsky.embed.recordWithMedia':
      return embed.record?.record?.uri ? { bare: embed.record.record.uri } : null;
    default:
      return null;
  }
}

function bskyPostUrl(atUri, handle) {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)/.exec(String(atUri || ''));
  if (!m) return null;
  return `https://bsky.app/profile/${handle || m[1]}/post/${m[2]}`;
}

function profileUrl(handle) {
  return handle ? `https://bsky.app/profile/${handle}` : null;
}
