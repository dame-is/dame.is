import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/time.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { renderPostText } from '../lib/postRichText.jsx';
import PostEmbed from './PostEmbed.jsx';

/**
 * Pull a parent-post hint from the payload. Prefers the AppView's resolved
 * `payload.parent` (has handle + text), falls back to the `payload.reply`
 * record itself (URI only, lets us still link out).
 */
function getReplyHint(payload) {
  if (!payload) return null;
  const parent = payload.parent;
  if (parent?.$type === 'app.bsky.feed.defs#notFoundPost') {
    return { kind: 'missing', label: 'a deleted post', uri: parent.uri || null };
  }
  if (parent?.$type === 'app.bsky.feed.defs#blockedPost') {
    return { kind: 'missing', label: 'a blocked post', uri: parent.uri || null };
  }
  if (parent?.author?.handle) {
    return {
      kind: 'resolved',
      handle: parent.author.handle,
      uri: parent.uri,
    };
  }
  // Last-ditch: we only have the at:// uri from the record's reply field.
  if (payload.reply?.parent?.uri) {
    return { kind: 'unresolved', uri: payload.reply.parent.uri };
  }
  return null;
}

export default function PostCard({ payload, createdAt, atUri, variant = 'timeline' }) {
  const text = payload?.text || '';
  const facets = payload?.facets || null;
  const ts = createdAt || payload?.indexedAt;
  const rkey = rkeyFromAtUri(atUri);
  const recordHref = rkey ? `/posting/${rkey}` : null;
  const reply = getReplyHint(payload);
  // Show the "↳ replying to …" badge in the timeline only. On the record
  // page itself, the parent chain renders above and would duplicate it.
  const showReplyBadge = reply && variant !== 'parent' && variant !== 'record';
  const embed = payload?.embed || payload?.embedRecord || null;
  const authorDid = payload?.author?.did;

  return (
    <article
      className={`post-card feed-card post-card-${variant}`}
      data-at-uri={atUri}
      data-is-reply={reply ? 'true' : undefined}
    >
      {showReplyBadge && <ReplyBadge reply={reply} recordHref={recordHref} />}
      {(text || (ts && variant !== 'record')) && (
        <div className="post-card-row">
          {text && (
            <p className="post-card-text">{renderPostText(text, facets)}</p>
          )}
          {/*
            On the record page itself the page-level meta header already shows
            the timestamp (and a lot more), so showing it inside the card too
            reads as a duplicate. Skip the in-card timestamp for `variant ===
            'record'`.
          */}
          {ts && variant !== 'record' && (
            recordHref ? (
              <Link className="gutter post-card-time" to={recordHref}>
                {relativeTime(ts)}
              </Link>
            ) : (
              <span className="gutter post-card-time">{relativeTime(ts)}</span>
            )
          )}
        </div>
      )}
      {embed && <PostEmbed embed={embed} did={authorDid} />}
      {(payload?.replyCount || payload?.repostCount || payload?.likeCount) ? (
        <footer className="post-card-stats gutter">
          {payload?.replyCount ? `${payload.replyCount} replies` : ''}
          {payload?.replyCount && (payload?.repostCount || payload?.likeCount) ? ' · ' : ''}
          {payload?.repostCount ? `${payload.repostCount} reposts` : ''}
          {payload?.repostCount && payload?.likeCount ? ' · ' : ''}
          {payload?.likeCount ? `${payload.likeCount} likes` : ''}
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
