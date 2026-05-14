import { Link } from 'react-router-dom';
import { CornerDownRight } from 'lucide-react';
import StatusEntry from './StatusEntry.jsx';
import PostCard from './PostCard.jsx';
import BlogCard from './BlogCard.jsx';
import ListenRow from './ListenRow.jsx';
import CreatingCard from './CreatingCard.jsx';
import ReferenceCard from './ReferenceCard.jsx';
import MediaCard from './cards/MediaCard.jsx';
import ListCard from './cards/ListCard.jsx';
import GeneratorCard from './cards/GeneratorCard.jsx';
import CommentCard from './cards/CommentCard.jsx';
import VoteCard from './cards/VoteCard.jsx';
import VerbIcon from './VerbIcon.jsx';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { getReplyHint } from '../lib/postReplyHint.js';
import { verbConfig, recordHrefFor } from '../lib/verbRegistry.js';

/**
 * Renderer name (in the registry) -> component. Adding a new renderer
 * means importing it here and dropping it in this map.
 */
const RENDERERS = {
  StatusEntry,
  PostCard,
  BlogCard,
  ListenRow,
  CreatingCard,
  ReferenceCard,
  MediaCard,
  ListCard,
  GeneratorCard,
  CommentCard,
  VoteCard,
};

function postingReplyVerbLabel(reply) {
  switch (reply.kind) {
    case 'resolved':
      return (
        <>
          replying to{' '}
          <span className="feed-item-verb-reply-handle">@{reply.handle}</span>
        </>
      );
    case 'missing':
      return <>replying to {reply.label}</>;
    case 'unresolved':
    default:
      return <>replying to a post</>;
  }
}

/**
 * Per-record route. Verbs may declare a custom `recordHref` template in
 * the registry (e.g. /blogging/${slug}); everything else falls through
 * to the generic `/{nsid}/{rkey}` form that Record.jsx handles.
 */
function hrefFor(item) {
  return recordHrefFor(item.verb, {
    atUri: item.atUri,
    rkey: rkeyFromAtUri(item.atUri),
    slug: item.payload?.slug,
    source: item.source || item.payload?.source,
    payload: item.payload,
  });
}

/**
 * Polymorphic dispatcher — pick the component for `item.verb` from the
 * registry. The verb badge doubles as the link to the underlying record
 * page (or generic JSON fallback for verbs without a specialized one).
 */
export default function FeedItem({ item }) {
  const cfg = verbConfig(item.verb);
  if (!cfg) return null;
  const Component = cfg.renderer ? RENDERERS[cfg.renderer] : null;
  if (!Component) return null;
  const href = hrefFor(item);
  const replyHint = item.verb === 'posting' ? getReplyHint(item.payload) : null;
  const replyAsVerbColumn = Boolean(replyHint);
  const verbClassName = [
    'feed-item-verb',
    'small-caps',
    replyAsVerbColumn ? 'feed-item-verb-reply' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const verbInner = replyAsVerbColumn ? (
    <>
      <CornerDownRight size={15} strokeWidth={1.75} className="feed-item-verb-icon" aria-hidden="true" />
      <span className="feed-item-verb-label feed-item-verb-label-reply">
        {postingReplyVerbLabel(replyHint)}
      </span>
    </>
  ) : (
    <>
      <VerbIcon verb={item.verb} size={15} className="feed-item-verb-icon" />
      <span className="feed-item-verb-label">{item.verb}</span>
    </>
  );
  return (
    <li
      className={`feed-item feed-item-${item.verb}${replyAsVerbColumn ? ' feed-item-reply-verb' : ''}`}
      data-verb={item.verb}
    >
      {href ? (
        <Link className={verbClassName} to={href}>
          {verbInner}
        </Link>
      ) : (
        <span className={verbClassName}>
          {verbInner}
        </span>
      )}
      <Component
        {...item}
        verb={item.verb}
        suppressReplyBadge={replyAsVerbColumn}
      />
    </li>
  );
}
