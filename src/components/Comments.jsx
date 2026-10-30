import { avatarThumb } from '../lib/avatarThumb.js';
import { ME_DID } from '../config.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { Link } from 'react-router-dom';
import { renderPostText } from '../lib/postRichText.jsx';
import { isRenderableReply, linearRun, renderableReplies } from '../lib/postThread.js';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';
import PostEmbed from './PostEmbed.jsx';
import Time from './Time.jsx';
import { CommentsSkeleton } from './Skeleton.jsx';
import SectionHead from './SectionHead.jsx';
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
 * resolves. `action` sits at the right of the Replies heading (a post's page
 * puts its "Open in…" there).
 *
 * `groups` files the replies under the posts of a self-thread instead, each
 * group `{ id, n, postHref, excerpt, replies }`: "on 2 · we have people out
 * here…", the head linking up to post 2. Groups with no replies are left out.
 */
export default function Comments({
  atUri,
  replies,
  groups = null,
  status = 'ready',
  metrics = null,
  emptyMessage = 'No replies yet.',
  action = null,
}) {
  if (!atUri) return null;
  const all = groups ? groups.flatMap((g) => g.replies || []) : replies || [];
  // A thread with nothing in it takes one line ("Replies · none yet · reply
  // on Bluesky") instead of a heading over an empty block.
  const empty = status === 'ready' && !all.some(isRenderableReply) && !metrics?.replyCount;
  if (empty) return <EmptyComments atUri={atUri} action={action} />;
  return (
    <section className="comments-section">
      <SectionHead as="h3" title="Replies" meta={action} />
      {metrics && <EngagementBar metrics={metrics} atUri={atUri} />}
      {groups && all.length > 0 ? (
        <ReplyGroups groups={groups} />
      ) : (
        <CommentsBody replies={all} status={status} emptyMessage={emptyMessage} />
      )}
    </section>
  );
}

/**
 * Replies filed by the post of a thread they answer, in the thread's order.
 * Each head names the post by its number and opening words and links up to
 * it; each post's reply count links down here (Record.jsx ThreadPost).
 */
function ReplyGroups({ groups }) {
  return groups.map((group) => {
    const visible = (group.replies || []).filter(isRenderableReply);
    if (visible.length === 0) return null;
    return (
      <section key={group.id} id={group.id} className="comments-group" aria-label={`Replies to post ${group.n}`}>
        <p className="comments-group-head">
          <a href={group.postHref}>
            <span className="small-caps comments-group-on">on</span>
            <span className="comments-group-n">{group.n}</span>
            <span className="comments-group-excerpt">{group.excerpt}</span>
          </a>
        </p>
        <ul className="comments-tree reveal-stagger">
          {visible.map((node, i) => (
            <ReplyNode key={node.post?.uri || node.uri || i} node={node} depth={0} />
          ))}
        </ul>
      </section>
    );
  });
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

// With an `action` (a post's "Open in…", which opens the same picker), that
// takes the line's right end in place of "reply on Bluesky".
function EmptyComments({ atUri, action = null }) {
  const { openWaypoints } = useWaypointsModal();
  const canReply = typeof atUri === 'string' && atUri.startsWith('at://');
  return (
    <p className="comments-empty-line">
      <span className="small-caps">Replies</span>
      <span aria-hidden="true">·</span>
      <span>none yet</span>
      {action ? (
        <span className="comments-empty-action">{action}</span>
      ) : canReply && (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" className="engagement-link" onClick={() => openWaypoints(atUri)}>
            reply on Bluesky
          </button>
        </>
      )}
    </p>
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
  if (!node?.post) return <MissingReply node={node} />;
  return (
    <li className="comment">
      <ReplyCard post={node.post} />
      <ReplyChildren node={node} depth={depth} />
    </li>
  );
}

/**
 * A node's replies, one level in. A single reply starts a run: it and every
 * reply under it that is the only reply to the one before (linearRun) sit in
 * one list at this indent, so a back-and-forth between two people reads down
 * the page instead of stepping right at every turn. Where the run ends on a
 * post with several replies, those nest under it as usual.
 */
function ReplyChildren({ node, depth }) {
  const children = renderableReplies(node);
  if (children.length === 0) return null;
  const className =
    'comments-tree comments-tree-nested' + (depth + 1 > REPLY_INDENT_CAP ? ' comments-tree-capped' : '');
  if (children.length === 1) {
    const run = linearRun(children[0]);
    return (
      <ul className={`${className} comments-run`} data-depth={depth + 1}>
        {run.map((member, i) =>
          member.post ? (
            <li className="comment" key={member.post.uri}>
              <ReplyCard post={member.post} />
              {i === run.length - 1 && <ReplyChildren node={member} depth={depth + 1} />}
            </li>
          ) : (
            <MissingReply key={member.uri || i} node={member} />
          ),
        )}
      </ul>
    );
  }
  return (
    <ul className={className} data-depth={depth + 1}>
      {children.map((child, i) => (
        <ReplyNode key={child.post?.uri || child.uri || i} node={child} depth={depth + 1} />
      ))}
    </ul>
  );
}

/** A deleted or blocked post in a reply tree, or in the conversation above a reply. */
export function MissingReply({ node }) {
  if (node?.$type === 'app.bsky.feed.defs#blockedPost') {
    return <li className="comment comment-missing">a blocked post</li>;
  }
  if (node?.$type === 'app.bsky.feed.defs#notFoundPost') {
    return <li className="comment comment-missing">a deleted post</li>;
  }
  return null;
}

/**
 * One reply as the Replies section draws it: avatar, name and handle, its
 * time linking to the post, then its words and embed. Record.jsx draws the
 * conversation above a reply with it too, so a conversation reads the same
 * above a post as below it.
 */
export function ReplyCard({ post }) {
  const author = post.author || {};
  const text = post.record?.text || '';
  const facets = post.record?.facets || null;
  const ts = post.record?.createdAt || post.indexedAt;
  const embed = post.embed || post.record?.embed || null;
  return (
    <article className="comment-card" data-at-uri={post.uri}>
      <header className="comment-head">
        {author.avatar ? (
          <img
            className="comment-avatar"
            src={avatarThumb(author.avatar)}
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
              <PermalinkOrText post={post}><Time value={ts} variant="relative" /></PermalinkOrText>
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
