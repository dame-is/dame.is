import { relativeTime } from '../lib/time.js';
import { ME_DID } from '../config.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { Link } from 'react-router-dom';
import { renderPostText } from '../lib/postRichText.jsx';
import PostEmbed from './PostEmbed.jsx';
import './Comments.css';

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
  emptyMessage = 'No replies yet.',
}) {
  if (!atUri) return null;
  return (
    <section className="comments-section">
      <h3 className="comments-heading">
        <span className="small-caps">Replies</span>
      </h3>
      <CommentsBody
        replies={replies}
        status={status}
        emptyMessage={emptyMessage}
      />
    </section>
  );
}

function CommentsBody({ replies, status, emptyMessage }) {
  if (status === 'loading' && (!replies || replies.length === 0)) {
    return <p className="feed-empty">Loading replies…</p>;
  }
  if (status === 'error' && (!replies || replies.length === 0)) {
    return <p className="feed-empty">Couldn't load replies.</p>;
  }
  const visible = (replies || []).filter(isRenderableReply);
  if (visible.length === 0) {
    return <p className="feed-empty">{emptyMessage}</p>;
  }
  return (
    <ul className="comments-tree">
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
              width={28}
              height={28}
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
        <ul className="comments-tree comments-tree-nested" data-depth={depth + 1}>
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
