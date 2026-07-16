import { relativeTime } from '../lib/time.js';
import { ME_DID } from '../config.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { Link } from 'react-router-dom';
import { renderPostText } from '../lib/postRichText.jsx';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';
import PostEmbed from './PostEmbed.jsx';
import { CommentsSkeleton } from './Skeleton.jsx';
import './Comments.css';

/**
 * Nested replies stop shifting right past this depth. The ancestor thread
 * rails already convey lineage, so capping the horizontal indent keeps deep
 * sub-threads from marching off the right edge and forcing horizontal scroll
 * on narrow screens (the thread is fetched up to six levels deep).
 */
const REPLY_INDENT_CAP = 4;

/**
 * Replies tree powered by `app.bsky.feed.getPostThread`.
 *
 * Pure rendering — the parent (Record.jsx) is responsible for fetching the
 * thread and slicing out the `replies` array. Status flags drive the empty /
 * loading / error states so the section stays mounted while the thread
 * resolves.
 */
export default function Comments({
  atUri,
  replies,
  status = 'ready',
  metrics = null,
  emptyMessage = 'No replies yet.',
}) {
  if (!atUri) return null;
  return (
    <section className="comments-section">
      <h3 className="comments-heading">
        <span className="small-caps">Replies</span>
      </h3>
      {metrics && <EngagementBar metrics={metrics} atUri={atUri} />}
      <CommentsBody
        replies={replies}
        status={status}
        emptyMessage={emptyMessage}
      />
    </section>
  );
}

/**
 * Engagement summary for the Bluesky post that hosts this thread — the
 * tallies (replies, reposts, quotes, likes) plus a "Reply" action. Rendered
 * above the replies when the parent supplies `metrics`; omitted otherwise
 * (e.g. the record page, which shows the post's own stats in its card).
 *
 * The tallies are a plain " · "-separated text line, matching the engagement
 * stats on the home-feed post cards (no icons). "Reply" opens the shared
 * waypoints ("Open in…") picker for the thread's `at://` URI, so a reader can
 * jump to the post in whichever Atmosphere client they use and reply there —
 * rather than being forced onto bsky.app.
 */
function EngagementBar({ metrics, atUri }) {
  const { openWaypoints } = useWaypointsModal();
  const { likeCount, repostCount, quoteCount, replyCount } = metrics;
  // Only surface tallies that actually happened — mirrors the post-card stats
  // line, and keeps a lightly-engaged post from reading as a wall of zeros. A
  // post with no engagement yet collapses to just the "Reply" nudge.
  const stats = [
    replyCount ? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : null,
    repostCount ? `${repostCount} ${repostCount === 1 ? 'repost' : 'reposts'}` : null,
    quoteCount ? `${quoteCount} ${quoteCount === 1 ? 'quote' : 'quotes'}` : null,
    likeCount ? `${likeCount} ${likeCount === 1 ? 'like' : 'likes'}` : null,
  ].filter(Boolean);
  const canReply = typeof atUri === 'string' && atUri.startsWith('at://');
  if (stats.length === 0 && !canReply) return null;
  return (
    <div className="comments-engagement">
      {stats.length > 0 && (
        <span className="engagement-stats">{stats.join(' · ')}</span>
      )}
      {canReply && (
        <button
          type="button"
          className="engagement-link"
          onClick={() => openWaypoints(atUri)}
        >
          Reply
        </button>
      )}
    </div>
  );
}

function CommentsBody({ replies, status, emptyMessage }) {
  if (status === 'loading' && (!replies || replies.length === 0)) {
    return <CommentsSkeleton rows={3} />;
  }
  if (status === 'error' && (!replies || replies.length === 0)) {
    return <p className="feed-empty">Couldn't load replies.</p>;
  }
  const visible = (replies || []).filter(isRenderableReply);
  if (visible.length === 0) {
    return <p className="feed-empty">{emptyMessage}</p>;
  }
  return (
    <ul className="comments-tree reveal-stagger">
      {visible.map((node, i) => (
        <ReplyNode key={node.post?.uri || i} node={node} depth={0} />
      ))}
    </ul>
  );
}

