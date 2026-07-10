import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Repeat2 } from 'lucide-react';
import { relativeTime } from '../lib/time.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { ME_DID } from '../config.js';
import { renderPostText } from '../lib/postRichText.jsx';
import { getReplyHint } from '../lib/postReplyHint.js';
import { usePaper } from '../hooks/usePaper.jsx';
import PostEmbed from './PostEmbed.jsx';
import RelativeTimeText from './RelativeTimeText.jsx';

/**
 * Flags a text element with `data-multiline` when it wraps to more than one
 * line, so the ruled/dot paper texture only paints behind posts long enough
 * to read as lined paper (a lone rule under a one-line status looks like a
 * stray underline). Inert while paper is 'blank' — no observers, no attr.
 */
function useMultilineFlag(enabled, text) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!enabled) {
      el.removeAttribute('data-multiline');
      return undefined;
    }
    const measure = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      const multiline = Number.isFinite(lh)
        ? el.offsetHeight > lh * 1.5
        : el.getClientRects().length > 1;
      if (multiline) el.setAttribute('data-multiline', 'true');
      else el.removeAttribute('data-multiline');
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, text]);
  return ref;
}

/**
 * True when a post has no text body and no foreign-author header, so its
 * timestamp would otherwise render as a lonely right-aligned row above the
 * embed (see `showStandaloneTime` below). FeedItem uses this to hoist that
 * timestamp up onto the verb line instead, keeping the two on one row.
 */
export function postCardShowsStandaloneTime({ payload, createdAt, variant = 'timeline' } = {}) {
  const text = payload?.text || '';
  const ts = createdAt || payload?.indexedAt;
  const isOriginalAuthorMe = payload?.author?.did === ME_DID;
  const showOriginalAuthor = !isOriginalAuthorMe && payload?.author?.handle;
  return Boolean(!text && !showOriginalAuthor && ts && variant !== 'record');
}

export default function PostCard({
  verb,
  payload,
  createdAt,
  atUri,
  variant = 'timeline',
  suppressReplyBadge = false,
}) {
  const text = payload?.text || '';
  const facets = payload?.facets || null;
  const ts = createdAt || payload?.indexedAt;
  const rkey = rkeyFromAtUri(atUri);
  const isRepost = verb === 'reposting'
    || payload?.reason?.$type === 'app.bsky.feed.defs#reasonRepost';
  const recordHref = rkey ? `/${isRepost ? 'reposting' : 'posting'}/${rkey}` : null;
  const reply = getReplyHint(payload);
  // Inline "↳ replying to …" only when the feed verb column is not already
  // showing that context (see FeedItem). Hidden on record/parent views.
  const showReplyBadge =
    reply && variant !== 'parent' && variant !== 'record' && !suppressReplyBadge;
  const embed = payload?.embed || payload?.embedRecord || null;
  const authorDid = payload?.author?.did;
  const isOriginalAuthorMe = authorDid === ME_DID;
  // The "by @handle" header line is interesting whenever the post wasn't
  // authored by Dame — most commonly reposts, but also future cases like
  // quote posts surfaced here.
  const showOriginalAuthor = !isOriginalAuthorMe && payload?.author?.handle;
  // For text-less posts (images, video, link cards, etc.) the
  // post-card-row would render an empty box just to host the
  // timestamp on the right — which leaves a gap above the embed and
  // reads as a layout glitch. Skip the row in that case and (if this
  // is a repost-style card) park the timestamp inline with the
  // OriginalAuthorHeader; otherwise drop it onto its own minimal
  // meta row so the time is still discoverable.
  const showTimeInHeader = showOriginalAuthor && !text && ts && variant !== 'record';
  // For text-less posts the feed hoists this timestamp up onto the verb
  // line (see FeedItem + Feed.css), which hides the in-card row below;
  // outside the verb-column feed (showVerb=false surfaces) this row is
  // what keeps the time visible.
  const showStandaloneTime = !text && !showOriginalAuthor && ts && variant !== 'record';

  const { paper } = usePaper();
  const textRef = useMultilineFlag(paper !== 'blank' && Boolean(text), text);

  return (
    <article
      className={`post-card feed-card post-card-${variant}`}
      data-at-uri={atUri}
      data-is-reply={reply ? 'true' : undefined}
      data-is-repost={isRepost ? 'true' : undefined}
    >
      {/*
        The "↻ reposted" tag is only useful on the standalone record page —
        in the timeline / per-record list views, the left-rail verb column
        already says "reposting", and inside a parent card the badge would
        be misleading (the parent isn't being reposted by us).
      */}
      {isRepost && variant === 'record' && (
        <RepostBadge reason={payload?.reason} variant={variant} />
      )}
      {showReplyBadge && <ReplyBadge reply={reply} recordHref={recordHref} />}
      {showOriginalAuthor && variant !== 'parent' && (
        <OriginalAuthorHeader
          author={payload.author}
          // For reposts, prefer the *original* post's at:// when building
          // the outbound bsky.app link — `atUri` here is Dame's repost
          // record on her own PDS.
          subjectUri={payload?.subjectUri || atUri}
          timestamp={showTimeInHeader ? ts : null}
          timestampHref={recordHref}
        />
      )}
      {payload?.subjectMissing && (
        <p className="post-card-text post-card-missing-subject">
          <em>The reposted post is unavailable (deleted, blocked, or its server is unreachable).</em>
        </p>
      )}
      {text && (
        <div className="post-card-row">
          <p className="post-card-text" ref={textRef}>{renderPostText(text, facets)}</p>
          {ts && variant !== 'record' && (
            recordHref ? (
              <Link className="gutter post-card-time" to={recordHref}>
                <RelativeTimeText value={ts} />
              </Link>
            ) : (
              <span className="gutter post-card-time"><RelativeTimeText value={ts} /></span>
            )
          )}
        </div>
      )}
      {showStandaloneTime && (
        <div className="post-card-row post-card-row-meta">
          {recordHref ? (
            <Link className="gutter post-card-time" to={recordHref}>
              <RelativeTimeText value={ts} />
            </Link>
          ) : (
            <span className="gutter post-card-time"><RelativeTimeText value={ts} /></span>
          )}
        </div>
      )}
      {embed && <PostEmbed embed={embed} did={authorDid} />}
      {(payload?.replyCount || payload?.repostCount || payload?.likeCount) ? (
        <footer className="post-card-stats">
          {payload?.replyCount ? `${payload.replyCount} ${payload.replyCount === 1 ? 'reply' : 'replies'}` : ''}
          {payload?.replyCount && (payload?.repostCount || payload?.likeCount) ? ' · ' : ''}
          {payload?.repostCount ? `${payload.repostCount} ${payload.repostCount === 1 ? 'repost' : 'reposts'}` : ''}
          {payload?.repostCount && payload?.likeCount ? ' · ' : ''}
          {payload?.likeCount ? `${payload.likeCount} ${payload.likeCount === 1 ? 'like' : 'likes'}` : ''}
        </footer>
      ) : null}
    </article>
  );
}

