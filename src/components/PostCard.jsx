import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/time.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';

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
  const ts = createdAt || payload?.indexedAt;
  const handle = payload?.author?.handle || 'dame.is';
  const rkey = rkeyFromAtUri(atUri);
  const recordHref = rkey ? `/posting/${rkey}` : null;
  const reply = getReplyHint(payload);

  return (
    <article
      className={`post-card feed-card post-card-${variant}`}
      data-at-uri={atUri}
      data-is-reply={reply ? 'true' : undefined}
    >
      {reply && variant !== 'parent' && <ReplyBadge reply={reply} />}
      <header className="post-card-head">
        <span className="small-caps post-card-handle">@{handle}</span>
        {ts && (
          recordHref && variant !== 'record' ? (
            <Link className="gutter post-card-time" to={recordHref}>
              {relativeTime(ts)}
            </Link>
          ) : (
            <span className="gutter post-card-time">{relativeTime(ts)}</span>
          )
        )}
      </header>
      <p className="post-card-text">{text || <em>—</em>}</p>
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

function ReplyBadge({ reply }) {
  const recordHref = reply.uri ? recordPathFromAtUri(reply.uri) : null;
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
    <div className="post-card-reply gutter small-caps">
      <span className="post-card-reply-arrow" aria-hidden="true">↳</span>{' '}
      {recordHref ? <Link to={recordHref}>{inner}</Link> : inner}
    </div>
  );
}