/**
 * Recursive node renderer. Each level indents with a hairline thread guide
 * on the left so deep nesting stays readable without runaway horizontal
 * scroll.
 */
function ReplyNode({ node, depth }) {
  if (node?.$type === 'app.bsky.feed.defs#notFoundPost') {
    return <li className="comment comment-missing">a deleted post</li>;
  }
  if (node?.$type === 'app.bsky.feed.defs#blockedPost') {
    return <li className="comment comment-missing">a blocked post</li>;
  }
  const post = node?.post;
  if (!post) return null;
  const author = post.author || {};
  const text = post.record?.text || '';
  const facets = post.record?.facets || null;
  const ts = post.record?.createdAt || post.indexedAt;
  const embed = post.embed || post.record?.embed || null;
  const childReplies = (node.replies || []).filter(isRenderableReply);
  return (
    <li className="comment">
      <article className="comment-card" data-at-uri={post.uri}>
        <header className="comment-head">
          {author.avatar ? (
            <img
              className="comment-avatar"
              src={author.avatar}
              alt=""
              width={40}
              height={40}
              loading="lazy"
            />
          ) : (
            <span className="comment-avatar comment-avatar-fallback" aria-hidden="true" />
          )}
          <div className="comment-byline">
            <AuthorLink author={author} />
            {ts && (
              <span className="comment-time gutter">
                <PermalinkOrText post={post}>{relativeTime(ts)}</PermalinkOrText>
              </span>
            )}
          </div>
        </header>
        {text && <p className="comment-text">{renderPostText(text, facets)}</p>}
        {embed && (
          <div className="comment-embed">
            <PostEmbed embed={embed} did={author.did} />
          </div>
        )}
      </article>
      {childReplies.length > 0 && (
        <ul
          className={
            'comments-tree comments-tree-nested' +
            (depth + 1 > REPLY_INDENT_CAP ? ' comments-tree-capped' : '')
          }
          data-depth={depth + 1}
        >
          {childReplies.map((child, i) => (
            <ReplyNode key={child.post?.uri || i} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Username + handle. Mine links to my profile-equivalent (the home feed),
 * everyone else opens on bsky.app in a new tab — there's nowhere local to
 * send them on this site.
 */
function AuthorLink({ author }) {
  const name = author.displayName || author.handle || 'unknown';
  const handle = author.handle;
  const isMine = author.did === ME_DID;
  const profileHref = isMine
    ? '/'
    : handle
      ? `https://bsky.app/profile/${handle}`
      : null;
  const Tag = isMine ? Link : 'a';
  const linkProps = isMine
    ? { to: profileHref }
    : profileHref
      ? { href: profileHref, target: '_blank', rel: 'noreferrer noopener' }
      : null;
  return (
    <span className="comment-author">
      {linkProps ? (
        <Tag className="comment-author-name" {...linkProps}>{name}</Tag>
      ) : (
        <span className="comment-author-name">{name}</span>
      )}
      {handle && (
        <span className="comment-author-handle">@{handle}</span>
      )}
    </span>
  );
}

/**
 * Time stamp link. Uses the local `/posting/{rkey}` route for my own posts
 * (the only thing this site can render); for other authors we link to the
 * post on bsky.app.
 */
function PermalinkOrText({ post, children }) {
  const isMine = post.author?.did === ME_DID;
  const localHref = isMine ? recordPathFromAtUri(post.uri) : null;
  if (localHref) {
    return <Link to={localHref}>{children}</Link>;
  }
  const handle = post.author?.handle;
  const rkey = post.uri ? post.uri.split('/').pop() : null;
  if (handle && rkey) {
    return (
      <a
        href={`https://bsky.app/profile/${handle}/post/${rkey}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        {children}
      </a>
    );
  }
  return <span>{children}</span>;
}

function isRenderableReply(node) {
  if (!node) return false;
  if (node.$type === 'app.bsky.feed.defs#notFoundPost') return true;
  if (node.$type === 'app.bsky.feed.defs#blockedPost') return true;
  return Boolean(node.post);
}