/**
 * Renders the "↳ replying to @handle" hint above a reply card.
 *
 * The link points to *this* post's own record page (not the parent's) — that
 * page is where the full parent-chain context is rendered, so this is where
 * a curious reader actually wants to land. The parent's at:// uri is kept on
 * the element as a data-attribute for debugging / future use.
 */
/**
 * Top-line "↻ Dame reposted" tag for repost cards. Mirrors the visual
 * weight of <ReplyBadge /> so the two stack cleanly when a post is both a
 * repost (from Dame's POV) and a reply (within the original conversation).
 *
 * On the record page the verb badge in the page meta already says
 * "reposting", so we render a slightly more descriptive form there
 * ("↻ Dame reposted") instead of just "↻ reposted".
 */
function RepostBadge({ reason, variant }) {
  const ts = reason?.indexedAt;
  return (
    <div className="post-card-repost gutter small-caps">
      <Repeat2 size={13} aria-hidden="true" className="post-card-repost-icon" />
      <span>
        {variant === 'record' ? 'Dame reposted' : 'reposted'}
        {ts && variant === 'record' ? ` ${relativeTime(ts)}` : ''}
      </span>
    </div>
  );
}

/**
 * Author header for posts that *aren't* Dame's own (today: reposts). Links
 * out to the author's bsky.app profile since we don't host their records.
 *
 * Optionally hosts the card's timestamp on the right edge — text-less
 * cards (images / video / link card only) skip the separate text+time
 * row, so the time gets parked here to keep it discoverable without
 * leaving an empty gap above the embed.
 */
function OriginalAuthorHeader({ author, subjectUri, timestamp = null, timestampHref = null }) {
  const handle = author?.handle;
  const displayName = author?.displayName;
  const avatar = author?.avatar;
  const profileHref = handle ? `https://bsky.app/profile/${handle}` : null;
  const externalPostHref = handle && subjectUri
    ? `https://bsky.app/profile/${handle}/post/${subjectUri.split('/').pop()}`
    : profileHref;
  const Wrapper = ({ children }) =>
    externalPostHref ? (
      <a
        className="post-card-author-link"
        href={externalPostHref}
        target="_blank"
        rel="noreferrer noopener"
      >
        {children}
      </a>
    ) : (
      <span className="post-card-author-link">{children}</span>
    );
  return (
    <header className="post-card-author">
      <Wrapper>
        {avatar && (
          <img
            className="post-card-author-avatar"
            src={avatar}
            alt=""
            loading="lazy"
            decoding="async"
            width="28"
            height="28"
          />
        )}
        <span className="post-card-author-names">
          {displayName && (
            <span className="post-card-author-name">{displayName}</span>
          )}
          {handle && (
            <span className="post-card-author-handle gutter">@{handle}</span>
          )}
        </span>
      </Wrapper>
      {timestamp && (
        timestampHref ? (
          <Link className="gutter post-card-time post-card-author-time" to={timestampHref}>
            <RelativeTimeText value={timestamp} />
          </Link>
        ) : (
          <span className="gutter post-card-time post-card-author-time">
            <RelativeTimeText value={timestamp} />
          </span>
        )
      )}
    </header>
  );
}

function ReplyBadge({ reply, recordHref }) {
  const inner = (() => {
    switch (reply.kind) {
      case 'resolved':
        return <>replying to <span className="post-card-reply-handle">@{reply.handle}</span></>;
      case 'missing':
        return <>replying to {reply.label}</>;
      case 'unresolved':
      default:
        return <>replying to a post</>;
    }
  })();
  return (
    <div className="post-card-reply gutter small-caps" data-parent-uri={reply.uri || undefined}>
      <span className="post-card-reply-arrow" aria-hidden="true">↳</span>{' '}
      {recordHref ? <Link to={recordHref}>{inner}</Link> : inner}
    </div>
  );
}
