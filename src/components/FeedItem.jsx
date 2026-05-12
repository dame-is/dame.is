import { Link } from 'react-router-dom';
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
  return (
    <li className={`feed-item feed-item-${item.verb}`} data-verb={item.verb}>
      {href ? (
        <Link className="feed-item-verb small-caps" to={href}>
          <VerbIcon verb={item.verb} size={15} className="feed-item-verb-icon" />
          <span className="feed-item-verb-label">{item.verb}</span>
        </Link>
      ) : (
        <span className="feed-item-verb small-caps">
          <VerbIcon verb={item.verb} size={15} className="feed-item-verb-icon" />
          <span className="feed-item-verb-label">{item.verb}</span>
        </span>
      )}
      <Component {...item} verb={item.verb} />
    </li>
  );
}
